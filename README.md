# Coder

A secure, local-first AI coding agent for teams. Planned features:

- **Runs on your own models.** Use a model on your laptop (llama.cpp / Ollama) or your company's GPU server (vLLM / SGLang behind a gateway). Nothing is sent to public AI APIs.
- **Learns your proprietary language** from a local knowledge base (spec, docs, example code), with the language's own compiler and LSP in the loop.
- **Secure by default.** Shell commands and MCP servers run in an OS sandbox, network access is deny-by-default, there is no telemetry, and admins can lock the policy.
- **Improves itself safely.** It learns memory and skills, and every team-level change is eval-gated and human-approved, with rollback.
- **Same version for the whole team.** Clone and bootstrap, or install a signed Windows/macOS build, then point it at the shared model server.

Coder is a hardened distribution of [OpenCode v2](https://github.com/anomalyco/opencode) (MIT). It adds plugins, policy, a knowledge-base MCP server and a learning pipeline, rather than deep-forking the upstream code.

## Status

**Phase 0: research and plan.** No code yet.

- [docs/research.md](docs/research.md): which open-source harness to build on and why, comparing OpenCode, Goose, Pi, Codex, Zed and others. It also covers what we borrow from Hermes Agent, DeepSeek Harness and Google's Harness².
- [docs/plan.md](docs/plan.md): architecture, models, proprietary-language support, security model, safe self-improvement, team distribution, roadmap, and **the decisions we need before Phase 1**.
