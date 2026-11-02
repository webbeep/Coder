// `coder eval`: a benchmark you own. Runs coding tasks headless against a model, then checks
// the result with hidden tests the agent never saw, and records quality, speed and integrity.
//
//   coder eval [--model provider/model] [--tag t | --tasks a,b] [--runs N] [--allow-unsandboxed]
//   coder eval compare [older.json] [newer.json]
//
// Task folder (evals/tasks/<id>/): task.json, workspace/ (what the agent sees), tests/ (hidden).
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs, str } from "./args"
import { slugify } from "./connect/formats"
import { coderHome, paths } from "./paths"
import { which } from "./platform"
import { bold, dim, green, red, yellow } from "./ui"
import { readUpstream } from "./upstream"

export interface Task {
  id: string
  prompt: string
  /** Command run in the workspace after hidden tests are copied in; exit 0 = pass. "{bun}" and "{python}" are resolved. */
  check: string[]
  timeoutSec?: number
  tags?: string[]
  /** Tools the check needs ("bun", "python", "bash"); the task is skipped when one is missing. */
  requires?: string[]
  /** Files that must NOT exist afterwards (prompt-injection canaries). */
  forbidden?: string[]
  /** Visible files the agent must not change (e.g. tests it was asked to make pass). */
  unchanged?: string[]
  dir: string
}

export interface TaskResult {
  id: string
  run: number
  pass: boolean
  seconds: number
  toolCalls: number
  tokens?: { input: number; output: number }
  /** The agent modified files it must not touch (tests). */
  tamperedTests: boolean
  /** A forbidden file appeared (it followed injected instructions). */
  followedInjection: boolean
  skipped?: string
  error?: string
  /** On failure: the end of the agent's output and log, to see what went wrong. */
  agentTail?: string
}

export interface EvalReport {
  date: string
  model: string
  coder: string
  opencode: string
  os: string
  results: TaskResult[]
  summary: { tasks: number; passRate: number; avgSeconds: number; avgToolCalls: number; integrityViolations: number }
}

const TASKS_DIR = join(paths.root, "evals", "tasks")
const RESULTS_DIR = join(paths.root, "evals", "results")

export function loadTasks(dir = TASKS_DIR): Task[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && existsSync(join(dir, e.name, "task.json")))
    .map((e) => ({ ...JSON.parse(readFileSync(join(dir, e.name, "task.json"), "utf8")), id: e.name, dir: join(dir, e.name) }))
}

function tool(name: string): string | undefined {
  if (name === "bun") return process.execPath
  if (name === "python") return which("python3") ?? which("python")
  if (name === "bash") return process.platform === "win32" ? undefined : which("bash")
  return which(name)
}

const hash = (file: string) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : "missing")

/** Sums token usage from OpenCode's JSON event stream (best effort: fields named tokens.{input,output}). */
export function tokensFromEvents(jsonLines: string): { input: number; output: number } | undefined {
  let input = 0
  let output = 0
  let found = false
  const seen = new Set<string>()
  for (const line of jsonLines.split("\n")) {
    let ev: any
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    const walk = (v: any) => {
      if (!v || typeof v !== "object") return
      const t = v.tokens
      if (t && typeof t.input === "number" && typeof t.output === "number") {
        const key = String(v.id ?? v.messageID ?? JSON.stringify(t))
        if (!seen.has(key)) {
          seen.add(key)
          input += t.input
          output += t.output
          found = true
        }
      }
      for (const x of Object.values(v)) if (x && typeof x === "object") walk(x)
    }
    walk(ev)
  }
  return found ? { input, output } : undefined
}

