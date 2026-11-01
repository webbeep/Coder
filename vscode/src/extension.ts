// Coder for VS Code: runs Coder's terminal UI in an editor-side terminal and sends file references to it.
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, relative } from "node:path"
import * as vscode from "vscode"

const NAME = "Coder"
const isWin = process.platform === "win32"
const launcherName = isWin ? "coder.cmd" : "coder"

function expand(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p
}

/** The Coder launcher: setting → the checkout we were installed from → ~/Coder → ~/coder. */
function findLauncher(context: vscode.ExtensionContext): string | undefined {
  const configured = vscode.workspace.getConfiguration("coder").get<string>("path")?.trim()
  if (configured) return expand(configured)
  const candidates: string[] = []
  try {
    const baked = JSON.parse(readFileSync(join(context.extensionPath, "dist", "coder-root.json"), "utf8")).root
    if (typeof baked === "string") candidates.push(join(baked, launcherName))
  } catch {}
  if (process.env.CODER_ROOT) candidates.push(join(process.env.CODER_ROOT, launcherName))
  candidates.push(join(homedir(), "Coder", launcherName), join(homedir(), "coder", launcherName))
  return candidates.find((c) => existsSync(c))
}

function workspaceDir(): string | undefined {
  const editor = vscode.window.activeTextEditor
  const folder = editor ? vscode.workspace.getWorkspaceFolder(editor.document.uri) : vscode.workspace.workspaceFolders?.[0]
  return folder?.uri.fsPath
}

function startTerminal(context: vscode.ExtensionContext, args: string[], title = NAME): vscode.Terminal | undefined {
  const launcher = findLauncher(context)
  if (!launcher) {
    void vscode.window
      .showErrorMessage("Coder launcher not found. Set coder.path to your Coder checkout's launcher.", "Open Settings")
      .then((choice) => choice && vscode.commands.executeCommand("workbench.action.openSettings", "coder.path"))
    return undefined
  }
  const options: vscode.TerminalOptions = {
    name: title,
    cwd: workspaceDir(),
    location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    env: { CODER_CALLER: "vscode" },
    // Run the launcher directly instead of typing into a shell: no quoting differences between shells.
    shellPath: isWin ? (process.env.ComSpec ?? "cmd.exe") : launcher,
    shellArgs: isWin ? ["/d", "/c", launcher, ...args] : args,
  }
  const terminal = vscode.window.createTerminal(options)
  terminal.show()
  return terminal
}

function coderTerminal(): vscode.Terminal | undefined {
  return vscode.window.terminals.find((t) => t.name === NAME && t.exitStatus === undefined)
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("coder.open", () => {
      const existing = coderTerminal()
      if (existing) existing.show()
      else startTerminal(context, [])
    }),
    vscode.commands.registerCommand("coder.openNew", () => startTerminal(context, [])),
    vscode.commands.registerCommand("coder.connect", () => startTerminal(context, ["connect"], "Coder: connect")),
    vscode.commands.registerCommand("coder.doctor", () => startTerminal(context, ["doctor"], "Coder: doctor")),
    vscode.commands.registerCommand("coder.addFile", async (uri?: vscode.Uri) => {
      const editor = vscode.window.activeTextEditor
      const target = uri ?? editor?.document.uri
      if (!target) return
      const root = workspaceDir()
      let ref = "@" + (root ? relative(root, target.fsPath) : target.fsPath).replace(/\\/g, "/")
      if (!uri && editor && !editor.selection.isEmpty) {
        const start = editor.selection.start.line + 1
        const end = editor.selection.end.line + 1
        ref += start === end ? `#L${start}` : `#L${start}-${end}`
      }
      const terminal = coderTerminal() ?? startTerminal(context, [])
      if (!terminal) return
      // Give a freshly started UI a moment before typing into it.
      if (!coderTerminal() || terminal.exitStatus !== undefined) await new Promise((r) => setTimeout(r, 1500))
      terminal.sendText(ref + " ", false)
      terminal.show()
    }),
  )
}

export function deactivate() {}
