// Builds sandbox-runtime (srt) settings. srt already blocks writes to shell rc
// files, .git/hooks, .git/config, .vscode/ and .idea/; we add agent config and
// Coder's own files, hide credentials from reads, and deny network by default.
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

export type SandboxMode = "required" | "ask" | "off"

export interface SandboxInputs {
  /** Writable roots: the project directory (and its git worktree root). */
  projectDirs: string[]
  coderRoot: string
  coderHome: string
  memoryFile: string
  allowedDomains: string[]
  extraWrite: string[]
  extraDenyRead: string[]
  allowSelfEdit: boolean
  home?: string
  platform?: NodeJS.Platform
}

export interface SrtSettings {
  network: { allowedDomains: string[]; deniedDomains: string[] }
  filesystem: { denyRead: string[]; allowRead: string[]; allowWrite: string[]; denyWrite: string[] }
}

const CREDENTIAL_PATHS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".docker",
  ".azure",
  ".netrc",
  ".git-credentials",
  ".npmrc",
  ".pypirc",
  ".config/gh",
  ".config/gcloud",
  ".local/share/opencode",
]

const BROWSER_PROFILES: Record<string, string[]> = {
  darwin: ["Library/Application Support/Google/Chrome", "Library/Application Support/Firefox", "Library/Keychains", "Library/Cookies"],
  linux: [".config/google-chrome", ".config/chromium", ".mozilla"],
}

export function buildSrtSettings(i: SandboxInputs): SrtSettings {
  const home = i.home ?? homedir()
  const platform = i.platform ?? process.platform
  const denyRead = [
    ...CREDENTIAL_PATHS.map((p) => join(home, p)),
    ...(BROWSER_PROFILES[platform] ?? []).map((p) => join(home, p)),
    join(i.coderHome, "secrets"),
    join(i.coderHome, "data"),
    ...i.extraDenyRead,
  ]
  const allowWrite = [...i.projectDirs, tmpdir(), ...(platform === "win32" ? [] : ["/tmp", join(home, ".cache")]), ...i.extraWrite]
  const denyWrite: string[] = []
  for (const dir of i.projectDirs) {
    for (const p of [".opencode", "opencode.json", "opencode.jsonc", ".envrc", ".husky", ".claude", ".devcontainer"]) denyWrite.push(join(dir, p))
  }
  // Coder's private dir (memory is edited through the agent's file tools, which are checked separately).
  denyWrite.push(i.coderHome)
  if (!i.allowSelfEdit) {
    for (const p of ["config", "plugins", "src", "vscode", ".github", ".coder", "upstream.json", "package.json", "bun.lock", "coder", "coder.ps1", "coder.cmd"])
      denyWrite.push(join(i.coderRoot, p))
  }
  return {
    network: { allowedDomains: [...new Set(i.allowedDomains)], deniedDomains: [] },
    filesystem: { denyRead: [...new Set(denyRead)], allowRead: [], allowWrite: [...new Set(allowWrite)], denyWrite: [...new Set(denyWrite)] },
  }
}

/** Adds per-MCP-server network access on top of the base settings. */
export function mcpSettings(base: SrtSettings, allowedDomains: string[]): SrtSettings {
  return { ...base, network: { ...base.network, allowedDomains: [...new Set([...base.network.allowedDomains, ...allowedDomains])] } }
}
