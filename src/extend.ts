// Bring in skills, MCP servers, plugins and custom tools from anywhere, safely.
//   coder skill add <folder|git-url> [--team] [--force]     any SKILL.md (Agent Skills format)
//   coder mcp add <name> -- <command…> | --url <url>         one MCP server
//   coder mcp import <file>                                   Claude Desktop/Code, Cursor, VS Code, OpenCode configs
//   coder plugin add <npm-name@version | folder>              OpenCode plugin (runs unsandboxed: confirm)
//   coder tool new <name>                                     scaffold a custom tool (plugin)
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, extname, join, relative, resolve } from "node:path"
import { parseArgs, str } from "./args"
import { slugify } from "./connect/formats"
import { scanText, type Finding } from "./guard/scan"
import { parseJsonc } from "./jsonc"
import { coderHome, paths } from "./paths"
import { readJsoncFile, saveSecret, secretRef, writeJson } from "./store"
import { bold, confirm, dim, green, red, yellow } from "./ui"

// ---------- personal state ----------

export const personal = {
  skills: () => join(coderHome(), "skills"),
  mcp: () => join(coderHome(), "mcp.json"),
  plugins: () => join(coderHome(), "plugins.json"),
  pluginDir: () => join(coderHome(), "plugins"),
}

export interface PersonalMcp {
  servers: Record<string, McpServer>
  /** Network allowlist per local server (it runs in the sandbox). */
  sandbox: Record<string, { allowedDomains?: string[] }>
}
export type McpServer =
  | { type: "local"; command: string[]; environment?: Record<string, string>; cwd?: string }
  | { type: "remote"; url: string; headers?: Record<string, string> }
export type PluginEntry = string | { package: string; options?: Record<string, unknown> }

export const readPersonalMcp = (): PersonalMcp => readJsoncFile(personal.mcp(), { servers: {}, sandbox: {} })
export const readPersonalPlugins = (): PluginEntry[] => readJsoncFile(personal.plugins(), [])

// ---------- skills ----------

const TEXT = new Set([".md", ".txt", ".py", ".sh", ".bash", ".js", ".mjs", ".ts", ".json", ".yaml", ".yml", ".toml", ".ps1", ".rb", ".go", ""])
const SKIP = new Set([".git", "node_modules", "__pycache__", ".venv"])

export interface SkillInfo {
  dir: string
  name: string
  description: string
}

/** Reads the YAML frontmatter fields the Agent Skills spec requires. */
export function parseSkill(dir: string): SkillInfo | undefined {
  const file = readdirSync(dir).find((f) => f.toLowerCase() === "skill.md")
  if (!file) return undefined
  const text = readFileSync(join(dir, file), "utf8")
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ""
  const field = (key: string) => {
    const m = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(fm)
    return m?.[1]?.trim().replace(/^["']|["']$/g, "")
  }
  const name = field("name")
  const description = field("description")
  if (!name || !description) return undefined
  return { dir, name, description }
}

/** Every folder with a SKILL.md, up to a few levels deep (repos, Claude Code plugins, skill packs). */
export function findSkills(root: string, depth = 4): SkillInfo[] {
  const out: SkillInfo[] = []
  const walk = (dir: string, d: number) => {
    const skill = parseSkill(dir)
    if (skill) {
      out.push(skill)
      return
    }
    if (d === 0) return
    for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && !SKIP.has(e.name)) walk(join(dir, e.name), d - 1)
  }
  walk(root, depth)
  return out
}

export function scanFolder(dir: string): { file: string; findings: Finding[] }[] {
  const out: { file: string; findings: Finding[] }[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(p)
      } else if (TEXT.has(extname(e.name).toLowerCase()) && statSync(p).size < 2_000_000) {
        const findings = scanText(readFileSync(p, "utf8"))
        if (findings.length) out.push({ file: relative(dir, p), findings })
      }
    }
  }
  walk(dir)
  return out
}

