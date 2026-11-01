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

## 6. MCP servers and other connectors

Add MCP servers in [config/coder.jsonc](../config/coder.jsonc) (for the team) or in your personal
`coder.jsonc`:

```jsonc
{
  "opencode": {
    "mcp": {
      "servers": {
        "jira": { "type": "local", "command": ["npx", "-y", "@yourco/jira-mcp"], "environment": { "JIRA_URL": "https://jira.yourco.internal" } },
        "docs": { "type": "remote", "url": "https://mcp.yourco.internal/docs" }
      }
    }
  },
  // Local MCP servers run in the sandbox. Allow the hosts each one needs:
  "mcp": { "jira": { "allowedDomains": ["jira.yourco.internal"] } }
}
```

MCP tools need approval by default. Coder pins each tool's definition the first time it sees it.
If a server later changes a definition, the tool is disabled until you review it and run
`./coder mcp approve <server>`.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| "Coder's sandbox is not available" | `./coder doctor` names what's missing (bubblewrap, socat, ripgrep). |
| A command needs the network | Add the host to `sandbox.allowedDomains` in `coder.jsonc`. |
| Tool calls fail or the model "describes" tool calls in text | Server-side tool calling is off or uses the wrong parser. Re-run `./coder connect` to see the check. |
| Answers cut off in long sessions | The context is too small. Check `--context` and Ollama's `OLLAMA_CONTEXT_LENGTH`. |
| A project's own `opencode.json` is ignored | Review it, then `./coder trust`. |
| The desktop editor highlights nothing for your language | Add it to `languages.json`, then `./coder editor build`. |
