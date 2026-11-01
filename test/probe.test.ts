import { afterAll, describe, expect, test } from "bun:test"
import { normalizeUrl, probe } from "../src/connect/probe"

type Route = (req: Request) => Response | undefined
const json = (body: unknown, status = 200) => Response.json(body, { status })
const servers: { stop: (force?: boolean) => void }[] = []

/** Starts a mock server; unknown routes 404 like real servers. */
function mock(routes: Record<string, Route>): string {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url)
      const route = routes[`${req.method} ${url.pathname}`]
      return route?.(req) ?? new Response("not found", { status: 404 })
    },
  })
  servers.push(server)
  return `http://127.0.0.1:${server.port}`
}
afterAll(() => servers.forEach((s) => s.stop(true)))

const chatOk: Route = () => json({ error: { message: "messages is required" } }, 400)

describe("normalizeUrl", () => {
  test("strips endpoint suffixes and keeps path prefixes", () => {
    expect(normalizeUrl("http://gpu01:8000/v1/chat/completions")).toBe("http://gpu01:8000")
    expect(normalizeUrl("https://gw.corp/llm/v1/")).toBe("https://gw.corp/llm")
    expect(normalizeUrl("http://localhost:11434/api/tags")).toBe("http://localhost:11434")
    expect(normalizeUrl("https://x.example/v1/messages")).toBe("https://x.example")
  })
  test("defaults scheme: http for localhost, https otherwise", () => {
    expect(normalizeUrl("localhost:8080")).toBe("http://localhost:8080")
    expect(normalizeUrl("127.0.0.1:8080/v1")).toBe("http://127.0.0.1:8080")
    expect(normalizeUrl("llm.corp.internal")).toBe("https://llm.corp.internal")
  })
  test("rejects non-http schemes", () => {
    expect(() => normalizeUrl("file:///etc/passwd")).toThrow()
  })
})

