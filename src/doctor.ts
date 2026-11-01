// `coder doctor`: is everything installed, safe, and reachable?
import { existsSync } from "node:fs"
import { join } from "node:path"
import { compose } from "./config"
import { probe } from "./connect/probe"
import { coderHome, paths } from "./paths"
import { detectPlatform, which } from "./platform"
import { detectSandbox } from "./sandbox-status"
import { loadSettings } from "./settings"
import { bold, dim, green, red, yellow } from "./ui"
import { opencodeBinary, readUpstream } from "./upstream"

export async function doctor(argv: string[]): Promise<number> {
  let problems = 0
  const ok = (msg: string) => console.log(`${green("✓")} ${msg}`)
  const warn = (msg: string) => console.log(`${yellow("!")} ${msg}`)
  const bad = (msg: string, fix?: string) => {
    problems++
    console.log(`${red("✗")} ${msg}${fix ? `\n    ${dim(fix)}` : ""}`)
  }

  const platform = detectPlatform()
  const up = readUpstream()
  console.log(bold("Coder doctor"))
  console.log(dim(`  platform ${platform.cliTarget} · Bun ${Bun.version} · OpenCode ${up.opencode.version} (pinned)`))
  console.log(dim(`  Coder folder ${paths.root}`))
  console.log(dim(`  your settings, keys and memory: ${coderHome()}`))
  console.log()

  if (Bun.version !== up.bun.version) warn(`Bun ${Bun.version} is running; Coder is tested with ${up.bun.version}.`)
  const bin = opencodeBinary(up, platform)
  if (existsSync(bin) && existsSync(join(bin, "..", "..", "..", ".verified"))) ok("OpenCode binary installed and checksum-verified")
  else bad("OpenCode binary not installed yet", "Run: ./coder setup")

  const settings = loadSettings()
  const sb = detectSandbox(settings)
  if (sb.mode === "required" && sb.available) {
    ok(`Sandbox ready (${platform.os === "darwin" ? "macOS Seatbelt" : "bubblewrap"}; network allowlist: ${settings.sandbox.allowedDomains.join(", ") || "none"})`)
    if (argv.includes("--test")) {
      const r = Bun.spawnSync([sb.runtime!, sb.srtCli!, "-c", "echo sandbox-ok"], { stderr: "pipe" })
      if (r.stdout.toString().includes("sandbox-ok")) ok("Sandbox test command ran")
      else bad("Sandbox test command failed", r.stderr.toString().trim().slice(0, 400))
    }
  } else if (sb.mode === "required") bad(`Sandbox required but unavailable: ${sb.reason}. Shell commands are blocked.`, sb.fix)
  else if (sb.mode === "ask") warn(`No sandbox (${sb.reason ?? "sandbox.mode is ask"}); every shell command needs approval. ${sb.fix ?? ""}`)
  else bad('Sandbox is OFF (sandbox.mode "off"): commands run with your full permissions.')

  if (!which("rg")) warn("ripgrep (rg) not found: OpenCode would download it from GitHub on first search. Install it to stay offline.")
  if (settings.web.fetch || settings.web.search) warn("Web fetch/search is enabled: fetched pages can carry prompt injection.")
  else ok("Web fetch and search are off")

  const composed = compose({ settings, sandbox: sb, cwd: process.cwd() })
  for (const w of composed.warnings) if (!w.startsWith("Sandbox")) warn(w)
  const providers = composed.config.providers as Record<string, any>
  if (Object.keys(providers).length) {
    console.log()
    console.log(bold("Model servers"))
    for (const [id, p] of Object.entries(providers)) {
      const url = String(p.settings?.baseURL ?? "")
      const result = await probe(url, { timeoutMs: 4000 }).catch(() => undefined)
      const models = Object.keys(p.models ?? {}).length
      if (result?.formats.length || result?.authFailed) ok(`${id}: reachable at ${url} (${models} models)`)
      else bad(`${id}: not reachable at ${url}`, "Is the server running? Check the URL with: ./coder connect --list")
    }
    console.log(dim(`  default model: ${composed.model ?? "none"}`))
  }
  console.log()
  console.log(problems ? red(`${problems} problem(s) found.`) : green("All good."))
  return problems ? 1 : 0
}
