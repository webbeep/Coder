// Small commands: key, trust, mcp approve, remote.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { coderHome, paths } from "./paths"
import { readJsoncFile, readUserProviders, saveSecret, writeJson } from "./store"
import { askSecret, bold, dim, green, red } from "./ui"
import { readUpstream } from "./upstream"

export async function keyCommand(argv: string[]): Promise<number> {
  const id = argv[0]
  if (!id) {
    console.error("Usage: coder key <server-id>   (stores your API key for a team model server)")
    return 2
  }
  const value = process.env.CODER_KEY_VALUE ?? (await askSecret(`API key for "${id}":`))
  if (!value) {
    console.error(red("No key entered."))
    return 1
  }
  const file = saveSecret(id, value)
  console.log(green(`Saved. Only your user can read ${file}.`))
  return 0
}

export function trustCommand(argv: string[]): number {
  const file = join(coderHome(), "trusted.json")
  const list = readJsoncFile<string[]>(file, [])
  if (argv[0] === "--list") {
    console.log(list.length ? list.join("\n") : "No trusted projects.")
    return 0
  }
  const remove = argv[0] === "--remove"
  const dir = resolve(argv[remove ? 1 : 0] ?? process.cwd())
  const next = remove ? list.filter((d) => d !== dir) : [...new Set([...list, dir])]
  writeJson(file, next, 0o600)
  console.log(
    remove
      ? `${dir} is no longer trusted.`
      : `${bold(dir)} is now trusted: its own opencode.json and .opencode folder (plugins, MCP servers, agents) will load.\n` +
          dim("Only trust projects whose config you have reviewed. Coder's security rules still apply."),
  )
  return 0
}

export function mcpCommand(argv: string[]): number {
  const [sub, server] = argv
  const file = join(coderHome(), "mcp-pins.json")
  const pins: Record<string, Record<string, string>> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
  if (sub === "approve" && server) {
    delete pins[server]
    writeJson(file, pins, 0o600)
    console.log(`Approved the current tool definitions of "${server}"; they are pinned again on next use.`)
    return 0
  }
  if (sub === "pins") {
    for (const [s, tools] of Object.entries(pins)) console.log(`${bold(s)}: ${Object.keys(tools).length} pinned tools`)
    return 0
  }
  console.error("Usage: coder mcp approve <server> | coder mcp pins")
  return 2
}

/** Share a connected server with the team: prints its entry with the key replaced by a per-person secret. */
export function shareProvider(id: string): number {
  const p = readUserProviders().providers[id]
  if (!p) {
    console.error(red(`No connected server named ${id}.`))
    return 1
  }
  const settings = { ...p.settings }
  if (settings.apiKey) settings.apiKey = `{secret:${id}}`
  console.log(dim(`// Paste into "providers" in ${join(paths.config, "models.jsonc")}; colleagues then run: ./coder key ${id}`))
  console.log(JSON.stringify({ [id]: { ...p, settings } }, null, 2))
  return 0
}

const SSH_TARGET = /^[A-Za-z0-9._@:\[\]-]+$/
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * coder remote install                 (on the server) let the desktop app's "Add server (SSH)" use Coder
 * coder remote <user@host> [dir]        (on your machine) open Coder's terminal UI on the server over SSH
 */
export async function remoteCommand(argv: string[]): Promise<number> {
  if (argv[0] === "install") return installRemoteShim()
  const target = argv[0]
  if (!target || !SSH_TARGET.test(target)) {
    console.error("Usage: coder remote <user@host> [project-dir] [--coder-path ~/Coder/coder]\n       coder remote install   (run this on the server once)")
    return 2
  }
  const pathIdx = argv.indexOf("--coder-path")
  const coderPath = pathIdx >= 0 ? argv[pathIdx + 1]! : "~/Coder/coder"
  const dir = argv[1] && !argv[1].startsWith("--") ? argv[1] : "."
  const remoteCmd = `cd ${dir === "." ? "." : shq(dir)} && exec ${coderPath.startsWith("~/") ? "$HOME/" + shq(coderPath.slice(2)) : shq(coderPath)}`
  const proc = Bun.spawn(["ssh", "-t", target, remoteCmd], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  return await proc.exited
}

function installRemoteShim(): number {
  if (process.platform === "win32") {
    console.error("Run `coder remote install` on the Linux or macOS server you want to connect to.")
    return 2
  }
  const version = readUpstream().opencode.version
  const launcher = join(paths.root, "coder")
  const script = `#!/bin/sh\n# Installed by Coder: OpenCode with Coder's configuration and guardrails.\nexec ${shq(launcher)} opencode "$@"\n`
  // The desktop app's SSH connection looks here first for an existing install of its own version.
  const shim = join(homedir(), ".opencode", "desktop-ssh", version, "opencode")
  for (const file of [shim, join(homedir(), ".local", "bin", "opencode")]) {
    mkdirSync(join(file, ".."), { recursive: true })
    writeFileSync(file, script, { mode: 0o755 })
    console.log(`Installed ${file}`)
  }
  console.log(
    green("\nDone.") +
      " In the desktop app on your computer, use Add server → SSH with this machine; it will run Coder here.\n" +
      dim("If another OpenCode is installed on this server, remove it so the app can't pick it instead."),
  )
  return 0
}
