# Coder

A secure, local-first AI coding agent for your team, running on **your own models**.
Clone it, connect it to a model server, and use it from the terminal, a desktop app with a
built-in code editor, or VS Code, on Windows, macOS and Linux, locally or on a remote Linux server.

Coder is a hardened distribution of [OpenCode](https://github.com/anomalyco/opencode) (MIT).
It doesn't fork the upstream code. It pins a verified OpenCode release and adds its own launcher,
configuration, guardrails plugin, editor and knowledge base around it.
See [docs/research.md](docs/research.md) for why OpenCode was chosen.

## Quick start

**Linux:** first install the sandbox tools (`sudo apt-get install bubblewrap socat ripgrep`).
**macOS:** first run `brew install ripgrep`.

```sh
git clone <this repo> Coder && cd Coder
./coder connect          # once: point Coder at your model server (asks for URL and key)
./coder                  # terminal UI in the current folder (or: ./coder path/to/project)
./coder desktop          # desktop app: chat, files, diffs, terminal, code editor
./coder vscode           # install the VS Code extension (Ctrl/Cmd+Esc opens Coder)
./coder doctor           # check that everything is installed and safe
```

On **Windows**, run the same commands as `coder connect`, `coder`, `coder desktop` and so on, from
`cmd` or PowerShell in the checkout. The first run downloads the pinned Bun and OpenCode builds and
verifies their checksums. Nothing else needs to be installed.

## What it does

| | |
|---|---|
| **Any model server** | `coder connect <url>` detects the server type (Ollama, llama.cpp, LM Studio, vLLM, SGLang, LiteLLM, TGI, any OpenAI-, Anthropic- or Gemini-compatible API, Azure OpenAI). It reads each model's context size, checks that tool calling works, and stores the key in a private file. Nothing goes to public AI services. |
| **Shared team models** | Add your company server to [config/models.jsonc](config/models.jsonc) once. Each colleague stores their own key with `coder key <id>`. |
| **Your proprietary language** | Paste docs into the chat and say "learn this". The agent writes them into [knowledge/](knowledge/) as a cheat sheet plus reference files, which it consults before writing code. Share knowledge with the team through a normal PR. The desktop editor can highlight your language through [languages.json](plugins/coder-editor/languages.json). |
| **Desktop app with an editor** | The OpenCode desktop app (pinned build, checksum-verified), plus Coder's code editor panel (`Ctrl/Cmd+Shift+E`). |
| **VS Code** | The extension opens Coder beside your editor and sends `@file#L10-20` references. It also works over Remote-SSH. |
| **Remote Linux servers** | `coder remote user@host` runs Coder on the server over SSH. `coder remote install` on the server lets the desktop app's *Add server → SSH* use Coder there. |
| **MCP and connectors** | Configure MCP servers under `opencode.mcp` in [config/coder.jsonc](config/coder.jsonc). Local servers run sandboxed, and tool definitions are pinned on first use. |
| **Memory** | A short personal `MEMORY.md` per person. Writes are size-capped and scanned for injected instructions and secrets. |

## Security in one table

Details in [docs/security.md](docs/security.md).

| Risk | What Coder does |
|---|---|
| Agent runs something harmful | Shell commands and local MCP servers run in an OS sandbox (macOS Seatbelt, Linux bubblewrap). The sandbox gives write access only to the project and temp folders, hides credentials, and blocks the network unless a host is allowlisted. **If the sandbox can't start, commands are blocked** instead of running unprotected. Windows: every command needs approval (WSL2 for a full sandbox). |
| Prompt injection turns into persistence | The agent can never write git hooks, `.opencode/`, `opencode.json`, `.vscode/tasks.json`, `.envrc`, shell startup files, or Coder's own engine and settings. |
| Poisoned memory or knowledge | Writes to knowledge, memory, `AGENTS.md` and skills are scanned for AI-directed instructions, hidden Unicode and secrets. Files loaded into every session have size limits. |
| Secret leaks | The agent can't read `.env` files, `~/.ssh`, cloud credentials or Coder's key files. Model keys never appear in config or shell environments. |
| Malicious repo config | A cloned project's own `opencode.json` and `.opencode/` are ignored until you run `coder trust`. |
| MCP "rug pulls" | A tool whose definition changes after first use is disabled until you run `coder mcp approve`. |
| Phone-home and supply chain | No telemetry, model catalog fetch, self-update or hosted models. Every download is pinned and verified (SHA-256 or SRI). Dependencies come from frozen lockfiles with install scripts disabled. |
| Auto-approve modes | `--auto`, `--yolo` and `--dangerously-skip-permissions` are stripped. |
| Audit | Every tool call is logged as JSON lines in `<coder home>/audit/`. |

## Repository layout

```text
coder, coder.cmd, coder.ps1   launchers (macOS/Linux, Windows)
upstream.json                 pinned OpenCode, desktop and sandbox versions with checksums
config/                       team settings: coder.jsonc, models.jsonc, opencode.jsonc (baseline rules)
plugins/coder/                guardrails plugin (sandbox, path policy, scanning, MCP pinning, audit)
plugins/coder-editor/         desktop code editor panel (CodeMirror 6)
knowledge/                    team knowledge base (markdown), INDEX.md is loaded every session
skills/                       team skills (SKILL.md); share new ones by PR
vscode/                       VS Code extension
src/                          the Coder CLI (Bun + TypeScript)
docs/                         guide, security, upgrading, research, plan
```

## Docs

- [docs/guide.md](docs/guide.md): setup per OS, connecting models, team models, knowledge, remote, VS Code, troubleshooting
- [docs/security.md](docs/security.md): threat model, every control, and its limits
- [docs/upgrading.md](docs/upgrading.md): moving to a new OpenCode release safely
- [docs/research.md](docs/research.md) and [docs/plan.md](docs/plan.md): why this design, and what's next

## Development

```sh
bun install && bun run test && bun run typecheck     # unit tests (42) and types
bun test/e2e/run.ts                                   # end to end with the real OpenCode and a mock model server
./coder editor build --check                          # desktop editor bundle matches its sources
```

CI runs all of these on Windows, macOS and Linux ([.github/workflows/ci.yml](.github/workflows/ci.yml)).
