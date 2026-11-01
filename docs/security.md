# Coder security

What Coder protects against, how, where each control lives, and what it does **not** cover.

## Threat model

An AI agent reads untrusted text (repository files, issues, tool output, web pages, MCP servers)
and then acts with your permissions. Coder assumes any of that text can contain instructions
written by an attacker (prompt injection). It aims to make the agent unable to do lasting harm
even when it follows them. Real incidents shaped the design:
- **s1ngularity / Nx (2025):** malware ran installed AI CLIs with `--yolo` to hunt for secrets.
- **Shai-Hulud variants (2025–26):** malware wrote hooks into agent and editor config files.
- **LiteLLM's PyPI package (March 2026):** compromised with a credential stealer.
- **MCP "rug pulls":** tool descriptions changed after the user approved them.

Two principles:
- **Approvals are a convenience. The sandbox and hard denies are the boundary.**
- **Fail closed:** if a protection can't run, the action doesn't run.

## Controls

| # | Control | Where | Notes |
|---|---|---|---|
| 1 | **OS sandbox for shell commands** | `plugins/coder/server.ts` (shell hook) → [sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime) | Uses Seatbelt on macOS and bubblewrap + seccomp on Linux. OpenCode still runs `bash -c <command>`, but `bash` is Coder's wrapper, so permission rules see the real command before the sandbox runs it. |
| 2 | **Fail-closed** | same | If the sandbox is required and unavailable (missing tools, not installed), every shell command is rejected with a message pointing to `coder doctor`. |
| 3 | **Filesystem** | `plugins/coder/sandbox.ts` | **Writes:** allowed in the project, its worktree, temp folders and `~/.cache`. Never allowed in `.git/hooks`, `.git/config`, `.vscode/`, `.idea/`, shell startup files (sandbox-runtime's mandatory list), nor in `.opencode/`, `opencode.json[c]`, `.envrc`, `.husky/`, `.claude/`, `.devcontainer/`, Coder's engine or Coder's private folder.<br>**Reads:** denied for `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.azure`, gh/gcloud config, `.netrc`, `.npmrc`, `.pypirc`, `.git-credentials`, OpenCode's credential database, browser profiles, Coder secrets. |
| 4 | **Network for commands** | same | Denied unless the host is in `sandbox.allowedDomains`. Enforced by sandbox-runtime's proxy, which also refuses loopback, link-local and cloud-metadata addresses. |
| 5 | **Local MCP servers sandboxed** | `plugins/coder/server.ts` (MCP transform) | Same sandbox, with a network allowlist per server (`mcp.<name>.allowedDomains`). If the sandbox is unavailable, local MCP servers are disabled. |
| 6 | **Hard denies on file tools** | permission hook + tool hook + `OPENCODE_CONFIG_CONTENT` rules | Applied twice: OpenCode deny rules layered last (no project config can undo them), and the plugin checks again in code. |
| 7 | **Scanned long-lived context** | tool hook + `src/guard/scan.ts` | Covers writes to `knowledge/`, `MEMORY.md`, `AGENTS.md` and `skills/`. Blocks AI-directed instructions, chat-role markup, "don't tell the user", instructions to send secrets, piping a download into a shell, invisible Unicode (zero-width, bidi, tag characters) and common secret formats. Always-loaded files have size limits. |
| 8 | **Keys never in config or shells** | `src/store.ts`, `src/config.ts`, shell hook | Keys live in 0600 files referenced as `{file:…}`. Env-var keys are removed from every shell command's and local MCP server's environment. OpenCode removes its own server password from its environment at start. |
| 9 | **Untrusted repositories** | `src/config.ts` | `OPENCODE_DISABLE_PROJECT_CONFIG=1` unless you ran `coder trust` for that folder. A cloned repo can't add plugins, MCP servers or permissive rules. |
| 10 | **MCP tool pinning** | session context hook | Each MCP tool's description and schema is hashed on first sight. A changed tool is removed from the model's tool list and the model is told to inform you. `coder mcp approve <server>` re-pins it. |
| 11 | **No auto-approve** | `src/launch.ts` | `--auto`, `--yolo` and `--dangerously-skip-permissions` are stripped. |
| 12 | **No phone-home** | `config/opencode.jsonc`, `src/config.ts`, `src/launch.ts` | Model catalog fetch, self-update and hosted "free models" are off; sharing is disabled. OpenCode's config and database are isolated in Coder's folders, and the `~/.claude` integrations are off. For the desktop app, a dead proxy blocks the official build's auto-updater and crash reporting. |
| 13 | **Web access off** | policy rules | `webfetch` and `websearch` are denied unless `web.fetch` / `web.search` is enabled. Fetched pages are the most common injection source. |
| 14 | **Pinned, verified downloads** | `upstream.json`, launchers | Bun is checked by SHA-256 (hard-coded in the launchers); the OpenCode CLI by npm SRI sha512; desktop builds by the release's SHA-256; npm dependencies through frozen lockfiles with install scripts off. Upgrades are PRs ([upgrading.md](upgrading.md)). |
| 15 | **Server exposure** | `src/launch.ts` | `coder serve` binds to 127.0.0.1 with a random password and refuses other addresses unless you pass `--allow-network`. Remote use goes through SSH. |
| 16 | **Audit log** | tool hook | One JSON line per tool call (time, folder, session, tool, status, truncated input) in `<coder home>/audit/YYYY-MM-DD.jsonl`, ready to forward to a SIEM. |

Check your machine with `./coder doctor` (and `./coder doctor --test` to run a command inside the sandbox).

## Limits

- **Windows has no native sandbox yet.** sandbox-runtime's Windows support is alpha and needs an
  elevated install, so Coder defaults to `sandbox.mode: "ask"` there: every command needs your
  approval, and file-tool denies and scanning still apply. For full isolation, run Coder inside
  **WSL2**.
- **Approvals can be clicked through.** The OpenCode TUI has an "auto-accept" toggle that works
  client-side only. Deny rules and the sandbox still hold; `ask` rules do not.
- **Shell commands aren't the only spawns.** OpenCode itself runs git, ripgrep, formatters (off by
  default) and the interactive terminal you open in the desktop app. Those run as you, outside the
  sandbox. The agent can't start them with arbitrary arguments except through its shell tool,
  which is sandboxed.
- **The scanner is a tripwire, not a proof.** Pattern scanning catches common injection and secret
  formats. Reviewing knowledge PRs is still the real control for shared context.
- **MCP server instructions** that a server injects into the system prompt aren't pinned, only its
  tools. Only add MCP servers you trust.
- **Desktop app:** Coder uses the official, checksum-verified OpenCode desktop build. Its updater is
  blocked by the launch flags, a best-effort measure. Building the desktop app from source with the
  updater removed is on the roadmap.
- **Sandbox network allowlist:** anything you allow (a package mirror, internal git) is reachable by
  every sandboxed command. Keep the list short.
