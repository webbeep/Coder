// Detects what a model server is and which wire formats it speaks, without
// spending tokens: only model-list GETs and empty-body POSTs (which a real
// endpoint rejects with 400/401/422, and a missing one with 404/405).

export type ApiFormat = "openai-chat" | "openai-responses" | "anthropic" | "gemini" | "azure"

export type ServerKind =
  | "ollama"
  | "vllm"
  | "sglang"
  | "llama.cpp"
  | "lmstudio"
  | "litellm"
  | "tgi"
  | "openai-compatible"
  | "anthropic-compatible"
  | "gemini-compatible"
  | "azure-openai"
  | "unknown"

export interface ProbedModel {
  id: string
  name?: string
  /** Context window the server will actually accept, when it tells us. */
  context?: number
  /** Max output tokens, when the server tells us. */
  output?: number
}

export interface ProbeResult {
  /** Server root with any API suffix stripped, e.g. http://gpu01:8000 or https://gw.corp/llm */
  root: string
  kind: ServerKind
  /** Supported formats, most compatible first. */
  formats: ApiFormat[]
  /** Base URL to give the SDK for each supported format. */
  baseURL: Partial<Record<ApiFormat, string>>
  models: ProbedModel[]
  /** Human-readable findings and warnings. */
  notes: string[]
  /** True when the server rejected our credentials (401/403). */
  authFailed: boolean
}

export interface ProbeOptions {
  apiKey?: string
  /** Extra headers for gateways that need them. */
  headers?: Record<string, string>
  fetch?: typeof fetch
  timeoutMs?: number
}

const SUFFIXES = [
  "/chat/completions",
  "/completions",
  "/responses",
  "/messages",
  "/models",
  "/api/tags",
  "/api/chat",
  "/api/generate",
  "/v1beta",
  "/v1",
]

/** Turn whatever the user pasted into a server root (scheme + host + optional path prefix). */
export function normalizeUrl(input: string): string {
  let s = input.trim()
  if (!s) throw new Error("empty URL")
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    const host = s.split(/[/:]/)[0] ?? ""
    const local = host === "localhost" || /^127\./.test(host) || host === "0.0.0.0" || host === "[::1]"
    s = (local ? "http://" : "https://") + s
  }
  const url = new URL(s)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`unsupported scheme ${url.protocol}`)
  url.search = ""
  url.hash = ""
  let path = url.pathname.replace(/\/+$/, "")
  // Strip known endpoint suffixes repeatedly: ".../v1/chat/completions" -> "..."
  for (let changed = true; changed; ) {
    changed = false
    for (const suf of SUFFIXES) {
      if (path.toLowerCase().endsWith(suf)) {
        path = path.slice(0, -suf.length).replace(/\/+$/, "")
        changed = true
      }
    }
  }
  // Azure keeps its /openai prefix out of the root; the SDK adds it.
  path = path.replace(/\/openai(\/deployments\/[^/]+)?$/i, "")
  return url.origin + path
}