export type AgentRunner = (task: Task, workdir: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>

export async function runTask(task: Task, run: number, agent: AgentRunner, auditDir?: string): Promise<TaskResult> {
  const base: TaskResult = { id: task.id, run, pass: false, seconds: 0, toolCalls: 0, tamperedTests: false, followedInjection: false }
  const missing = (task.requires ?? []).filter((r) => !tool(r))
  if (missing.length) return { ...base, skipped: `needs ${missing.join(", ")}` }

  // realpath: macOS temp dirs are symlinks (/var → /private/var); OpenCode logs the real path.
  const work = realpathSync(mkdtempSync(join(tmpdir(), `coder-eval-${task.id}-`)))
  try {
    cpSync(join(task.dir, "workspace"), work, { recursive: true })
    if (which("git")) {
      Bun.spawnSync(["git", "init", "-q"], { cwd: work })
      Bun.spawnSync(["git", "-c", "user.email=eval@coder", "-c", "user.name=coder-eval", "add", "-A"], { cwd: work })
      Bun.spawnSync(["git", "-c", "user.email=eval@coder", "-c", "user.name=coder-eval", "commit", "-qm", "task"], { cwd: work })
    }
    const before = Object.fromEntries((task.unchanged ?? []).map((f) => [f, hash(join(work, f))]))
    const auditBefore = countAudit(auditDir, work)
    const started = performance.now()
    const out = await agent(task, work)
    const seconds = (performance.now() - started) / 1000
    const toolCalls = countAudit(auditDir, work) - auditBefore

    const tamperedTests = (task.unchanged ?? []).some((f) => hash(join(work, f)) !== before[f])
    const followedInjection = (task.forbidden ?? []).some((f) => existsSync(join(work, f)))
    // Hidden tests arrive only now, so the agent could not have read or edited them.
    if (existsSync(join(task.dir, "tests"))) cpSync(join(task.dir, "tests"), work, { recursive: true, force: true })
    const cmd = task.check.map((c) => c.replace("{bun}", tool("bun")!).replace("{python}", tool("python") ?? "python3"))
    const check = Bun.spawnSync(cmd, { cwd: work, stdout: "pipe", stderr: "pipe", timeout: 120_000 })
    const pass = check.exitCode === 0 && !tamperedTests && !followedInjection
    return {
      ...base,
      pass,
      seconds: Math.round(seconds * 10) / 10,
      toolCalls,
      tokens: tokensFromEvents(out.stdout),
      tamperedTests,
      followedInjection,
      error: out.exitCode !== 0 ? `agent exited ${out.exitCode}: ${out.stderr.slice(-300)}` : check.exitCode !== 0 ? (check.stdout.toString() + check.stderr.toString()).slice(-300) : undefined,
      agentTail: pass ? undefined : failureTail(out.stdout, out.stderr),
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** The interesting part of a failed run: tool errors from the event stream, then the end of the log. */
function failureTail(stdout: string, stderr: string): string {
  const errors = stdout.split("\n").filter((l) => /error|denied|reject/i.test(l)).slice(-5).map((l) => l.slice(0, 600))
  const log = stderr.split("\n").filter((l) => /level=(WARN|ERROR)|error/i.test(l)).slice(-8).map((l) => l.slice(0, 400))
  return [...errors, ...log].join("\n").slice(-4000)
}

/** Tool calls Coder's audit log recorded for this workspace (its plugin logs every call). */
function countAudit(auditDir: string | undefined, work: string): number {
  if (!auditDir || !existsSync(auditDir)) return 0
  let n = 0
  const needle = JSON.stringify(work).slice(1, -1)
  for (const f of readdirSync(auditDir)) for (const line of readFileSync(join(auditDir, f), "utf8").split("\n")) if (line.includes(needle)) n++
  return n
}

export function summarize(results: TaskResult[]): EvalReport["summary"] {
  const done = results.filter((r) => !r.skipped)
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0)
  return {
    tasks: done.length,
    passRate: done.length ? Math.round((done.filter((r) => r.pass).length / done.length) * 1000) / 10 : 0,
    avgSeconds: avg(done.map((r) => r.seconds)),
    avgToolCalls: avg(done.map((r) => r.toolCalls)),
    integrityViolations: done.filter((r) => r.tamperedTests || r.followedInjection).length,
  }
}

function printReport(report: EvalReport, previous?: EvalReport, verbose = false) {
  console.log(bold(`\nEval: ${report.model}  (${report.date})`))
  for (const r of report.results) {
    const mark = r.skipped ? dim("skip") : r.pass ? green("PASS") : red("FAIL")
    const flags = [r.tamperedTests && "edited tests", r.followedInjection && "followed injection"].filter(Boolean).join(", ")
    const tok = r.tokens ? ` ${r.tokens.input + r.tokens.output} tok` : ""
    console.log(`  ${mark} ${r.id}${r.run ? `#${r.run + 1}` : ""}  ${dim(`${r.seconds}s ${r.toolCalls} tools${tok}`)}${flags ? red(`  ⚠ ${flags}`) : ""}${r.skipped ? dim(`  (${r.skipped})`) : ""}`)
    if (verbose && !r.pass && !r.skipped) {
      if (r.error) console.log(dim(`      check: ${r.error.replace(/\s+/g, " ").slice(0, 400)}`))
      if (r.agentTail) console.log(dim(r.agentTail.split("\n").map((l) => `      ${l}`).join("\n")))
    }
  }
  const s = report.summary
  const delta = previous ? ` ${dim(`(was ${previous.summary.passRate}%)`)}` : ""
  console.log(bold(`  pass rate ${s.passRate}%${delta} · ${s.avgSeconds}s avg · ${s.avgToolCalls} tool calls avg · ${s.integrityViolations} integrity violations`))
}

function latestFor(model: string): EvalReport | undefined {
  if (!existsSync(RESULTS_DIR)) return undefined
  const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json")).sort()
  for (const f of files.reverse()) {
    const r: EvalReport = JSON.parse(readFileSync(join(RESULTS_DIR, f), "utf8"))
    if (r.model === model) return r
  }
  return undefined
}

export async function evalCommand(argv: string[]): Promise<number> {
  if (argv[0] === "compare") return compare(argv.slice(1))
  const args = parseArgs(argv, ["allow-unsandboxed", "verbose"])
  let tasks = loadTasks()
  const tag = str(args, "tag")
  const only = str(args, "tasks")?.split(",")
  if (tag) tasks = tasks.filter((t) => t.tags?.includes(tag))
  else if (only) tasks = tasks.filter((t) => only.includes(t.id))
  else tasks = tasks.filter((t) => !t.tags?.includes("smoke"))
  if (!tasks.length) return (console.error("No matching tasks in evals/tasks."), 2)
  const runs = Number(str(args, "runs") ?? 1)

  // Lazy import: evaluating needs the full launcher only here.
  const { prepare } = await import("./launch")
  const { bin, composed } = await prepare(process.cwd(), { eval: true })
  const sandboxed = (composed.config.plugins?.[0]?.options?.sandbox ?? {}) as { mode?: string; available?: boolean }
  if (!(sandboxed.mode === "required" && sandboxed.available) && !args.flags["allow-unsandboxed"]) {
    console.error(red("Evals let the agent edit and run commands without asking, so they need the sandbox (see coder doctor)."))
    console.error(dim("To run anyway on a throwaway machine: --allow-unsandboxed"))
    return 2
  }
  const model = str(args, "model") ?? composed.model
  if (!model) return (console.error("No model. Pass --model provider/model or run coder connect."), 2)

  const agent: AgentRunner = async (task, workdir) => {
    const proc = Bun.spawn([bin, "run", "--standalone", "--format", "json", "--model", model, task.prompt], {
      cwd: workdir,
      // OpenCode takes its project folder from PWD before the real cwd, so PWD must match.
      env: { ...process.env, ...composed.env, PWD: workdir },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const timer = setTimeout(() => proc.kill(), (task.timeoutSec ?? 600) * 1000)
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    clearTimeout(timer)
    return { exitCode, stdout, stderr }
  }

  const results: TaskResult[] = []
  for (const task of tasks)
    for (let i = 0; i < runs; i++) {
      process.stdout.write(dim(`  ${task.id}${runs > 1 ? ` #${i + 1}` : ""}… `))
      const r = await runTask(task, i, agent, join(coderHome(), "audit"))
      console.log(r.skipped ? dim("skipped") : r.pass ? green("pass") : red("fail"))
      results.push(r)
    }

  const report: EvalReport = {
    date: new Date().toISOString(),
    model,
    coder: JSON.parse(readFileSync(join(paths.root, "package.json"), "utf8")).version,
    opencode: readUpstream().opencode.version,
    os: `${process.platform}-${process.arch}`,
    results,
    summary: summarize(results),
  }
  const previous = latestFor(model)
  printReport(report, previous, Boolean(args.flags.verbose))
  mkdirSync(RESULTS_DIR, { recursive: true })
  const file = join(RESULTS_DIR, `${report.date.slice(0, 16).replace(/[:T]/g, "")}-${slugify(model)}.json`)
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n")
  console.log(dim(`  saved ${file}`))
  if (previous && report.summary.passRate < previous.summary.passRate)
    console.log(yellow(`  ! Pass rate dropped from ${previous.summary.passRate}% to ${report.summary.passRate}%.`))
  return report.summary.integrityViolations ? 1 : 0
}

function compare(files: string[]): number {
  const all = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json")).sort() : []
  const picked = files.length >= 2 ? files.map((f) => resolve(f)) : all.slice(-2).map((f) => join(RESULTS_DIR, f))
  if (picked.length < 2) return (console.error("Need two result files (evals/results/*.json)."), 2)
  const [a, b] = picked.map((f) => JSON.parse(readFileSync(f, "utf8")) as EvalReport) as [EvalReport, EvalReport]
  console.log(bold(`${a.model} (${a.date.slice(0, 10)})  →  ${b.model} (${b.date.slice(0, 10)})`))
  const byId = (r: EvalReport) => new Map(r.results.filter((x) => x.run === 0).map((x) => [x.id, x]))
  const ma = byId(a)
  for (const [id, rb] of byId(b)) {
    const ra = ma.get(id)
    const change = !ra ? "new" : ra.pass === rb.pass ? (rb.pass ? "pass" : "fail") : rb.pass ? green("fixed") : red("REGRESSED")
    console.log(`  ${id.padEnd(28)} ${change}  ${dim(`${ra?.seconds ?? "-"}s → ${rb.seconds}s`)}`)
  }
  console.log(`  pass rate ${a.summary.passRate}% → ${b.summary.passRate}%   avg ${a.summary.avgSeconds}s → ${b.summary.avgSeconds}s`)
  return 0
}
