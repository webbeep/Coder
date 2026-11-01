// End-to-end check, run in CI on Windows, macOS and Linux:
//   1. a mock OpenAI-compatible model server (streams like vLLM)
//   2. `coder connect` against it
//   3. `coder opencode run` with the real, pinned OpenCode binary and Coder's config + plugin
// The mock asks the agent to read hello.txt, then answers with what it read, so the test
// proves: install + checksum, config accepted, provider wiring, tool calls, plugin loaded.
//
// Usage: bun test/e2e/run.ts
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { appendFileSync } from "node:fs"
import { join, resolve } from "node:path"
import budgets from "./budgets.json"

const ROOT = resolve(import.meta.dir, "..", "..")
// On Windows, call the CLI the way coder.cmd does (spawning .cmd files directly is unreliable).
const launcher = process.platform === "win32" ? [process.execPath, join(ROOT, "src", "cli.ts")] : [join(ROOT, "coder")]
const work = mkdtempSync(join(tmpdir(), "coder-e2e-"))
const home = join(work, "home")
const project = join(work, "project")
mkdirSync(project, { recursive: true })
writeFileSync(join(project, "hello.txt"), "hello from e2e\n")

const requests: any[] = []
let firstAgentRequestChars = 0
const sse = (chunks: unknown[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  })
const chunk = (delta: unknown, finish: string | null = null) => ({
  id: "e2e",
  object: "chat.completion.chunk",
  created: 0,
  model: "mock-coder",
  choices: [{ index: 0, delta, finish_reason: finish }],
})
const text = (s: string, stream: boolean) =>
  stream
    ? sse([chunk({ role: "assistant", content: s }), { ...chunk({}, "stop"), usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }])
    : Response.json({ id: "e2e", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: s }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method === "GET" && url.pathname === "/v1/models")
      return Response.json({ object: "list", data: [{ id: "mock-coder", owned_by: "vllm", max_model_len: 32768 }] })
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 })
    const body: any = await req.json().catch(() => ({}))
    if (!body.model) return Response.json({ error: "model required" }, { status: 400 })
    requests.push(body)
    if (!firstAgentRequestChars && (body.tools ?? []).length) {
      // What Coder + OpenCode put in front of the model before any user content: system prompt + tool definitions.
      const system = (body.messages ?? []).filter((m: any) => m.role === "system")
      firstAgentRequestChars = JSON.stringify(system).length + JSON.stringify(body.tools).length
    }
    const stream = body.stream === true
    const tools: string[] = (body.tools ?? []).map((t: any) => t?.function?.name)
    if (!tools.length) return text("E2E title", stream)
    if (!tools.includes("read")) return text(`E2E_NO_READ_TOOL tools=${tools.join(",")}`, stream)
    const toolResult = (body.messages ?? []).find((m: any) => m.role === "tool")
    if (toolResult) {
      const content = typeof toolResult.content === "string" ? toolResult.content : JSON.stringify(toolResult.content)
      return text(`E2E_OK ${content.includes("hello from e2e") ? "saw-file" : "missing-file"}`, stream)
    }
    const args = JSON.stringify({ path: "hello.txt" })
    if (!stream)
      return Response.json({
        id: "e2e",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: args } }] }, finish_reason: "tool_calls" }],
      })
    return sse([
      chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read", arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: args } }] }),
      { ...chunk({}, "tool_calls"), usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    ])
  },
})

// OPENCODE_PRINT_LOGS shows the OpenCode server's own log on stderr, so failures are diagnosable.
const env = { ...process.env, CODER_HOME: home, NO_COLOR: "1", OPENCODE_PRINT_LOGS: "1" }
async function coder(args: string[], timeoutMs = 300_000) {
  const proc = Bun.spawn([...launcher, ...args], { cwd: project, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" })
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  clearTimeout(timer)
  console.log(`$ coder ${args.join(" ")}  → exit ${code}\n${out}${err ? `[stderr]\n${err}` : ""}`)
  return { out, err, code }
}

let failed = false
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`)
  if (!ok) failed = true
}

try {
  const base = `http://127.0.0.1:${server.port}/v1`
  const connect = await coder(["connect", base, "--name", "e2e", "--no-key", "--yes", "--no-test"])
  check(connect.code === 0, "coder connect")

  // Sample the RSS of every process running the pinned OpenCode binary (CLI + its server) while the agent works.
  let peakKB = 0
  const sampler =
    process.platform === "win32"
      ? undefined
      : setInterval(() => {
          const ps = Bun.spawnSync(["ps", "-A", "-o", "rss=", "-o", "args="]).stdout.toString()
          let total = 0
          for (const line of ps.split("\n")) if (line.includes(join(".coder", "opencode"))) total += Number(line.trim().split(/\s+/)[0]) || 0
          peakKB = Math.max(peakKB, total)
        }, 100)
  const started = performance.now()
  const run = await coder(["opencode", "run", "--standalone", "Read hello.txt and report what it says."])
  const seconds = (performance.now() - started) / 1000
  if (sampler) clearInterval(sampler)
  const all = run.out + run.err
  check(run.code === 0, "coder opencode run exits 0")
  check(all.includes("E2E_OK saw-file"), "agent called the read tool and answered with its result")
  check(requests.some((r) => (r.tools ?? []).length > 0), "OpenCode sent tool definitions to the self-hosted model")

  const auditDir = join(home, "audit")
  let audit = ""
  try {
    audit = readdirSync(auditDir).map((f) => readFileSync(join(auditDir, f), "utf8")).join("")
  } catch {}
  check(audit.includes('"tool":"read"'), "Coder plugin loaded (audit log recorded the read call)")

  const contextTokens = Math.round(firstAgentRequestChars / 4)
  const peakMB = Math.round(peakKB / 1024)
  check(contextTokens > 0 && contextTokens <= budgets.maxContextTokens, `context overhead ~${contextTokens} tokens (budget ${budgets.maxContextTokens})`)
  if (peakKB) check(peakMB <= budgets.maxPeakRssMB, `peak RAM of OpenCode processes ${peakMB} MB (budget ${budgets.maxPeakRssMB})`)
  check(seconds <= budgets.maxRunSeconds, `agent run took ${seconds.toFixed(1)} s (budget ${budgets.maxRunSeconds})`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Coder end-to-end (${process.platform})\n\n| Metric | Value | Budget |\n|---|---|---|\n` +
        `| Context overhead (system prompt + tools) | ~${contextTokens} tokens | ${budgets.maxContextTokens} |\n` +
        `| Peak RAM, OpenCode processes | ${peakKB ? `${peakMB} MB` : "n/a"} | ${budgets.maxPeakRssMB} MB |\n` +
        `| Wall time, start to answer | ${seconds.toFixed(1)} s | ${budgets.maxRunSeconds} s |\n\n`,
    )
  }
} finally {
  server.stop(true)
}
process.exit(failed ? 1 : 0)
