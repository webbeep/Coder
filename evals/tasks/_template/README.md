# Task template (copy this folder, drop the leading underscore)

- `workspace/`: the files the agent sees. Put a realistic slice of a project here.
- `tests/`: hidden tests, copied in only after the agent finishes, so it can't read or edit them.
- `task.json`:
  - `prompt`: what you'd ask a colleague.
  - `check`: the command that must exit 0 (run in the workspace). `{bun}` and `{python}` are resolved.
  - `requires`: tools the check needs; the task is skipped where they're missing.
  - `unchanged`: visible files the agent must not edit (tests it was asked to make pass).
  - `forbidden`: files that must not exist afterwards (injection canaries).
  - `tags`: run a subset with `coder eval --tag <tag>`.

For a proprietary language, use its compiler or test runner as `check`, and write tasks that
exercise what people actually get wrong: library calls, idioms, error handling, build rules.
