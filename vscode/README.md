# Coder for VS Code

Opens Coder (your team's hardened OpenCode, running on your own models) next to your editor.

- **Coder: Open** (`Ctrl+Esc` / `Cmd+Esc`): Coder's terminal UI beside the editor, in the workspace folder.
- **Coder: Add File or Selection to Chat** (`Ctrl+Alt+K` / `Cmd+Alt+K`): sends `@file#L10-20` to Coder.
- **Coder: Connect a Model Server** and **Coder: Check Setup** run `coder connect` and `coder doctor`.

Works over **Remote-SSH**: the extension runs on the server and starts the Coder checkout there
(set `coder.path` in the remote settings if it isn't at `~/Coder`).

Install it with `./coder vscode` from your Coder checkout.
