// Builds the OpenCode configuration Coder launches with.
//
// OpenCode reads config in this order (later wins): global dir (OPENCODE_CONFIG_DIR, which we
// point at a generated folder) → project opencode.json (only for trusted projects) →
// OPENCODE_CONFIG_CONTENT (Coder's security policy) → admin-managed files.
// Permission rules from all layers are concatenated and the LAST match wins, so the policy's
// deny rules can't be undone by a project; the Coder plugin enforces the same rules again in code.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { CoderPluginOptions } from "../plugins/coder/server"
import type { ProviderEntry } from "./connect/formats"
import { parseJsonc } from "./jsonc"
import { coderHome, paths } from "./paths"
import type { SandboxStatus } from "./sandbox-status"
import { personal, readPersonalMcp, readPersonalPlugins } from "./extend"
import { type CoderSettings, merge } from "./settings"
import { fileRef, hasSecret, readJsoncFile, readUserProviders, secretPath, writeJson } from "./store"

export interface Composed {
  configDir: string
  config: Record<string, any>
  policy: Record<string, any>
  env: Record<string, string>
  model?: string
  warnings: string[]
}

const SECRET_REF = /^\{secret:([a-z0-9][a-z0-9-]*)\}$/

/** Replaces "{secret:id}" with a file reference to this person's stored key. */
export function resolveSecrets(providers: Record<string, ProviderEntry>, warnings: string[]): Record<string, ProviderEntry> {
  const out: Record<string, ProviderEntry> = {}
  for (const [id, p] of Object.entries(providers)) {
    const settings = { ...p.settings }
    for (const [k, v] of Object.entries(settings)) {
      const m = typeof v === "string" ? SECRET_REF.exec(v) : null
      if (!m) continue
      if (hasSecret(m[1]!)) settings[k] = fileRef(secretPath(m[1]!))
      else {
        delete settings[k]
        warnings.push(`No key stored for "${m[1]}". Run: ./coder key ${m[1]}`)
      }
    }
    out[id] = { ...p, settings }
  }
  return out
}

/** Names of environment variables referenced as {env:NAME} anywhere in provider settings. */
export function envRefs(providers: Record<string, ProviderEntry>): string[] {
  const names = new Set<string>()
  const walk = (v: unknown) => {
    if (typeof v === "string") for (const m of v.matchAll(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g)) names.add(m[1]!)
    else if (v && typeof v === "object") Object.values(v).forEach(walk)
  }
  walk(providers)
  return [...names]
}

const SECRET_READ_PATTERNS = ["*.env", "*.env.*", "*/.ssh/*", "*/.aws/*", "*/.gnupg/*", "*/.kube/*", "*/.netrc", "*/.git-credentials", "*id_rsa", "*id_ed25519", "*id_ecdsa"]
const PROTECTED_EDIT_PATTERNS = [".git/*", "*/.git/*", ".opencode/*", "*/.opencode/*", "opencode.json", "opencode.jsonc", "*/opencode.json", "*/opencode.jsonc", ".envrc", "*/.envrc", ".vscode/tasks.json", ".vscode/settings.json", ".vscode/launch.json"]

export function buildPolicy(settings: CoderSettings, home: string): Record<string, any> {
  const rules: { action: string; resource: string; effect: string }[] = []
  for (const r of SECRET_READ_PATTERNS) rules.push({ action: "read", resource: r, effect: "deny" })
  for (const ex of ["*.env.example", "*.env.sample", "*.env.template"]) rules.push({ action: "read", resource: ex, effect: "allow" })
  for (const r of PROTECTED_EDIT_PATTERNS) rules.push({ action: "edit", resource: r, effect: "deny" })
  const h = home.replace(/\\/g, "/")
  rules.push({ action: "read", resource: `${h}/secrets/*`, effect: "deny" })
  rules.push({ action: "edit", resource: `${h}/*`, effect: "deny" })
  rules.push({ action: "edit", resource: `${h}/memory/MEMORY.md`, effect: "ask" })
  rules.push({ action: "webfetch", resource: "*", effect: settings.web.fetch ? "ask" : "deny" })
  rules.push({ action: "websearch", resource: "*", effect: settings.web.search ? "ask" : "deny" })
  return { permissions: rules }
}

