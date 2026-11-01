// Path policy for the Coder plugin. Pure functions: easy to test, no OpenCode imports.
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

export interface PolicyOptions {
  /** The Coder checkout: its engine files are off-limits to the agent. */
  coderRoot: string
  /** Per-user Coder dir: secrets, model connections, personal memory. */
  coderHome: string
  knowledgeDir: string
  memoryFile: string
  /** Lets someone develop Coder with Coder (set CODER_ALLOW_SELF_EDIT=1 when launching). */
  allowSelfEdit: boolean
  home?: string
  caseInsensitive?: boolean
}

/** Absolute, forward-slash path; expands ~. */
export function normalize(p: string, base: string, home = homedir()): string {
  let s = p.trim()
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) s = join(home, s.slice(1))
  const abs = isAbsolute(s) ? resolve(s) : resolve(base, s)
  return abs.replace(/\\/g, "/")
}

const fold = (s: string, ci: boolean) => (ci ? s.toLowerCase() : s)

function within(path: string, dir: string, ci: boolean): boolean {
  const p = fold(path, ci)
  const d = fold(dir.replace(/\\/g, "/").replace(/\/+$/, ""), ci)
  return p === d || p.startsWith(d + "/")
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean)
}

// Files that make tools run code automatically, or that hold agent config. Writing
// one of these is how an injected prompt turns into persistent code execution.
const PROTECTED_NAMES = new Set(["opencode.json", "opencode.jsonc", ".envrc"])
const PROTECTED_DIRS = new Set([".git", ".opencode", ".husky"])
const PROTECTED_PAIRS: [string, string][] = [
  [".vscode", "tasks.json"],
  [".vscode", "settings.json"],
  [".vscode", "launch.json"],
  [".claude", "settings.json"],
  [".claude", "settings.local.json"],
  [".devcontainer", "devcontainer.json"],
]
const SHELL_STARTUP = [".bashrc", ".bash_profile", ".profile", ".zshrc", ".zprofile", ".zshenv", ".config/fish/config.fish"]
const CODER_ENGINE = ["config", "plugins", "src", "vscode", ".github", "upstream.json", "package.json", "bun.lock", "coder", "coder.ps1", "coder.cmd", ".coder"]

/** Returns a reason if the agent must never write this path, else undefined. */
export function protectedReason(absPath: string, o: PolicyOptions): string | undefined {
  const ci = o.caseInsensitive ?? process.platform !== "linux"
  const home = (o.home ?? homedir()).replace(/\\/g, "/")
  const segs = segments(fold(absPath, ci))
  const name = segs.at(-1) ?? ""

  if (within(absPath, o.coderHome, ci) && !within(absPath, o.memoryFile, ci))
    return "Coder's private settings and secrets"
  if (!o.allowSelfEdit && within(absPath, o.coderRoot, ci)) {
    const rel = fold(absPath, ci).slice(fold(o.coderRoot.replace(/\\/g, "/"), ci).length + 1)
    const top = rel.split("/")[0] ?? ""
    if (CODER_ENGINE.includes(top)) return "Coder's own engine and guardrails (launch with CODER_ALLOW_SELF_EDIT=1 to develop Coder)"
  }
  for (const s of segs.slice(0, -1)) if (PROTECTED_DIRS.has(s)) return `${s}/ (hooks and agent config can run code automatically)`
  if (PROTECTED_DIRS.has(name)) return `${name} (hooks and agent config can run code automatically)`
  if (PROTECTED_NAMES.has(name)) return `${name} (agent/tool config that can run code)`
  const parent = segs.at(-2) ?? ""
  for (const [dir, file] of PROTECTED_PAIRS) if (parent === dir && name === file) return `${dir}/${file} (editor config that can run code)`
  for (const f of SHELL_STARTUP) if (fold(absPath, ci) === fold(`${home}/${f}`, ci)) return "shell startup file"
  if (within(absPath, `${home}/.ssh`, ci)) return "SSH keys and config"
  return undefined
}

const SECRET_DIRS = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".azure", ".config/gh", ".config/gcloud", ".local/share/opencode"]
const SECRET_FILES = [".netrc", ".git-credentials", ".npmrc", ".pypirc"]
const KEY_NAMES = /^(id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|.*\.(pem|key|p12|pfx|kdbx))$/
const ENV_FILE = /^\.env(\..+)?$/
const ENV_EXAMPLE = /^\.env\.(example|sample|template|dist|defaults)$/

/** Returns a reason if the agent must never read this path, else undefined. */
export function secretReason(absPath: string, o: PolicyOptions): string | undefined {
  const ci = o.caseInsensitive ?? process.platform !== "linux"
  const home = (o.home ?? homedir()).replace(/\\/g, "/")
  const name = fold(segments(absPath).at(-1) ?? "", ci)
  if (within(absPath, join(o.coderHome, "secrets"), ci) || within(absPath, join(o.coderHome, "data"), ci))
    return "Coder secrets"
  for (const d of SECRET_DIRS) if (within(absPath, `${home}/${d}`, ci)) return `credentials (~/${d})`
  for (const f of SECRET_FILES) if (fold(absPath, ci) === fold(`${home}/${f}`, ci)) return `credentials (~/${f})`
  if (ENV_FILE.test(name) && !ENV_EXAMPLE.test(name)) return "environment file with secrets"
  if (KEY_NAMES.test(name) && !name.endsWith(".pub")) return "private key file"
  return undefined
}

/** Files that become long-lived agent context: scanned before every write. */
export function isLongLivedContext(absPath: string, o: PolicyOptions): boolean {
  const ci = o.caseInsensitive ?? process.platform !== "linux"
  const name = (segments(absPath).at(-1) ?? "").toLowerCase()
  if (within(absPath, o.knowledgeDir, ci) || within(absPath, o.memoryFile, ci)) return true
  if (name === "agents.md" || name === "skill.md") return true
  return segments(absPath.toLowerCase()).includes("skills")
}

/** Size limits for files loaded into every session. */
export function sizeLimit(absPath: string, o: PolicyOptions & { memoryChars: number; indexChars: number }): number | undefined {
  const ci = o.caseInsensitive ?? process.platform !== "linux"
  if (within(absPath, o.memoryFile, ci)) return o.memoryChars
  if (within(absPath, join(o.knowledgeDir, "INDEX.md"), ci)) return o.indexChars
  return undefined
}
