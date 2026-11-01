// Maps a probed server to an OpenCode v2 provider entry. Every package below
// is built into the pinned OpenCode binary, so nothing is downloaded at runtime.
import type { ApiFormat, ProbedModel, ProbeResult } from "./probe"

export const PACKAGES: Record<ApiFormat, string> = {
  "openai-chat": "@opencode/ai/providers/openai-compatible",
  "openai-responses": "@opencode/ai/providers/openai-compatible/responses",
  anthropic: "@opencode/ai/providers/anthropic-compatible",
  gemini: "@opencode/ai/providers/google",
  azure: "@opencode/ai/providers/azure/chat",
}

export const FORMAT_LABELS: Record<ApiFormat, string> = {
  "openai-chat": "OpenAI Chat Completions (vLLM, SGLang, llama.cpp, Ollama, LM Studio, LiteLLM, TGI…)",
  "openai-responses": "OpenAI Responses API",
  anthropic: "Anthropic Messages API",
  gemini: "Google Gemini API",
  azure: "Azure OpenAI",
}

export interface ProviderModel {
  name?: string
  limit?: { context?: number; output?: number }
  capabilities?: { input?: string[]; tools?: boolean }
}

export interface ProviderEntry {
  name: string
  package: string
  settings: Record<string, unknown>
  models: Record<string, ProviderModel>
}

export interface BuildOptions {
  displayName: string
  format: ApiFormat
  /** Config reference for the key, e.g. "{file:/home/me/.config/coder/secrets/company.key}" or "{env:CODER_KEY}". */
  apiKeyRef?: string
  /** Only include these model ids (default: all probed). */
  only?: string[]
  /** Override context window for all models. */
  context?: number
  /** Allow image input (default: text only, safest for self-hosted models). */
  vision?: boolean
  /** Azure API version. */
  apiVersion?: string
}

/** Output budget when the server doesn't say: leave most of the window for the prompt. */
export function outputBudget(context: number): number {
  return Math.max(1024, Math.min(32768, Math.floor(context / 4)))
}

export function modelEntry(m: ProbedModel, opts: Pick<BuildOptions, "context" | "vision">): ProviderModel {
  const entry: ProviderModel = {}
  if (m.name) entry.name = m.name
  const context = opts.context ?? m.context
  if (context) entry.limit = { context, output: m.output ?? outputBudget(context) }
  entry.capabilities = { tools: true, input: opts.vision ? ["text", "image"] : ["text"] }
  return entry
}

export function buildProvider(probe: ProbeResult, opts: BuildOptions): ProviderEntry {
  const baseURL = probe.baseURL[opts.format]
  if (!baseURL) throw new Error(`The server does not support ${FORMAT_LABELS[opts.format]}.`)
  const settings: Record<string, unknown> = { baseURL }
  if (opts.apiKeyRef) settings.apiKey = opts.apiKeyRef
  if (opts.format === "azure") settings.apiVersion = opts.apiVersion ?? "2025-04-01-preview"
  const wanted = opts.only?.length ? new Set(opts.only) : undefined
  const models: Record<string, ProviderModel> = {}
  for (const m of probe.models) {
    if (wanted && !wanted.has(m.id)) continue
    models[m.id] = modelEntry(m, opts)
  }
  // Servers that can't list models (Azure deployments, some gateways): add requested ids as-is.
  for (const id of opts.only ?? []) if (!models[id]) models[id] = modelEntry({ id }, opts)
  return { name: opts.displayName, package: PACKAGES[opts.format], settings, models }
}

/** Provider ids become part of model references ("company/model"), so keep them simple. */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return s || "server"
}
