// Per-user state outside git: connected model servers and their secrets.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { ProviderEntry } from "./connect/formats"
import { parseJsonc } from "./jsonc"
import { paths } from "./paths"

export interface UserProviders {
  providers: Record<string, ProviderEntry>
  /** Default model as "provider/model". */
  model?: string
}

export function readJsoncFile<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  return parseJsonc<T>(readFileSync(file, "utf8"), file)
}

export function writeJson(file: string, data: unknown, mode?: number) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", mode ? { mode } : undefined)
  if (mode && process.platform !== "win32") chmodSync(file, mode)
}

export function readUserProviders(): UserProviders {
  return readJsoncFile<UserProviders>(paths.providers(), { providers: {} })
}

export function saveUserProvider(id: string, entry: ProviderEntry, makeDefault?: string) {
  const data = readUserProviders()
  data.providers[id] = entry
  if (makeDefault) data.model = makeDefault
  writeJson(paths.providers(), data, 0o600)
}

export function removeUserProvider(id: string): boolean {
  const data = readUserProviders()
  if (!data.providers[id]) return false
  delete data.providers[id]
  if (data.model?.startsWith(id + "/")) delete data.model
  writeJson(paths.providers(), data, 0o600)
  return true
}

export function secretPath(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`Invalid secret name: ${name}`)
  return join(paths.secrets(), `${name}.key`)
}

/** Stores a secret readable only by this user (0600 on macOS/Linux; per-user profile ACLs on Windows). */
export function saveSecret(name: string, value: string): string {
  const file = secretPath(name)
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  if (process.platform !== "win32") chmodSync(dirname(file), 0o700)
  writeFileSync(file, value.trim(), { mode: 0o600 })
  if (process.platform !== "win32") chmodSync(file, 0o600)
  return file
}

export function hasSecret(name: string): boolean {
  return existsSync(secretPath(name))
}

/** The config reference OpenCode resolves at load time, so keys never sit in config files. */
export function secretRef(name: string): string {
  return fileRef(secretPath(name))
}

/** OpenCode substitutes {file:…} in raw config text: forward slashes avoid escaping issues on Windows. */
export function fileRef(path: string): string {
  return `{file:${path.replace(/\\/g, "/")}}`
}
