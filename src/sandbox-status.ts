// Decides whether the OS sandbox can run on this machine, and with what.
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { SandboxMode } from "../plugins/coder/sandbox"
import { paths } from "./paths"
import { currentOS, which } from "./platform"
import type { CoderSettings } from "./settings"

export interface SandboxStatus {
  mode: SandboxMode
  available: boolean
  reason?: string
  /** How to fix it, shown by `coder doctor`. */
  fix?: string
  runtime?: string
  srtCli?: string
}

export const SRT_CLI = join(paths.root, "node_modules", "@anthropic-ai", "sandbox-runtime", "dist", "cli.js")

function nodeRuntime(): string | undefined {
  const node = which("node")
  if (!node) return undefined
  const r = Bun.spawnSync([node, "--version"])
  const m = /^v(\d+)\.(\d+)/.exec(r.stdout.toString().trim())
  if (!m) return undefined
  const [major, minor] = [Number(m[1]), Number(m[2])]
  return major > 22 || (major === 22 && minor >= 12) ? node : undefined
}

export function resolveMode(setting: CoderSettings["sandbox"]["mode"]): SandboxMode {
  if (setting === "auto") return currentOS() === "windows" ? "ask" : "required"
  return setting
}

export function detectSandbox(settings: CoderSettings): SandboxStatus {
  const mode = resolveMode(settings.sandbox.mode)
  const status: SandboxStatus = { mode, available: false }
  const os = currentOS()
  if (os === "windows") {
    status.reason = "Coder does not sandbox commands natively on Windows yet (sandbox-runtime's Windows support is alpha)"
    status.fix = 'Run Coder inside WSL2 for full sandboxing, or keep sandbox.mode "ask" so every command needs approval.'
    return status
  }
  if (!existsSync(SRT_CLI)) {
    status.reason = "sandbox-runtime is not installed"
    status.fix = "Run: ./coder setup"
    return status
  }
  const missing: string[] = []
  if (os === "linux") for (const tool of ["bwrap", "socat", "rg"]) if (!which(tool)) missing.push(tool)
  if (os === "darwin") {
    if (!existsSync("/usr/bin/sandbox-exec")) missing.push("sandbox-exec")
    if (!which("rg")) missing.push("rg")
  }
  if (missing.length) {
    status.reason = `missing ${missing.join(", ")}`
    status.fix =
      os === "linux"
        ? "Install them, e.g.: sudo apt-get install bubblewrap socat ripgrep   (Fedora: sudo dnf install bubblewrap socat ripgrep)"
        : "Install ripgrep: brew install ripgrep"
    return status
  }
  status.runtime = nodeRuntime() ?? process.execPath
  status.srtCli = SRT_CLI
  status.available = true
  return status
}