/** Clones a git URL (optionally "url#sub/dir") to a temp folder; returns the folder to import from. */
function fetchSource(source: string): { dir: string; cleanup: () => void } {
  const isGit = /^(https?:\/\/|git@|ssh:\/\/)/.test(source) || source.endsWith(".git")
  if (!isGit) {
    const dir = resolve(source)
    if (!existsSync(dir)) throw new Error(`Not found: ${dir}`)
    return { dir, cleanup: () => {} }
  }
  const [url, sub] = source.split("#")
  const tmp = mkdtempSync(join(tmpdir(), "coder-import-"))
  console.log(dim(`Cloning ${url}…`))
  // Shallow, no submodules: cloning only fetches files (a remote repo's hooks never run).
  const r = Bun.spawnSync(["git", "clone", "--depth", "1", "--no-recurse-submodules", url!, tmp], { stderr: "pipe" })
  if (r.exitCode !== 0) throw new Error(`git clone failed: ${r.stderr.toString().trim()}`)
  return { dir: sub ? join(tmp, sub) : tmp, cleanup: () => rmSync(tmp, { recursive: true, force: true }) }
}

export async function skillCommand(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  const args = parseArgs(rest, ["team", "force", "yes"])
  const team = Boolean(args.flags.team)
  const destRoot = team ? paths.skills : personal.skills()
  if (sub === "list") {
    for (const [label, dir] of [["team", paths.skills], ["personal", personal.skills()]] as const) {
      if (!existsSync(dir)) continue
      for (const s of findSkills(dir, 1)) console.log(`${bold(basename(s.dir))} ${dim(`(${label})`)}  ${s.description.slice(0, 90)}`)
    }
    return 0
  }
  if (sub === "remove" && args._[0]) {
    const dir = join(destRoot, slugify(args._[0]))
    if (!existsSync(dir)) return (console.error(red(`No ${team ? "team" : "personal"} skill ${args._[0]}.`)), 1)
    rmSync(dir, { recursive: true, force: true })
    console.log(`Removed ${dir}`)
    return 0
  }
  if (sub !== "add" || !args._[0]) {
    console.error("Usage: coder skill add <folder|git-url[#subdir]> [--team] [--force]\n       coder skill list | remove <name> [--team]")
    return 2
  }
  const { dir, cleanup } = fetchSource(args._[0])
  try {
    const skills = findSkills(dir)
    if (!skills.length) return (console.error(red("No SKILL.md with a name and description found.")), 1)
    let added = 0
    for (const skill of skills) {
      const name = slugify(skill.name)
      const findings = scanFolder(skill.dir)
      console.log(`\n${bold(name)}  ${dim(skill.description.slice(0, 100))}`)
      for (const f of findings) for (const x of f.findings) console.log(yellow(`  ! ${f.file}:${x.line} ${x.detail}`))
      if (findings.length && !args.flags.force) {
        console.log(red("  Skipped: review the flagged content, then re-run with --force if it is safe."))
        continue
      }
      const target = join(destRoot, name)
      if (existsSync(target) && !args.flags.force) {
        console.log(yellow(`  Skipped: ${target} exists (use --force to replace).`))
        continue
      }
      rmSync(target, { recursive: true, force: true })
      mkdirSync(destRoot, { recursive: true })
      cpSync(skill.dir, target, { recursive: true, filter: (src) => !SKIP.has(basename(src)) })
      console.log(green(`  Added to ${target}`))
      added++
    }
    if (added && team) console.log(dim("\nTeam skills are in the repo: open a PR to share them."))
    return added ? 0 : 1
  } finally {
    cleanup()
  }
}

// ---------- MCP ----------

const SECRET_NAME = /(key|token|secret|password|passwd|auth|credential|pat)\b/i

/** VS Code "${env:X}" / shell "${X}" / "$X" → OpenCode "{env:X}". */
function envPlaceholders(value: string): string {
  return value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, "{env:$1}").replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "{env:$1}")
}

/** Moves literal secret values into private files and references them. */
function protectSecrets(server: string, record: Record<string, string> | undefined, store: boolean): Record<string, string> | undefined {
  if (!record) return undefined
  const out: Record<string, string> = {}
  for (const [k, raw] of Object.entries(record)) {
    const v = envPlaceholders(String(raw))
    if (store && SECRET_NAME.test(k) && v && !v.includes("{env:") && !v.includes("{file:")) {
      const id = slugify(`mcp-${server}-${k}`)
      saveSecret(id, v.replace(/^Bearer\s+/i, ""))
      out[k] = /^Bearer\s+/i.test(v) ? `Bearer ${secretRef(id)}` : secretRef(id)
    } else out[k] = v
  }
  return out
}