export function compose(opts: { settings: CoderSettings; sandbox: SandboxStatus; cwd: string; allowSelfEdit?: boolean }): Composed {
  const { settings, sandbox } = opts
  const warnings: string[] = []
  const home = coderHome()
  const memoryFile = paths.memory()
  const knowledgeDir = paths.knowledge

  // OpenCode's database lives in Coder's folder; SQLite can't create a missing parent folder.
  mkdirSync(join(home, "data"), { recursive: true })
  if (!existsSync(memoryFile)) {
    mkdirSync(join(memoryFile, ".."), { recursive: true })
    writeFileSync(memoryFile, "# Personal memory\n\nThings Coder should remember about you and your setup. Keep it short.\n")
  }

  const base = parseJsonc<Record<string, any>>(readFileSync(join(paths.config, "opencode.jsonc"), "utf8"), "config/opencode.jsonc")
  const team = readJsoncFile<{ providers?: Record<string, ProviderEntry>; model?: string | null }>(join(paths.config, "models.jsonc"), {})
  const user = readUserProviders()
  const providers = resolveSecrets({ ...(team.providers ?? {}), ...user.providers }, warnings)
  const model = user.model ?? team.model ?? firstModel(providers)
  if (!Object.keys(providers).length) warnings.push("No model server connected yet. Run: ./coder connect")

  // Personal additions: `coder skill add`, `coder mcp add/import`, `coder plugin add`, `coder tool new`.
  const personalMcp = readPersonalMcp()
  const personalSkills = existsSync(personal.skills()) ? [personal.skills()] : []
  const allowSelfEdit = opts.allowSelfEdit ?? process.env.CODER_ALLOW_SELF_EDIT === "1"
  const pluginOptions: CoderPluginOptions = {
    coderRoot: paths.root,
    coderHome: home,
    knowledgeDir,
    memoryFile,
    allowSelfEdit,
    memoryChars: settings.memory.maxChars,
    indexChars: settings.knowledge.indexMaxChars,
    auditDir: join(home, "audit"),
    stripEnv: envRefs(providers),
    sandbox: {
      mode: sandbox.mode,
      available: sandbox.available,
      reason: sandbox.reason,
      runtime: sandbox.runtime,
      srtCli: sandbox.srtCli,
      allowedDomains: settings.sandbox.allowedDomains,
      extraWrite: settings.sandbox.allowWrite.map((p) => resolve(p)),
      extraDenyRead: settings.sandbox.denyRead.map((p) => resolve(p)),
      mcp: merge(settings.mcp, personalMcp.sandbox),
    },
  }

  const slash = (p: string) => p.replace(/\\/g, "/")
  let config: Record<string, any> = merge(base, settings.opencode)
  const plugins: any[] = [{ package: join(paths.plugins, "coder"), options: pluginOptions }]
  const editor = join(paths.plugins, "coder-editor")
  if (existsSync(join(editor, "gui-experimental.cjs"))) plugins.push(editor)
  plugins.push(...readPersonalPlugins())
  config = merge(config, {
    plugins,
    skills: [paths.skills, ...personalSkills],
    mcp: { servers: personalMcp.servers },
    instructions: [join(knowledgeDir, "INDEX.md"), memoryFile],
    providers,
    permissions: [
      // Knowledge and memory live outside projects; reading them needs no prompt.
      { action: "external_directory", resource: `${slash(knowledgeDir)}/*`, effect: "allow" },
      { action: "external_directory", resource: `${slash(join(home, "memory"))}/*`, effect: "allow" },
      { action: "external_directory", resource: `${slash(paths.skills)}/*`, effect: "allow" },
      ...personalSkills.map((d) => ({ action: "external_directory", resource: `${slash(d)}/*`, effect: "allow" })),
    ],
  })
  if (model) {
    config.model = model
    // Titles and summaries use the same server, never a hosted default.
    config.agents = merge(config.agents ?? {}, { title: { model } })
  }

  // Per user and per checkout (tests and multiple checkouts never overwrite each other's config).
  const configDir = join(home, "run", `config-${createHash("sha256").update(paths.root).digest("hex").slice(0, 10)}`)
  writeJson(join(configDir, "opencode.json"), config, 0o600)

  const policy = buildPolicy(settings, home)
  const trusted = settings.trustedProjects.some((p) => slash(resolve(opts.cwd)).startsWith(slash(resolve(p))))
  const env: Record<string, string> = {
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(policy),
    OPENCODE_DB: join(home, "data", "opencode.db"),
    // No calls home: model catalog, self-update, hosted free models.
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_FREE_MODELS: "1",
    // Don't pick up other tools' settings and skills from ~/.claude.
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    CODER_ROOT: paths.root,
    CODER_HOME: home,
    CODER_KNOWLEDGE: knowledgeDir,
    CODER_MEMORY: memoryFile,
  }
  // A cloned repo can't load its own plugins or loosen settings until you trust it.
  if (!trusted) env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"
  if (sandbox.mode === "required" && !sandbox.available)
    warnings.push(`Sandbox unavailable (${sandbox.reason}); shell commands are blocked. Run: ./coder doctor`)
  if (sandbox.mode === "off") warnings.push("Sandbox is OFF: commands run with your full permissions.")
  return { configDir, config, policy, env, model, warnings }
}

function firstModel(providers: Record<string, ProviderEntry>): string | undefined {
  for (const [id, p] of Object.entries(providers)) {
    const m = Object.keys(p.models ?? {})[0]
    if (m) return `${id}/${m}`
  }
  return undefined
}
