// One tiny request that checks the model can actually call tools through this
// server/format. Agents are useless without tool calls, and broken tool-call
// parsing (wrong vLLM parser, llama.cpp without --jinja) is the #1 setup issue.
import type { ApiFormat } from "./probe"

export interface ToolCheck {
  ok: boolean
  detail: string
}

export async function checkToolCalling(opts: {
  format: ApiFormat
  baseURL: string
  model: string
  apiKey?: string
  fetch?: typeof fetch
  timeoutMs?: number
}): Promise<ToolCheck> {
  const doFetch = opts.fetch ?? fetch
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 120_000)
  const prompt = "Call the get_time tool with timezone UTC. Do not answer in text."
  try {
    if (opts.format === "openai-chat") {
      const res = await doFetch(`${opts.baseURL}/chat/completions`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: 256,
          messages: [{ role: "user", content: prompt }],
          tools: [
            {
              type: "function",
              function: {
                name: "get_time",
                description: "Get the current time",
                parameters: { type: "object", properties: { timezone: { type: "string" } }, required: ["timezone"] },
              },
            },
          ],
        }),
      })
      const body: any = await res.json().catch(() => undefined)
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${JSON.stringify(body?.error ?? body ?? "").slice(0, 300)}` }
      const call = body?.choices?.[0]?.message?.tool_calls?.[0]
      if (call?.function?.name === "get_time") return { ok: true, detail: `tool call received (${call.function.arguments})` }
      const text = String(body?.choices?.[0]?.message?.content ?? "").slice(0, 160)
      return { ok: false, detail: `no tool call in the reply${text ? `; it answered: "${text}"` : ""}` }
    }
    if (opts.format === "anthropic") {
      const res = await doFetch(`${opts.baseURL}/messages`, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          ...(opts.apiKey ? { "x-api-key": opts.apiKey } : {}),
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: 256,
          messages: [{ role: "user", content: prompt }],
          tools: [
            {
              name: "get_time",
              description: "Get the current time",
              input_schema: { type: "object", properties: { timezone: { type: "string" } }, required: ["timezone"] },
            },
          ],
        }),
      })
      const body: any = await res.json().catch(() => undefined)
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${JSON.stringify(body?.error ?? body ?? "").slice(0, 300)}` }
      const call = (body?.content ?? []).find((b: any) => b?.type === "tool_use")
      if (call?.name === "get_time") return { ok: true, detail: `tool call received (${JSON.stringify(call.input)})` }
      return { ok: false, detail: "no tool_use block in the reply" }
    }
    return { ok: true, detail: `skipped (no quick check for ${opts.format})` }
  } catch (e) {
    return { ok: false, detail: (e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message }
  }
}