/** Converts any common MCP config entry to OpenCode's format. */
export function convertMcpEntry(name: string, e: any, storeSecrets = true): McpServer | undefined {
  if (!e || typeof e !== "object" || e.disabled === true || e.enabled === false) return undefined
  const url = e.url ?? e.serverUrl
  const type = String(e.type ?? "").toLowerCase()
  if (url || type === "remote" || type === "http" || type === "sse" || type === "streamable-http") {
    if (!url) return undefined
    return { type: "remote", url: envPlaceholders(String(url)), headers: protectSecrets(name, e.headers, storeSecrets) }
  }
  const command: string[] = Array.isArray(e.command) ? e.command.map(String) : e.command ? [String(e.command), ...(e.args ?? []).map(String)] : []
  if (!command.length) return undefined
  const server: McpServer = { type: "local", command: command.map(envPlaceholders) }
  const env = protectSecrets(name, e.env ?? e.environment, storeSecrets)
  if (env && Object.keys(env).length) server.environment = env
  if (e.cwd) server.cwd = String(e.cwd)
  return server
}

/** Finds the server map in Claude Desktop/Code (.mcp.json), Cursor, Windsurf, Cline, VS Code (mcp.json) or OpenCode configs. */
export function extractMcpServers(doc: any): Record<string, any> {
  if (doc?.mcpServers) return doc.mcpServers
  if (doc?.servers) return doc.servers
  if (doc?.mcp?.servers) return doc.mcp.servers
  if (doc?.mcp && typeof doc.mcp === "object") return Object.fromEntries(Object.entries(doc.mcp).filter(([k]) => k !== "timeout"))
  if (doc?.opencode?.mcp?.servers) return doc.opencode.mcp.servers
  return {}
}

export async function mcpManage(sub: string | undefined, rest: string[]): Promise<number | undefined> {
  const store = readPersonalMcp()
  const save = () => writeJson(personal.mcp(), store, 0o600)
  if (sub === "list") {
    for (const [n, s] of Object.entries(store.servers))
      console.log(`${bold(n)}  ${s.type === "local" ? s.command.join(" ") : s.url}${store.sandbox[n]?.allowedDomains?.length ? dim(`  net: ${store.sandbox[n]!.allowedDomains!.join(", ")}`) : ""}`)
    if (!Object.keys(store.servers).length) console.log("No personal MCP servers. Add one: coder mcp add <name> -- <command…>")
    return 0
  }
  if (sub === "remove" && rest[0]) {
    const existed = delete store.servers[rest[0]]
    delete store.sandbox[rest[0]]
    save()
    console.log(existed ? `Removed ${rest[0]}.` : `No server ${rest[0]}.`)
    return 0
  }
  if (sub === "add") {
    const args = parseArgs(rest, [])
    const name = args._[0]
    if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) return (console.error("Usage: coder mcp add <name> [--allow host,…] [--env K=V] -- <command…>\n       coder mcp add <name> --url <url> [--header K=V]"), 2)
    const kv = (flag: string) =>
      Object.fromEntries(
        rest.flatMap((a, i) => (a === `--${flag}` && rest[i + 1] ? [rest[i + 1]!.split(/=(.*)/s).slice(0, 2)] : [])) as [string, string][],
      )
    const entry = str(args, "url")
      ? { url: str(args, "url"), headers: kv("header") }
      : { command: args.rest[0], args: args.rest.slice(1), env: kv("env") }
    const server = convertMcpEntry(name, entry)
    if (!server) return (console.error(red("Give a command after -- or a --url.")), 2)
    store.servers[name] = server
    const allow = str(args, "allow")?.split(",").map((s) => s.trim()).filter(Boolean)
    if (allow?.length) store.sandbox[name] = { allowedDomains: allow }
    save()
    console.log(green(`Added MCP server "${name}".`) + dim(" Its tools ask before running and are pinned on first use."))
    if (server.type === "local" && !allow?.length) console.log(dim(`It runs in the sandbox with no network. Allow hosts with: coder mcp add ${name} --allow host … (re-run)`))
    return 0
  }
  if (sub === "import" && rest[0]) {
    const file = resolve(rest[0])
    const doc = parseJsonc<any>(readFileSync(file, "utf8"), file)
    const found = extractMcpServers(doc)
    const only = rest.includes("--only") ? rest[rest.indexOf("--only") + 1]?.split(",") : undefined
    let n = 0
    for (const [name, entry] of Object.entries(found)) {
      if (only && !only.includes(name)) continue
      const server = convertMcpEntry(name, entry)
      if (!server) {
        console.log(yellow(`  skipped ${name} (disabled or unrecognized)`))
        continue
      }
      store.servers[name] = server
      console.log(`  + ${name}  ${dim(server.type === "local" ? server.command.join(" ") : server.url)}`)
      n++
    }
    save()
    console.log(green(`Imported ${n} MCP server(s).`) + dim(" Literal tokens were moved to private key files. Local servers run sandboxed without network until you allow hosts (coder mcp add <name> --allow …)."))
    return n ? 0 : 1
  }
  return undefined
}