describe("probe", () => {
  test("vLLM: models with max_model_len, chat + responses", async () => {
    const url = mock({
      "GET /v1/models": () => json({ object: "list", data: [{ id: "deepseek-v4-flash", owned_by: "vllm", max_model_len: 131072 }] }),
      "POST /v1/chat/completions": () => json({ detail: "validation" }, 422),
      "POST /v1/responses": () => json({ detail: "validation" }, 422),
    })
    const r = await probe(url + "/v1")
    expect(r.kind).toBe("vllm")
    expect(r.formats).toEqual(["openai-chat", "openai-responses"])
    expect(r.baseURL["openai-chat"]).toBe(url + "/v1")
    expect(r.models).toEqual([{ id: "deepseek-v4-flash", context: 131072 }])
  })

  test("Ollama: native tag list, OpenAI + Anthropic endpoints, running context", async () => {
    const url = mock({
      "GET /api/tags": () => json({ models: [{ name: "qwen3.8:27b" }, { name: "devstral:24b" }] }),
      "GET /api/ps": () => json({ models: [{ name: "qwen3.8:27b", context_length: 65536 }] }),
      "GET /v1/models": () => json({ object: "list", data: [{ id: "qwen3.8:27b", owned_by: "library" }] }),
      "POST /v1/chat/completions": chatOk,
      "POST /v1/messages": chatOk,
    })
    const r = await probe(url)
    expect(r.kind).toBe("ollama")
    expect(r.formats).toEqual(["openai-chat", "anthropic"])
    expect(r.models).toEqual([{ id: "qwen3.8:27b", context: 65536 }, { id: "devstral:24b" }])
    expect(r.notes.join(" ")).toContain("OLLAMA_CONTEXT_LENGTH")
  })

  test("llama.cpp: n_ctx from /props, JSON 500 still counts as endpoint", async () => {
    const url = mock({
      "GET /v1/models": () => json({ object: "list", data: [{ id: "model.gguf", owned_by: "llamacpp" }] }),
      "GET /props": () => json({ default_generation_settings: { n_ctx: 32768 } }),
      "POST /v1/chat/completions": () => json({ error: { code: 500, message: "'messages' is required" } }, 500),
    })
    const r = await probe(url)
    expect(r.kind).toBe("llama.cpp")
    expect(r.formats).toEqual(["openai-chat"])
    expect(r.models[0]?.context).toBe(32768)
    expect(r.notes.join(" ")).toContain("--jinja")
  })

  test("Anthropic-compatible server", async () => {
    const url = mock({
      "GET /v1/models": (req) =>
        req.headers.get("x-api-key") === "k"
          ? json({ data: [{ type: "model", id: "kimi-k3", display_name: "Kimi K3" }], has_more: false })
          : json({ error: "unauthorized" }, 401),
      "POST /v1/messages": chatOk,
    })
    const r = await probe(url, { apiKey: "k" })
    expect(r.kind).toBe("anthropic-compatible")
    expect(r.formats).toEqual(["anthropic"])
    expect(r.baseURL.anthropic).toBe(url + "/v1")
    expect(r.models).toEqual([{ id: "kimi-k3", name: "Kimi K3" }])
  })

  test("Gemini-compatible server", async () => {
    const url = mock({
      "GET /v1beta/models": () =>
        json({
          models: [
            { name: "models/gemma-4-27b", displayName: "Gemma 4", inputTokenLimit: 131072, outputTokenLimit: 8192, supportedGenerationMethods: ["generateContent"] },
            { name: "models/embed", supportedGenerationMethods: ["embedContent"] },
          ],
        }),
    })
    const r = await probe(url)
    expect(r.kind).toBe("gemini-compatible")
    expect(r.formats).toEqual(["gemini"])
    expect(r.models).toEqual([{ id: "gemma-4-27b", name: "Gemma 4", context: 131072, output: 8192 }])
  })

  test("LiteLLM gateway with path prefix and key: context from /model/info", async () => {
    const auth = (req: Request) => req.headers.get("authorization") === "Bearer sk-team"
    const url = mock({
      "GET /llm/v1/models": (req) => (auth(req) ? json({ data: [{ id: "company-coder", owned_by: "openai" }] }) : json({}, 401)),
      "GET /llm/model/info": (req) =>
        auth(req) ? json({ data: [{ model_name: "company-coder", model_info: { max_input_tokens: 200000, max_output_tokens: 32000 } }] }) : json({}, 401),
      "POST /llm/v1/chat/completions": chatOk,
    })
    const r = await probe(url + "/llm/v1/chat/completions", { apiKey: "sk-team" })
    expect(r.root).toBe(url + "/llm")
    expect(r.kind).toBe("litellm")
    expect(r.models).toEqual([{ id: "company-coder", context: 200000, output: 32000 }])
    expect(r.authFailed).toBe(false)
  })

  test("wrong key is reported", async () => {
    const url = mock({
      "GET /v1/models": () => json({ error: "bad key" }, 401),
      "GET /models": () => json({ error: "bad key" }, 401),
      "POST /v1/chat/completions": () => json({ error: "bad key" }, 401),
    })
    const r = await probe(url, { apiKey: "wrong" })
    expect(r.authFailed).toBe(true)
    expect(r.notes.join(" ")).toContain("API key")
  })

  test("Azure host is recognized without network calls", async () => {
    let called = false
    const r = await probe("https://myres.openai.azure.com/openai/deployments/gpt", {
      fetch: (async () => {
        called = true
        return new Response()
      }) as unknown as typeof fetch,
    })
    expect(called).toBe(false)
    expect(r.kind).toBe("azure-openai")
    expect(r.baseURL.azure).toBe("https://myres.openai.azure.com/openai")
  })

  test("nothing listening", async () => {
    const r = await probe("http://127.0.0.1:1", { timeoutMs: 500 })
    expect(r.formats).toEqual([])
    expect(r.models).toEqual([])
    expect(r.notes.join(" ")).toContain("No chat endpoint")
  })
})
