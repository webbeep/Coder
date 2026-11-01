// Coder's own settings: team file (config/coder.jsonc) + personal file (<coder home>/coder.jsonc).
import { join } from "node:path"
import { coderHome, paths } from "./paths"
import { readJsoncFile } from "./store"

export interface CoderSettings {
  sandbox: { mode: "auto" | "required" | "ask" | "off"; allowedDomains: string[]; allowWrite: string[]; denyRead: string[] }
  web: { fetch: boolean; search: boolean }
  memory: { maxChars: number }
  knowledge: { indexMaxChars: number }
  mcp: Record<string, { allowedDomains?: string[] }>
  opencode: Record<string, any>
  /** Personal only: project folders whose own opencode.json / .opencode may load. */
  trustedProjects: string[]
}

export const DEFAULTS: CoderSettings = {
  sandbox: { mode: "auto", allowedDomains: [], allowWrite: [], denyRead: [] },
  web: { fetch: false, search: false },
  memory: { maxChars: 4000 },
  knowledge: { indexMaxChars: 12000 },
  mcp: {},
  opencode: {},
  trustedProjects: [],
}

const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Deep merge: objects merge, arrays concatenate (deduplicated), scalars replace. */
export function merge<T>(a: T, b: unknown): T {
  if (b === undefined || b === null) return a
  if (Array.isArray(a) && Array.isArray(b)) {
    const seen = new Set<string>()
    return [...a, ...b].filter((x) => {
      const k = JSON.stringify(x)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }) as T
  }
  if (isObject(a) && isObject(b)) {
    const out: Record<string, any> = { ...a }
    for (const [k, v] of Object.entries(b)) out[k] = k in out ? merge(out[k], v) : v
    return out as T
  }
  return b as T
}

export function loadSettings(): CoderSettings {
  const team = readJsoncFile<Partial<CoderSettings>>(join(paths.config, "coder.jsonc"), {})
  // Projects can only be trusted personally, never by the shared team file.
  delete (team as any).trustedProjects
  const user = readJsoncFile<Partial<CoderSettings>>(paths.userConfig(), {})
  const trusted = readJsoncFile<string[]>(join(coderHome(), "trusted.json"), [])
  return merge(merge(merge(DEFAULTS, team), user), { trustedProjects: trusted })
}
