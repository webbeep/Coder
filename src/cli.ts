#!/usr/bin/env bun
// Coder command line. Run through ./coder (macOS/Linux) or coder.cmd / coder.ps1 (Windows).
import { keyCommand, mcpCommand, remoteCommand, shareProvider, trustCommand } from "./commands"
import { CONNECT_HELP, connectCommand } from "./connect/command"
import { doctor } from "./doctor"
import { desktop, installDeps, passthrough, serve, tui } from "./launch"
import { coderHome, paths } from "./paths"
import { bold, dim, green } from "./ui"
import { ensureOpencode, readUpstream } from "./upstream"
import { detectSandbox } from "./sandbox-status"
import { loadSettings } from "./settings"
import { vscodeCommand } from "./vscode"
import { parseArgs, str } from "./args"

const HELP = `${bold("Coder")} — secure, local-first coding agent (OpenCode ${readUpstream().opencode.version}, hardened)

Usage: ./coder [command] [args]

  (no command) [dir]     Open the terminal UI in a project folder
  desktop                Open the desktop app (chat, files, diffs, terminal, code editor)
  connect [url]          Connect a model server (local or company; any common API)
  key <server>           Store your API key for a team model server
  doctor [--test]        Check installation, sandbox and model servers
  setup                  Download and verify everything (runs automatically on first use)
  serve [--port N]       Headless server on this machine (127.0.0.1 only)
  remote <user@host>     Open Coder on a Linux server over SSH  (on the server: remote install)
  vscode                 Build and install the VS Code extension
  trust [dir]            Let a reviewed project load its own opencode.json/.opencode
  mcp approve <server>   Re-approve an MCP server whose tools changed
  opencode <args…>       Run any OpenCode command with Coder's configuration

Files: settings ${dim("config/coder.jsonc")}, team models ${dim("config/models.jsonc")}, knowledge ${dim("knowledge/")}
Yours: ${dim(coderHome())}
`

async function setup(): Promise<number> {
  await installDeps()
  await ensureOpencode()
  const sb = detectSandbox(loadSettings())
  console.log(green("Coder is installed."))
  if (sb.mode === "required" && !sb.available) console.log(`Sandbox: ${sb.reason}. ${sb.fix ?? ""}`)
  console.log(dim("Next: ./coder connect   (point it at your model server), then ./coder"))
  return 0
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case undefined:
      return tui([])
    case "help":
    case "--help":
    case "-h":
      console.log(HELP)
      return 0
    case "--version":
    case "version":
      console.log(`coder ${require(`${paths.root}/package.json`).version} (OpenCode ${readUpstream().opencode.version})`)
      return 0
    case "setup":
      return setup()
    case "connect": {
      const share = rest.indexOf("--share")
      if (share >= 0) return shareProvider(rest[share + 1] ?? "")
      if (rest.includes("--help")) {
        console.log(CONNECT_HELP)
        return 0
      }
      return connectCommand(rest)
    }
    case "key":
      return keyCommand(rest)
    case "doctor":
      return doctor(rest)
    case "desktop":
      return desktop()
    case "serve": {
      const a = parseArgs(rest, ["allow-network"])
      return serve({ port: str(a, "port"), hostname: str(a, "hostname"), allowNetwork: Boolean(a.flags["allow-network"]) })
    }
    case "remote":
      return remoteCommand(rest)
    case "vscode":
      return vscodeCommand(rest)
    case "trust":
      return trustCommand(rest)
    case "mcp":
      return mcpCommand(rest)
    case "opencode":
      return passthrough(rest)
    default:
      // A folder, or TUI flags: open the terminal UI.
      return tui(argv)
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`coder: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  },
)
