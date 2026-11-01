// Starts OpenCode (terminal UI, headless server, or the desktop app) with Coder's configuration.
import { chmodSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { compose, type Composed } from "./config"
import { coderHome, paths } from "./paths"
import { detectPlatform } from "./platform"
import { detectSandbox } from "./sandbox-status"
import { loadSettings } from "./settings"
import { dim, yellow } from "./ui"
import { ensureDesktopDownload, ensureOpencode } from "./upstream"

// Flags that auto-approve everything. Coder removes them: approvals are the point.
const AUTO_FLAGS = new Set(["--auto", "--yolo", "--dangerously-skip-permissions"])

export function stripAutoFlags(args: string[]): string[] {
  const kept = args.filter((a) => !AUTO_FLAGS.has(a))
  if (kept.length !== args.length) console.error(yellow("Coder ignores --auto/--yolo: actions still need approval as configured."))
  return kept
}

export async function prepare(cwd = process.cwd()): Promise<{ bin: string; composed: Composed }> {
  if (!existsSync(join(paths.root, "node_modules", "@anthropic-ai", "sandbox-runtime"))) await installDeps()
  const bin = await ensureOpencode()
  const settings = loadSettings()
  const composed = compose({ settings, sandbox: detectSandbox(settings), cwd })
  for (const w of composed.warnings) console.error(yellow(`! ${w}`))
  return { bin, composed }
}

export async function installDeps(): Promise<void> {
  console.error(dim("Installing Coder's pinned dependencies (sandbox-runtime)…"))
  const r = Bun.spawnSync([process.execPath, "install", "--frozen-lockfile", "--ignore-scripts", "--production"], {
    cwd: paths.root,
    stdout: "inherit",
    stderr: "inherit",
  })
  if (r.exitCode !== 0) throw new Error("bun install failed")
}

async function run(cmd: string[], env: Record<string, string>, cwd = process.cwd()): Promise<number> {
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  return await proc.exited
}

/** Terminal UI. A private server per window, so it always runs with this config. */
export async function tui(args: string[]): Promise<number> {
  const { bin, composed } = await prepare()
  return run([bin, "--standalone", ...stripAutoFlags(args)], composed.env)
}

/** Any OpenCode command with Coder's config, e.g. `coder opencode run "explain this"`. */
export async function passthrough(args: string[]): Promise<number> {
  const { bin, composed } = await prepare()
  return run([bin, ...stripAutoFlags(args)], composed.env)
}

/** Headless server for remote use. Loopback only unless explicitly told otherwise. */
export async function serve(opts: { port?: string; hostname?: string; allowNetwork?: boolean }): Promise<number> {
  const hostname = opts.hostname ?? "127.0.0.1"
  const loopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  if (!loopback && !opts.allowNetwork) {
    console.error(
      "Refusing to listen on " +
        hostname +
        ": the server would be reachable from the network.\n" +
        "Use an SSH tunnel instead (see docs/remote.md), or pass --allow-network if you really mean it.",
    )
    return 2
  }
  const { bin, composed } = await prepare()
  const password = process.env.OPENCODE_PASSWORD ?? crypto.randomUUID()
  console.log(`Coder server password (username "opencode"): ${password}`)
  const args = [bin, "serve", "--hostname", hostname, ...(opts.port ? ["--port", opts.port] : [])]
  return run(args, { ...composed.env, OPENCODE_PASSWORD: password })
}

/** Desktop app: the pinned, checksum-verified build, started with Coder's environment. */
export async function desktop(): Promise<number> {
  const { bin, composed } = await prepare()
  const platform = detectPlatform()
  const stateDir = join(coderHome(), "state")
  mkdirSync(stateDir, { recursive: true })
  const env: Record<string, string> = {
    ...composed.env,
    // Own service registry: the app can't adopt a plain OpenCode service running without Coder's guardrails.
    XDG_STATE_HOME: stateDir,
    CODER_INTERNAL_ORIG_XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? "",
  }
  // Restart Coder's background service so it picks up the current configuration.
  Bun.spawnSync([bin, "service", "stop"], { env: { ...process.env, ...env }, stdout: "ignore", stderr: "ignore" })

  const file = await ensureDesktopDownload(platform)
  // A dead proxy for the app's own web traffic blocks the official build's auto-updater and crash
  // reporting. Loopback (the local Coder server) is not proxied; model calls come from the server process.
  const flags = ["--proxy-server=http://127.0.0.1:9"]
  let exe: string
  if (platform.os === "linux") {
    chmodSync(file, 0o755)
    exe = file
  } else if (platform.os === "darwin") {
    const dir = join(file, "..", "app")
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      const r = Bun.spawnSync(["ditto", "-x", "-k", file, dir])
      if (r.exitCode !== 0) throw new Error("Could not unpack the desktop app")
    }
    const app = readdirSync(dir).find((n) => n.endsWith(".app"))
    if (!app) throw new Error("Desktop app bundle not found")
    const macos = join(dir, app, "Contents", "MacOS")
    exe = join(macos, readdirSync(macos)[0]!)
  } else {
    exe = join(process.env.LOCALAPPDATA ?? "", "Programs", "OpenCode", "OpenCode.exe")
    if (!existsSync(exe)) {
      console.log("Installing the OpenCode desktop app for your user (verified installer)…")
      const r = Bun.spawnSync([file, "/S"])
      if (r.exitCode !== 0 || !existsSync(exe)) throw new Error(`Installer finished but ${exe} was not found`)
    }
  }
  console.log(dim("Starting the desktop app with Coder's configuration…"))
  const proc = Bun.spawn([exe, ...flags], { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "ignore"] })
  proc.unref()
  return 0
}
