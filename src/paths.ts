import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** The Coder checkout this code is running from. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const isWin = process.platform === "win32"

/**
 * Per-user Coder directory (never in git): model connections, secrets, personal memory.
 *   Windows: %APPDATA%\Coder   macOS/Linux: $XDG_CONFIG_HOME/coder or ~/.config/coder
 * Override with CODER_HOME.
 */
export function coderHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CODER_HOME) return resolve(env.CODER_HOME)
  if (isWin) return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Coder")
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "coder")
}

export const paths = {
  root: ROOT,
  /** Downloaded upstream binaries and generated config, per checkout (gitignored). */
  local: join(ROOT, ".coder"),
  config: join(ROOT, "config"),
  plugins: join(ROOT, "plugins"),
  skills: join(ROOT, "skills"),
  knowledge: join(ROOT, "knowledge"),
  home: () => coderHome(),
  providers: () => join(coderHome(), "providers.json"),
  secrets: () => join(coderHome(), "secrets"),
  memory: () => join(coderHome(), "memory", "MEMORY.md"),
  userConfig: () => join(coderHome(), "coder.jsonc"),
}