function isAzureHost(root: string): boolean {
  const host = new URL(root).hostname
  return /\.(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/i.test(host)
}

interface Hit {
  status: number
  json?: any
  headers?: Headers
}

export async function probe(input: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const root = normalizeUrl(input)
  const doFetch = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? 5000
  const notes: string[] = []
  let authFailed = false

  const bearer: Record<string, string> = opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}
  const anthropicHeaders: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    ...(opts.apiKey ? { "x-api-key": opts.apiKey } : {}),
  }
  const googleHeaders: Record<string, string> = opts.apiKey ? { "x-goog-api-key": opts.apiKey } : {}

  async function hit(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Hit> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await doFetch(root + path, {
        method: init.method ?? "GET",
        headers: { accept: "application/json", ...opts.headers, ...init.headers },
        body: init.body,
        signal: ctrl.signal,
        redirect: "manual",
      })
      if (res.status === 401 || res.status === 403) authFailed = true
      let json: any
      const type = res.headers.get("content-type") ?? ""
      if (type.includes("json")) json = await res.json().catch(() => undefined)
      else await res.body?.cancel().catch(() => {})
      return { status: res.status, json, headers: res.headers }
    } catch {
      return { status: 0 }
    } finally {
      clearTimeout(timer)
    }
  }

  // A real endpoint rejects "{}" with 400/401/422 (some, like llama.cpp, with a JSON 500).
  // A missing one gives 404/405, a redirect, or a non-JSON error page.
  // Gateways often check auth before routing, so with a key a 401/403 proves nothing about the route.
  const exists = (h: Hit) => {
    if (h.status === 0 || h.status === 404 || h.status === 405) return false
    if (h.status === 401 || h.status === 403) return !opts.apiKey
    if (h.status >= 300 && h.status < 400) return false
    if (h.status >= 500) return h.json !== undefined && h.status !== 502 && h.status !== 503 && h.status !== 504
    return true
  }
  const post = (path: string, headers: Record<string, string> = {}) =>
    hit(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" })

  if (isAzureHost(root)) {
    notes.push("Azure OpenAI host detected: models are your deployment names.")
    return { root, kind: "azure-openai", formats: ["azure"], baseURL: { azure: root + "/openai" }, models: [], notes, authFailed }
  }

  // Round 1: model lists and server fingerprints, in parallel.
  const [v1Models, models, ollamaTags, geminiModels, props, lmstudio, tgiInfo, litellm] = await Promise.all([
    hit("/v1/models", { headers: { ...bearer, ...anthropicHeaders } }),
    hit("/models", { headers: bearer }),
    hit("/api/tags"),
    hit("/v1beta/models", { headers: googleHeaders }),
    hit("/props"),
    hit("/api/v0/models"),
    hit("/info"),
    hit("/model/info", { headers: bearer }),
  ])

  const list = (h: Hit): any[] | undefined => (Array.isArray(h.json?.data) ? h.json.data : undefined)
  let openaiBase: string | undefined
  let openaiItems: any[] | undefined
  if (list(v1Models)) {
    openaiBase = root + "/v1"
    openaiItems = list(v1Models)
  } else if (list(models)) {
    openaiBase = root
    openaiItems = list(models)
  }

  let kind: ServerKind = "unknown"
  const out: ProbedModel[] = []
  const formats: ApiFormat[] = []
  const baseURL: Partial<Record<ApiFormat, string>> = {}

  const anthropicStyleList = openaiItems?.length && openaiItems.every((m) => m?.type === "model" && "display_name" in m)

  if (Array.isArray(ollamaTags.json?.models)) {
    kind = "ollama"
    for (const m of ollamaTags.json.models) if (m?.name) out.push({ id: String(m.name) })
    openaiBase = root + "/v1"
  } else if (anthropicStyleList) {
    kind = "anthropic-compatible"
    for (const m of openaiItems!) out.push({ id: String(m.id), name: m.display_name ? String(m.display_name) : undefined })
    openaiBase = undefined
  } else if (openaiItems) {
    const owners = new Set(openaiItems.map((m) => String(m?.owned_by ?? "").toLowerCase()))
    if (owners.has("vllm")) kind = "vllm"
    else if (owners.has("sglang")) kind = "sglang"
    else if (owners.has("llamacpp") || props.json?.default_generation_settings) kind = "llama.cpp"
    else if (list(lmstudio)) kind = "lmstudio"
    else if (list(litellm)) kind = "litellm"
    else kind = "openai-compatible"
    for (const m of openaiItems) {
      if (!m?.id) continue
      const pm: ProbedModel = { id: String(m.id) }
      const ctx = Number(m.max_model_len ?? m.context_length ?? m.context_window ?? 0)
      if (ctx > 0) pm.context = ctx
      out.push(pm)
    }
  } else if (Array.isArray(geminiModels.json?.models)) {
    kind = "gemini-compatible"
    for (const m of geminiModels.json.models) {
      const methods: string[] = m?.supportedGenerationMethods ?? ["generateContent"]
      if (!methods.includes("generateContent")) continue
      const id = String(m.name ?? "").replace(/^models\//, "")
      if (!id) continue
      out.push({
        id,
        name: m.displayName ? String(m.displayName) : undefined,
        context: Number(m.inputTokenLimit) || undefined,
        output: Number(m.outputTokenLimit) || undefined,
      })
    }
  } else if (tgiInfo.json?.model_id) {
    kind = "tgi"
    openaiBase = root + "/v1"
    out.push({ id: String(tgiInfo.json.model_id), context: Number(tgiInfo.json.max_input_tokens) || undefined })
  }

  // Round 2: which chat endpoints exist, and context windows from server-specific APIs.
  const checks: Promise<void>[] = []
  if (kind !== "gemini-compatible") {
    const base = openaiBase ?? root + "/v1"
    const basePath = base.slice(root.length)
    checks.push(
      post(basePath + "/chat/completions", bearer).then((h) => {
        if (exists(h)) {
          formats.push("openai-chat")
          baseURL["openai-chat"] = base
        }
      }),
      post(basePath + "/responses", bearer).then((h) => {
        if (exists(h)) {
          formats.push("openai-responses")
          baseURL["openai-responses"] = base
        }
      }),
      post("/v1/messages", { ...bearer, ...anthropicHeaders }).then((h) => {
        if (exists(h)) {
          formats.push("anthropic")
          baseURL.anthropic = root + "/v1"
        }
      }),
    )
  } else {
    formats.push("gemini")
    baseURL.gemini = root + "/v1beta"
  }

  if (kind === "llama.cpp") {
    const n = Number(props.json?.default_generation_settings?.n_ctx ?? props.json?.n_ctx ?? 0)
    if (n > 0) for (const m of out) m.context = n
  }
  if (kind === "lmstudio") {
    const byId = new Map<string, any>((list(lmstudio) ?? []).map((m) => [String(m.id), m]))
    for (const m of out) {
      const info = byId.get(m.id)
      const n = Number(info?.loaded_context_length ?? info?.max_context_length ?? 0)
      if (n > 0) m.context = n
    }
  }
  if (kind === "litellm") {
    const byName = new Map<string, any>((list(litellm) ?? []).map((m) => [String(m.model_name), m.model_info ?? {}]))
    for (const m of out) {
      const info = byName.get(m.id)
      if (Number(info?.max_input_tokens) > 0) m.context = Number(info.max_input_tokens)
      if (Number(info?.max_output_tokens) > 0) m.output = Number(info.max_output_tokens)
    }
  }
  if (kind === "ollama") {
    checks.push(
      hit("/api/ps").then((h) => {
        const running = new Map<string, number>()
        for (const m of h.json?.models ?? []) if (m?.name && m?.context_length) running.set(String(m.name), Number(m.context_length))
        for (const m of out) {
          const n = running.get(m.id)
          if (n) m.context = n
        }
      }),
    )
    notes.push(
      "Ollama: its OpenAI endpoint ignores per-request context size. Set OLLAMA_CONTEXT_LENGTH (32768 or more) where Ollama runs, or long sessions get silently truncated.",
    )
  }
  await Promise.all(checks)

  // Most compatible first.
  const order: ApiFormat[] = ["openai-chat", "anthropic", "openai-responses", "gemini", "azure"]
  formats.sort((a, b) => order.indexOf(a) - order.indexOf(b))

  if (kind === "unknown" && formats.length) kind = formats[0] === "anthropic" ? "anthropic-compatible" : "openai-compatible"
  if (authFailed && !out.length) notes.push("The server rejected the request (401/403): check the API key.")
  if (!formats.length && !authFailed) notes.push("No chat endpoint answered. Check the URL, port, and that the server is running.")
  if (kind === "llama.cpp") notes.push("llama.cpp: start llama-server with --jinja, or tool calls will not work.")
  if (out.length && out.every((m) => !m.context)) notes.push("The server did not report context sizes; set them with --context if you know them.")

  return { root, kind, formats, baseURL, models: out, notes, authFailed }
}