// ---------- plugins and tools ----------

export async function pluginCommand(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  const args = parseArgs(rest, ["yes", "team"])
  const list = readPersonalPlugins()
  const key = (p: PluginEntry) => (typeof p === "string" ? p : p.package)
  if (sub === "list") {
    console.log(list.length ? list.map(key).join("\n") : "No personal plugins.")
    return 0
  }
  if (sub === "remove" && args._[0]) {
    writeJson(personal.plugins(), list.filter((p) => key(p) !== args._[0] && key(p) !== resolve(args._[0]!)), 0o600)
    console.log(`Removed ${args._[0]}.`)
    return 0
  }
  const spec = args._[0]
  if (sub !== "add" || !spec) return (console.error("Usage: coder plugin add <npm-name@x.y.z | folder> [--yes]\n       coder plugin list | remove <spec>"), 2)
  const local = existsSync(spec)
  if (!local && !/^(@[^/]+\/)?[^@/]+@\d+\.\d+\.\d+([-+][\w.]+)?$/.test(spec))
    return (console.error(red("Pin an exact version, e.g. opencode-wakatime@1.2.3 (or give a local folder).")), 2)
  console.log(
    yellow("Plugins run inside Coder's server with your full permissions. They are NOT sandboxed.\n") +
      "Only add plugins whose source you have reviewed. Prefer an MCP server (sandboxed) for integrations.",
  )
  if (!args.flags.yes && !confirm(`Add plugin ${spec}?`, false)) return 1
  const entry = local ? resolve(spec) : spec
  if (args.flags.team) {
    console.log(dim("Add this to opencode.plugins in config/coder.jsonc and open a PR:"))
    console.log(JSON.stringify(entry))
    return 0
  }
  writeJson(personal.plugins(), [...list.filter((p) => key(p) !== entry), entry], 0o600)
  console.log(green(`Added. It loads the next time Coder starts.`))
  return 0
}

const TOOL_TEMPLATE = (name: string) => `// A custom tool for Coder (an OpenCode plugin). Edit, then restart Coder.
// Tools run inside Coder's server with your permissions and are NOT sandboxed:
// keep them to computation and reading. For anything that calls other systems,
// write an MCP server instead (coder mcp add) — those run in the sandbox.
export default {
  id: "${name}",
  async setup(ctx: any) {
    await ctx.tool.transform((tools: any) => {
      tools.add({
        name: "${name.replace(/-/g, "_")}",
        description: "Describe what this tool does and when the agent should use it.",
        // Plain JSON Schema for the input.
        input: {
          type: "object",
          properties: { text: { type: "string", description: "Example input" } },
          required: ["text"],
        },
        execute: async (input: { text: string }) => ({ content: \`You sent: \${input.text}\` }),
      })
    })
  },
}
`

export function toolCommand(argv: string[]): number {
  const [sub, raw] = argv
  if (sub !== "new" || !raw) return (console.error("Usage: coder tool new <name>"), 2)
  const name = slugify(raw)
  const dir = join(personal.pluginDir(), name)
  if (existsSync(dir)) return (console.error(red(`${dir} already exists.`)), 1)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "server.ts"), TOOL_TEMPLATE(name))
  const list = readPersonalPlugins()
  writeJson(personal.plugins(), [...list, dir], 0o600)
  console.log(green(`Created ${join(dir, "server.ts")}`) + dim("\nEdit it, then restart Coder. The agent asks before using it, like any tool."))
  return 0
}
