# Coder guide

## 1. Install

You need git. Coder downloads everything else on first run (Bun 1.4.4 and OpenCode 2.2.5) and
checks each download against the hashes in [upstream.json](../upstream.json) and the launchers.

| OS | Extra packages for the sandbox | Run Coder with |
|---|---|---|
| macOS | `brew install ripgrep` | `./coder` |
| Linux | `sudo apt-get install bubblewrap socat ripgrep` (Fedora: `dnf install …`) | `./coder` |
| Windows | none | `coder` (cmd or PowerShell, in the checkout) |

On Ubuntu 24.04 and later, bubblewrap may also need unprivileged user namespaces. If
`./coder doctor --test` fails, see sandbox-runtime's
[Ubuntu note](https://github.com/anthropic-experimental/sandbox-runtime#platform-specific-dependencies).

Run `./coder doctor` at any time. It shows where your personal files are and whether the sandbox,
binaries and model servers are OK.

**Your personal folder** holds model connections, keys, memory and the audit log. It is never in git:

- Windows: `%APPDATA%\Coder`
- macOS and Linux: `~/.config/coder`
- Override it with `CODER_HOME`.

## 2. Connect a model server

```sh
./coder connect                        # interactive
./coder connect http://localhost:11434 # Ollama on this machine
./coder connect https://llm.yourco.internal/v1 --name company --key-env COMPANY_LLM_KEY
```

### What `coder connect` does

1. Finds which APIs the server speaks, without spending tokens.
2. Lists the models and reads their context sizes.
3. Sends one tiny request to confirm **tool calling** works (agents need it).
4. Saves the connection.

### Supported servers

| Server | Notes |
|---|---|
| **Ollama** | Set `OLLAMA_CONTEXT_LENGTH=32768` (or more) where Ollama runs, or long sessions get truncated silently. |
| **llama.cpp** `llama-server` | Start it with `--jinja`, or tool calls don't work. Avoid aggressive KV-cache quantization. |
| **LM Studio** | Start its local server. |
| **vLLM / SGLang** | Start with tool calling on, e.g. vLLM `--enable-auto-tool-choice --tool-call-parser <parser for your model>`. |
| **LiteLLM / other gateways** | Use the gateway URL and a per-person key. |
| **Anthropic-compatible** (`/v1/messages`) | Chosen automatically when that's all the server speaks, or with `--format anthropic`. |
| **Gemini-compatible** | `--format gemini`. |
| **OpenAI Responses API** | `--format openai-responses`. |
| **Azure OpenAI** | `--models <deployment names>`. |

### Useful flags

| Flag | Effect |
|---|---|
| `--models a,b` | Add only these models |
| `--context N` | Set the context size when the server doesn't report it |
| `--vision` | The models accept images |
| `--default model` | Make this model the default |
| `--no-test` | Skip the tool-calling check |
| `--yes` | Don't ask questions |

`coder connect --list` shows your connections. `coder connect --remove NAME` forgets one.

**Where keys go.** A key you type is saved in `<personal folder>/secrets/<name>.key`, readable only by
you. Config files only *reference* that file. With `--key-env VAR` Coder reads the variable at
start-up instead. Either way, Coder's guardrails stop the agent from reading the key.

### Share a server with the team

1. Connect it yourself and check it works.
2. Run `./coder connect --share company` and paste the printed entry into
   [config/models.jsonc](../config/models.jsonc). The key is replaced by `{secret:company}`.
3. Open a PR.
4. After it merges, each colleague runs `./coder key company` once to store their own key.

## 3. Daily use

| Command | What you get |
|---|---|
| `./coder [folder]` | Terminal UI |
| `./coder desktop` | The desktop app with Coder's settings. Open a session, then **+ → Code editor** (or `Ctrl/Cmd+Shift+E`) to edit files. Save with `Ctrl/Cmd+S`. Files the agent changes reload automatically unless you have unsaved edits. |
| `./coder vscode` | Installs the VS Code extension. Then `Ctrl/Cmd+Esc` opens Coder, and `Ctrl/Cmd+Alt+K` sends the current file and selection to it. |
| `./coder opencode run "…"` | One-shot, non-interactive run |

### Approvals

Reading and searching are free. Editing files, running commands and calling MCP tools ask
first, and you can approve "always" for a session.

To change the defaults for everyone, add rules to `opencode.permissions` in
[config/coder.jsonc](../config/coder.jsonc). To change them only for yourself, put the rules in
`<personal folder>/coder.jsonc`. Rules are evaluated in order and the last match wins. Coder's
security rules are always applied last.

```jsonc
// <personal folder>/coder.jsonc
{
  "opencode": {
    "permissions": [
      { "action": "edit", "resource": "*", "effect": "allow" },
      { "action": "shell", "resource": "npm test*", "effect": "allow" }
    ]
  }
}
```

## 4. Teach Coder your proprietary language

Coder learns from **markdown files**, not from training. Research on languages models have never
seen shows two things make the biggest difference: looking things up in the docs, and checking code
with the real compiler.

1. **Import the docs through chat.** Paste or attach the spec, guides and examples, and say
   "learn these AcmeLang docs". The built-in `knowledge` skill makes the agent write:
   - `knowledge/acmelang/CHEATSHEET.md`: syntax, how to build and test, how it differs from a
     language it resembles, the standard library index, idioms, common errors and examples;
   - `knowledge/acmelang/reference/*.md`: the detail, split by topic;
   - one line per file in `knowledge/INDEX.md`, which is loaded into every session.

   The agent then reads the cheat sheet and searches the reference before writing AcmeLang code.
   You approve each write, and every write is scanned for injected instructions and secrets.
2. **Put the compiler in the loop.** In the cheat sheet, or in a project's `AGENTS.md`, write the
   exact commands to compile, lint and test (for example `acmec check src/`). Allow them so the agent
   runs them after every change:
   `{ "action": "shell", "resource": "acmec *", "effect": "allow" }`.
   They run inside the sandbox.
3. **Correct it once.** When the agent gets something wrong, tell it. The skill makes it fix the
   knowledge file so the mistake doesn't repeat.
4. **Share it.** The knowledge lives in this repo, so open a PR and the whole team gets it on the
   next `git pull`.
5. **Highlight it in the editor.** Add the language to
   [plugins/coder-editor/languages.json](../plugins/coder-editor/languages.json) (extensions,
   keywords, types, comment and string syntax), then run `./coder editor build`.

Personal facts ("I use the staging cluster", "prefer tabs") go into your own `MEMORY.md`, which
stays on your machine.

## 5. Remote Linux servers

There are three ways to work on a remote Linux server.

- **Terminal:**
  1. On the server, clone Coder to `~/Coder`, then run `./coder setup` and `./coder connect`.
  2. From your machine, run `./coder remote user@host ~/project`.

  This runs Coder on the server over SSH, so the agent, the sandbox and the model calls all
  happen there.
- **Desktop app:**
  1. On the server, run `./coder remote install` once.
  2. In the desktop app, choose **Add server → SSH** and pick the host.

  The app finds Coder's `opencode` shim and starts it with Coder's settings. Don't install a plain
  OpenCode on that server, or the app may pick it instead.
- **VS Code Remote-SSH:** install the extension in the remote window (`./coder vscode` on the server,
  or *Install in SSH: host*). Set `coder.path` if the checkout isn't at `~/Coder`.

`./coder serve` starts a headless server on `127.0.0.1` only. Reach it through an SSH tunnel; it
refuses other addresses unless you pass `--allow-network`.

## 6. Skills, MCP servers, plugins and tools

### Skills

Skills use the open `SKILL.md` format shared by Claude Code, Codex, OpenCode, Gemini CLI, Hermes
and Pi. Import them from a folder, a git repo or a Claude Code plugin:

```sh
./coder skill add https://github.com/anthropics/skills          # every SKILL.md found in the repo
./coder skill add https://github.com/org/repo#path/to/skills    # one folder of a repo
./coder skill add ./team-skills --team                           # into skills/ in this repo (share by PR)
./coder skill list
./coder skill remove pdf
```

- **Personal skills** go to `<personal folder>/skills`.
- **Team skills** go to [skills/](../skills).
- **Every file is scanned.** A skill with AI-directed instructions, hidden characters or secrets is
  refused until you've reviewed it and pass `--force`.
- **Bundled scripts** run through the shell tool, so they're sandboxed.

### MCP servers

```sh
./coder mcp add jira --allow jira.yourco.internal -- npx -y @yourco/jira-mcp     # local (stdio) server
./coder mcp add docs --url https://mcp.yourco.internal/docs --header "Authorization=Bearer {env:DOCS_TOKEN}"
./coder mcp import ~/.cursor/mcp.json          # also claude_desktop_config.json, .mcp.json, .vscode/mcp.json, opencode.json
./coder mcp list
./coder mcp remove jira
```

What happens on import:
- Literal tokens in `env` and `headers` (any name containing key, token, secret, password or auth)
  are moved to private key files, and the config references them.
- `${env:X}` placeholders become `{env:X}`.
- Local servers run in the sandbox with **no network** until you allow their hosts with `--allow`.
- MCP tools ask before running.
- Each tool's definition is pinned the first time it's used. If it changes later, the tool is
  disabled until you review it and run `./coder mcp approve <server>`.

For servers the whole team should get, put them in [config/coder.jsonc](../config/coder.jsonc)
instead (and never put tokens there):

```jsonc
{
  "opencode": { "mcp": { "servers": { "jira": { "type": "local", "command": ["npx", "-y", "@yourco/jira-mcp"] } } } },
  "mcp": { "jira": { "allowedDomains": ["jira.yourco.internal"] } }
}
```

### OpenCode plugins and custom tools

```sh
./coder plugin add some-opencode-plugin@1.4.2   # an exact version is required
./coder plugin add ./my-plugin                  # a local folder
./coder tool new word-count                     # creates <personal folder>/plugins/word-count/server.ts
```

Plugins and custom tools run **inside Coder's server with your permissions, outside the sandbox**,
which is why Coder asks for confirmation and an exact version. For anything that talks to other
systems, prefer an MCP server: those run in the sandbox. The agent can't edit plugins in your
personal folder.

## 7. Benchmarks: measure, don't guess

```sh
./coder eval                                  # all tasks, default model
./coder eval --model local/qwen3.8-27b        # another model
./coder eval --tag acmelang --runs 3          # a subset, three times each (models vary)
./coder eval compare                          # the last two runs, task by task
```

### How a task runs

1. Each task in [evals/tasks](../evals/tasks) starts from a fresh copy of its `workspace/`.
2. The agent works headless. It may edit and run commands without asking, so evals require the
   sandbox, unless you run them on a throwaway machine with `--allow-unsandboxed`.
3. Only afterwards are the hidden `tests/` copied in and the check run.

### What gets recorded

The pass rate, seconds, tool calls (from Coder's audit log), tokens (when OpenCode reports them),
and two integrity flags:
- **edited tests:** the agent changed a test it was asked to make pass;
- **followed injection:** the agent obeyed instructions hidden in the repo.

### Results

Results are saved in `evals/results/`, git-ignored by default. To commit a baseline, use
`git add -f evals/results/<file>`.

A run is compared with the previous one for the same model, and a drop in pass rate is flagged.
Use runs to:
- choose a model or quantization;
- check a knowledge-base change;
- vet an OpenCode upgrade before merging it.

### Your own tasks

Copy [evals/tasks/_template](../evals/tasks/_template) and write tasks in your proprietary
language, with its compiler or test runner as the `check` command. A few dozen real tasks tell you
more than any public leaderboard.

CI checks that every starter task is solvable (reference solutions in `test/eval.test.ts`). It also
runs the smoke task through the real OpenCode binary on every push.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| "Coder's sandbox is not available" | `./coder doctor` names what's missing (bubblewrap, socat, ripgrep). |
| A command needs the network | Add the host to `sandbox.allowedDomains` in `coder.jsonc`. |
| Tool calls fail or the model "describes" tool calls in text | Server-side tool calling is off or uses the wrong parser. Re-run `./coder connect` to see the check. |
| Answers cut off in long sessions | The context is too small. Check `--context` and Ollama's `OLLAMA_CONTEXT_LENGTH`. |
| A project's own `opencode.json` is ignored | Review it, then `./coder trust`. |
| The desktop editor highlights nothing for your language | Add it to `languages.json`, then `./coder editor build`. |
