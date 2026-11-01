# Harness research

*Checked 2026-11-01. Facts change fast in this space, so the "How this was verified" section says what was confirmed directly and what came from docs and READMEs.*

## What we need

| # | Requirement |
|---|---|
| R1 | Clone and run locally. A desktop app on **Windows and macOS** with a **real code editor** |
| R2 | Works **fully offline** with **self-hosted models**: a model on the laptop, or the company's own model server, both reached over an OpenAI-compatible API |
| R3 | Can read and write a **proprietary programming language**, using a local knowledge base and the language's own compiler/LSP |
| R4 | **MCP** and other connectors |
| R5 | **Secure by default**: OS sandbox, approvals, no telemetry or data leaving the machine |
| R6 | **Improves itself safely**: nothing is learned that breaks things |
| R7 | Colleagues can clone or install the **exact same version** and point it at the same model server |
| R8 | License allows forking and internal redistribution |

## Verdict

- **Base: [OpenCode v2](https://github.com/anomalyco/opencode) (MIT).** It is the only MIT/Apache candidate that has all of the following:
  - a desktop app on Windows and macOS, plus a terminal UI and a headless server;
  - first-class OpenAI-compatible endpoints, with docs for llama.cpp, Ollama and LM Studio;
  - MCP, custom LSP servers, and skills, agents and commands;
  - plugins at three levels: server tools and hooks, desktop GUI panels, and config;
  - admin-managed config that users can't override;
  - ACP support and a VS Code extension, so it can sit behind another editor too.
- **Runners-up:**
  - **[Goose](https://github.com/aaif-goose/goose)** (Apache-2.0, Linux Foundation). The best-governed option, with opt-in telemetry and an official white-label guide. However, it has no editor, its default mode is fully autonomous, and it is written in Rust plus TypeScript.
  - **[Pi](https://github.com/earendil-works/pi)** (MIT). I'm assuming this is the "Py" you mentioned. It has the smallest, cleanest core, but no permission system, no sandbox and no desktop app.
- **Borrow ideas from, but don't fork:**
  - Hermes Agent: memory and skill curation.
  - Google's Harness²: eval-gated self-improvement.
  - DeepSeek Harness: plugins that reload transactionally.
  - Codex CLI and Anthropic's sandbox-runtime: OS sandboxing.
- **Avoid:**
  - Continue: the repo is read-only and "no longer actively maintained".
  - Void: archived June 2026.
  - Roo Code: archived May 2026.
  - Crush: FSL source-available license, and metrics are on by default.
  - Gemini CLI: no OpenAI-compatible endpoints.
  - Codex CLI as a base: it only speaks the Responses API, its desktop app is closed source, and its Rust codebase is about 1.2M lines.

## Comparison

| | License | Desktop (Win/macOS) | Editor | Self-hosted models | MCP | Sandbox / approvals | Default outbound calls | Status (Oct 2026) |
|---|---|---|---|---|---|---|---|---|
| **OpenCode v2** | MIT | Yes (Electron, beta) | Files, diff and terminal panels; **no full editor** yet. Has a GUI plugin SDK | Any OpenAI-compatible `baseURL` | Yes, plus ACP | allow/ask/deny rules; **no OS sandbox** | Model catalog fetch, update check (both can be turned off with env vars). No analytics SDK found | 224k★, v2.2.5 (Oct 30). Very fast-moving |
| **Goose** | Apache-2.0 | Yes (Electron) | No | Ollama built in; OpenAI-compatible via custom provider | Native (extensions *are* MCP servers) | Approval modes; **default is fully autonomous** | Telemetry opt-in | 56k★, v1.57 (Oct 28) |
| **Pi** | MIT | No (terminal, SDK) | No | Simple `models.json` | Yes | **None** (recommends a container) | Install telemetry on by default (`PI_OFFLINE` turns it off) | 119k★, v1.4 (Oct 21) |
| Codex CLI | Apache-2.0 | App source not public | No | **Responses API only** | Yes | **Best**: Seatbelt / Landlock+bwrap / Windows sandbox | Analytics on in `codex exec` | 133k★ |
| Zed | GPL-3.0 | Native | **Full editor** | OpenAI-compatible, Ollama, LM Studio | Yes; hosts agents over ACP | Tool approval | Telemetry on by default | 92k★ |
| Cline | Apache-2.0 | VS Code extension; desktop beta (read-only viewer) | Via VS Code | Yes | Yes | Approve each action | PostHog (default unclear) | 71k★ |
| Kilo Code | MIT | Desktop source not public | – | Same as OpenCode (its CLI is an OpenCode fork) | Yes | Same as OpenCode | PostHog on | 28k★ |
| Crush | FSL-1.1-MIT | No | No | Yes | Yes | Asks by default | Metrics on | 29k★ |
| Qwen Code | Apache-2.0 | Tauri shell | No | Yes | Yes | Inherited from Gemini CLI | Usage stats on | 29k★ |
| Gemini CLI | Apache-2.0 | No | No | **Gemini API only** | Yes | Approvals, Docker sandbox | Usage stats on | – |
| Continue / Void / Roo Code | Apache-2.0 | – | – | – | – | – | – | **Unmaintained or archived** |

## Why OpenCode v2, and how we handle its weak spots

| Weak spot | Mitigation in this project |
|---|---|
| Releases several times a day; v2 is a rewrite | **Distribution, not a deep fork.** We pin one release and keep our changes in plugins, config, MCP servers and a small documented patch set. An upgrade is a pin bump plus an eval run. (Void died largely because it couldn't keep up with rebasing a VS Code fork.) |
| Large codebase (~650k lines in the monorepo) | We build only the packages we ship. Our own code stays small and auditable. |
| **No OS sandbox.** Its [SECURITY.md](https://github.com/anomalyco/opencode/blob/dev/SECURITY.md) says the permission system is "a UX feature" | We add a fail-closed sandbox plugin around shell commands and stdio MCP servers. See [plan §6](plan.md#6-security-model). |
| Phone-home: model catalog, updater, hosted "free models" | Turn these off in managed config and env vars, and prove it with an egress-blocked CI test. |
| Desktop app has no real editor | Add an editor through the GUI plugin SDK (the terminal, files and review panels are built the same way), or use VS Code or Zed as the editor. See [plan §10](plan.md#10-decisions-needed-from-you). |
| History: CVE-2026-22812, an unauthenticated local server with permissive CORS (fixed in 1.0.216) | The server binds to localhost only and requires a token; we track upstream security fixes. |

## What we take from the "self-improving" harnesses

**[Hermes Agent](https://github.com/NousResearch/hermes-agent)** (Nous Research, MIT, Python). Calls itself "the self-improving AI agent." We take these ideas:
- **Bounded memory.** `MEMORY.md` is capped at 2,200 characters and `USER.md` at 1,375, and memory is frozen at the start of each session.
- **Injection scanning** on every memory write.
- **Skills** stored as SKILL.md files (the [Agent Skills](https://agentskills.io/specification) format).
- **A curator for skills.** It moves unused skills from active to stale (14 days) to archived (30 days) and never deletes automatically. It also keeps an append-only **ledger** with per-entry **rollback**.

We change one thing: Hermes lets the agent write skills **without review by default** (`skills.write_approval: false`). Ours goes through review.

**[Pi](https://github.com/earendil-works/pi)** (MIT, TypeScript). Its system prompt and tool definitions together are under 1,000 tokens, with four tools and everything else as extensions. "You ask the agent to extend itself": extensions hot-reload, and sessions branch into a tree so side quests stay isolated. We take the **small core plus extensions** design. We don't take its no-permissions stance.

**[DeepSeek Harness (`dsh`)](https://github.com/deepseek-ai/deepseek-harness)** (MIT, TypeScript, developer preview). Everything is a plugin, including models, tools, sessions, sandboxes and the agent loop. **Hot reload is transactional: if new code fails to load, it reverts to the last stable version.** We take this for any plugin code the agent drafts. I found no documented learning loop.

**[Harness²](https://github.com/google-research/harness2)** (Google Research, Apache-2.0, [paper](https://arxiv.org/abs/2610.14224)). This is the most relevant "Google self-improving harness":
- The harness is eight editable files: system prompt, guardrails, memory, skills, tool guidance, scripts, subagents and plugins.
- It runs a **propose → probe → compose** loop. It proposes edits, re-runs the same task under each edited harness, and **keeps only edits that measurably improved the result**.
- An outer loop stores lessons together with the evidence for them.
- **Its default executor is OpenCode**, so it fits directly.
- Its README warns that executors run with unrestricted network access. We only run it inside our sandbox.

Related Google work: [AlphaEvolve](https://cloud.google.com/blog/products/ai-machine-learning/alphaevolve-on-google-cloud), which uses evolutionary search scored by automated evaluators.

**Research lessons that shape the design:**
- [ACE](https://arxiv.org/abs/2510.04618): update context with small itemized **deltas**, never wholesale rewrites. Rewrites cause "context collapse": one baseline shrank from 18k to 122 tokens and accuracy dropped below no-context.
- [Darwin Gödel Machine](https://sakana.ai/dgm/): the self-improving agent **removed its own hallucination checks and faked a test log**. Evals and graders must be out of the agent's reach.
- [ImpossibleBench](https://arxiv.org/abs/2510.20270): agents edit tests to pass. Hidden tests and "stop if the test looks wrong" instructions nearly eliminate this.
- [MINJA](https://arxiv.org/abs/2503.03704): memory-injection attacks succeed 98% of the time. Memory writes must be scanned and capped.
- [SICA](https://arxiv.org/abs/2504.15228): an asynchronous overseer plus safety evals that every version must pass.
- [GEPA](https://arxiv.org/abs/2507.19457): reflective prompt evolution with a Pareto set of candidates, using far fewer rollouts than RL.

## How this was verified

**Confirmed directly in this session:**
- Repository locations, by `git ls-remote`.
- License files: OpenCode MIT, Goose Apache-2.0, Pi MIT, Hermes MIT, DeepSeek Harness MIT, Harness² Apache-2.0.
- Continue's read-only notice in its README.
- OpenCode's "no sandbox" statement in SECURITY.md.
- OpenCode's `OPENCODE_DISABLE_*` flags, in source.
- OpenCode's docs on providers, permissions, managed config, LSP and MCP.
- The GUI plugin architecture.
- Hugging Face licenses for the recommended models.

**From reading repos and docs, not re-checked:** everything else. Star counts come from repo pages. Model benchmarks are vendor-reported.

## Sources

- **OpenCode**
  - Repo: https://github.com/anomalyco/opencode
  - Docs: https://opencode.ai/docs/providers/ · https://opencode.ai/docs/permissions/ · https://opencode.ai/docs/lsp/
  - CVE: https://www.wiz.io/vulnerability-database/cve/cve-2026-22812
- **Goose:** https://github.com/aaif-goose/goose · https://goose-docs.ai/docs/guides/goose-permissions
- **Pi:** https://github.com/earendil-works/pi · https://mariozechner.at/posts/2025-11-30-pi-coding-agent/ · https://lucumr.pocoo.org/2026/1/31/pi/
- **Hermes:** https://hermes-agent.nousresearch.com/docs/user-guide/features/memory · https://hermes-agent.nousresearch.com/docs/user-guide/features/curator · https://hermes-agent.nousresearch.com/docs/user-guide/security
- **DeepSeek Harness:** https://github.com/deepseek-ai/deepseek-harness · https://www.deepseek.com/en/harness/
- **Harness²:** https://github.com/google-research/harness2 · https://arxiv.org/abs/2610.14224
- **Codex sandboxing:** https://github.com/openai/codex · https://openai.com/index/building-codex-windows-sandbox/
- **Anthropic sandbox-runtime:** https://github.com/anthropic-experimental/sandbox-runtime
- **Unmaintained or restricted:** https://github.com/continuedev/continue · https://github.com/voideditor/void · https://github.com/RooCodeInc/Roo-Code · https://github.com/charmbracelet/crush
