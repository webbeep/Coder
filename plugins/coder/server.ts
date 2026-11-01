// Coder's guardrails, loaded into OpenCode as a server plugin.
//
//  - Shell commands and local MCP servers run inside the OS sandbox (fail-closed).
//  - The agent can't write files that run code automatically, agent config, or Coder's own engine.
//  - The agent can't read credentials.
//  - Writes to knowledge, memory, AGENTS.md and skills are scanned for injected instructions,
//    hidden characters and secrets, and always-loaded files have size limits.
//  - MCP tools are pinned on first use; a tool whose definition later changes is disabled.
//  - Every tool call is appended to a local audit log.
//
// The plugin talks to OpenCode only through its public plugin API, so it has no imports from OpenCode.
import { createHash } from "node:crypto"
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describeFindings, scanText } from "../../src/guard/scan"
import { isLongLivedContext, normalize, type PolicyOptions, protectedReason, secretReason, sizeLimit } from "./policy"
import { buildSrtSettings, mcpSettings, type SandboxMode } from "./sandbox"

export interface CoderPluginOptions {
  coderRoot: string
  coderHome: string
  knowledgeDir: string
  memoryFile: string
  allowSelfEdit: boolean
  memoryChars: number
  indexChars: number
  auditDir: string
  /** Environment variables (model API keys) that shell commands must never see. */
  stripEnv: string[]
  sandbox: {
    mode: SandboxMode
    available: boolean
    reason?: string
    /** Interpreter for sandbox-runtime's CLI (node or bun) and the CLI script. */
    runtime?: string
    srtCli?: string
    allowedDomains: string[]
    extraWrite: string[]
    extraDenyRead: string[]
    mcp: Record<string, { allowedDomains?: string[] }>
  }
}

// The subset of OpenCode's plugin context this plugin uses (see @opencode/plugin).
type Hook<E> = (name: string, cb: (event: E) => void | Promise<void>) => Promise<unknown>
interface Ctx {
  options: Record<string, unknown>
  location: { directory: string; project?: { directory?: string } }
  shell: { hook: Hook<{ command: string; cwd: string; shell: string; env: Record<string, string | undefined> }> }
  permission: { hook: Hook<{ action: string; resources: readonly string[]; effect: "allow" | "ask" | "deny"; message?: string }> }
  tool: { hook: Hook<any> }
  session: { hook: Hook<any> }
  mcp: { transform: (cb: (editor: McpEditor) => void) => Promise<unknown> }
}
interface McpEditor {
  list(): readonly [string, any][]
  update(name: string, cb: (config: any) => void): void
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const PATCH_TARGET = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm

export function patchTargets(patchText: string): string[] {
  return [...patchText.matchAll(PATCH_TARGET)].map((m) => m[1]!.trim())
}

/** Lines a patch adds (what would end up in the files). */
export function patchAddedText(patchText: string): string {
  return patchText
    .split("\n")
    .filter((l) => l.startsWith("+"))
    .map((l) => l.slice(1))
    .join("\n")
}

export function mcpToolServer(tool: string, servers: readonly string[]): string | undefined {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_")
  return servers.find((s) => tool.startsWith(clean(s) + "_"))
}

function writeExecutable(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  if (process.platform !== "win32") chmodSync(file, 0o755)
}

export default {
  id: "coder",
  async setup(ctx: Ctx) {
    const o = ctx.options as unknown as CoderPluginOptions
    const base = ctx.location.directory
    const policy: PolicyOptions = {
      coderRoot: o.coderRoot,
      coderHome: o.coderHome,
      knowledgeDir: o.knowledgeDir,
      memoryFile: o.memoryFile,
      allowSelfEdit: o.allowSelfEdit,
    }
    const limits = { ...policy, memoryChars: o.memoryChars, indexChars: o.indexChars }
    const projectDirs = [...new Set([base, ctx.location.project?.directory].filter((d): d is string => Boolean(d)))]
    const runDir = join(o.coderHome, "run", sha256(base).slice(0, 16))
    const sb = o.sandbox
    const srtBase = buildSrtSettings({
      projectDirs,
      coderRoot: o.coderRoot,
      coderHome: o.coderHome,
      memoryFile: o.memoryFile,
      allowedDomains: sb.allowedDomains,
      extraWrite: sb.extraWrite,
      extraDenyRead: sb.extraDenyRead,
      allowSelfEdit: o.allowSelfEdit,
    })

    // --- Sandbox wrapper: OpenCode runs `bash -c <command>`; this file is named bash so OpenCode
    // still parses the command with bash rules for permissions, then hands it to sandbox-runtime.
    let wrapper: string | undefined
    if (sb.mode === "required" && sb.available && sb.runtime && sb.srtCli && process.platform !== "win32") {
      const settingsFile = join(runDir, "shell.json")
      mkdirSync(runDir, { recursive: true })
      writeFileSync(settingsFile, JSON.stringify(srtBase, null, 2))
      wrapper = join(runDir, "bin", "bash")
      writeExecutable(
        wrapper,
        [
          "#!/bin/sh",
          "# Generated by Coder: runs the agent's shell commands inside the OS sandbox.",
          '[ "$1" = "-c" ] && [ $# -eq 2 ] || { echo "coder-sandbox: expected bash -c <command>" >&2; exit 126; }',
          `exec ${shq(sb.runtime)} ${shq(sb.srtCli)} --settings ${shq(settingsFile)} -c "$2"`,
          "",
        ].join("\n"),
      )
    }

    await ctx.shell.hook("create.before", (ev) => {
      for (const name of o.stripEnv) delete ev.env[name]
      // The desktop launcher isolates OpenCode's service state; give commands the user's real value back.
      const orig = ev.env.CODER_INTERNAL_ORIG_XDG_STATE_HOME
      if (orig !== undefined) {
        if (orig) ev.env.XDG_STATE_HOME = orig
        else delete ev.env.XDG_STATE_HOME
      }
      for (const name of Object.keys(ev.env)) if (name.startsWith("CODER_INTERNAL_")) delete ev.env[name]
      if (sb.mode !== "required") return
      if (!wrapper) {
        throw new Error(
          `Coder's sandbox is not available (${sb.reason ?? "unknown reason"}), so shell commands are blocked. ` +
            `Ask the user to run "coder doctor" to fix it.`,
        )
      }
      ev.shell = wrapper
    })

    // --- Permission decisions OpenCode asks for: hard denies that no config can loosen.
    await ctx.permission.hook("evaluate", (ev) => {
      if (ev.action === "edit") {
        for (const r of ev.resources) {
          const why = protectedReason(normalize(r, base), policy)
          if (why) {
            ev.effect = "deny"
            ev.message = `Coder does not let the agent change ${r}: ${why}.`
            return
          }
        }
      }
      if (ev.action === "read") {
        for (const r of ev.resources) {
          const why = secretReason(normalize(r, base), policy)
          if (why) {
            ev.effect = "deny"
            ev.message = `Coder does not let the agent read ${r}: ${why}.`
            return
          }
        }
      }
      // Without a sandbox every command needs a person to approve it.
      if (ev.action === "shell" && sb.mode === "ask" && ev.effect === "allow") ev.effect = "ask"
    })

    // --- Content checks on writes that become long-lived context.
    await ctx.tool.hook("execute.before", (ev: { tool: string; input: any }) => {
      const input = ev.input ?? {}
      if (ev.tool === "read" && typeof input.path === "string") {
        const why = secretReason(normalize(input.path, base), policy)
        if (why) throw new Error(`Coder does not let the agent read ${input.path}: ${why}.`)
      }
      let targets: string[] = []
      let added = ""
      if ((ev.tool === "write" || ev.tool === "edit") && typeof input.path === "string") {
        targets = [input.path]
        added = String(ev.tool === "write" ? (input.content ?? "") : (input.newString ?? ""))
      } else if (ev.tool === "patch" && typeof input.patchText === "string") {
        targets = patchTargets(input.patchText)
        added = patchAddedText(input.patchText)
      }
      for (const t of targets) {
        const abs = normalize(t, base)
        const why = protectedReason(abs, policy)
        if (why) throw new Error(`Coder does not let the agent change ${t}: ${why}.`)
        if (!isLongLivedContext(abs, policy)) continue
        const findings = scanText(added)
        if (findings.length) throw new Error(describeFindings(t, findings))
        const limit = sizeLimit(abs, limits)
        if (limit !== undefined) {
          const current = existsSync(abs) ? readFileSync(abs, "utf8") : ""
          const next =
            ev.tool === "write"
              ? added.length
              : ev.tool === "edit"
                ? current.length + (String(input.newString ?? "").length - String(input.oldString ?? "").length)
                : current.length + added.length
          if (next > limit)
            throw new Error(
              `${t} would be ${next} characters; the limit is ${limit} because it is loaded into every session. ` +
                `Merge or remove old entries first, or move detail into a separate knowledge file and link it from the index.`,
            )
        }
      }
    })

    // --- Local MCP servers run sandboxed too, each with its own network allowlist.
    const mcpServers: string[] = []
    await ctx.mcp.transform((editor) => {
      mcpServers.length = 0
      for (const [name, config] of editor.list()) {
        mcpServers.push(name)
        if (config?.type !== "local" || sb.mode !== "required") continue
        if (!sb.available || !sb.runtime || !sb.srtCli) {
          editor.update(name, (c) => {
            c.disabled = true
          })
          continue
        }
        const command: string[] = config.command ?? []
        if (command[0] === sb.runtime && command[1] === sb.srtCli) continue // already wrapped
        const file = join(runDir, "mcp", `${name.replace(/[^A-Za-z0-9_-]/g, "_")}.json`)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, JSON.stringify(mcpSettings(srtBase, sb.mcp[name]?.allowedDomains ?? []), null, 2))
        // Model API keys stay out of MCP servers too (`env -u` drops them inside the sandbox).
        const unset = o.stripEnv.flatMap((v) => ["-u", v])
        editor.update(name, (c) => {
          c.command = [sb.runtime, sb.srtCli, "--settings", file, "--", ...(unset.length ? ["env", ...unset] : []), ...command]
        })
      }
    })

    // --- MCP "rug pull" protection: pin each tool definition the first time it is seen.
    const pinsFile = join(o.coderHome, "mcp-pins.json")
    // Cached between model requests; re-read only when the file changes (e.g. `coder mcp approve`).
    let pinCache: { mtime: number; pins: Record<string, Record<string, string>> } = { mtime: -1, pins: {} }
    const loadPins = () => {
      let mtime = 0
      try {
        mtime = statSync(pinsFile).mtimeMs
      } catch {}
      if (mtime !== pinCache.mtime) {
        let pins: Record<string, Record<string, string>> = {}
        try {
          pins = JSON.parse(readFileSync(pinsFile, "utf8"))
        } catch {}
        pinCache = { mtime, pins }
      }
      return pinCache.pins
    }
    await ctx.session.hook("context", (ev: { tools: Record<string, { description: string; input: unknown }>; system: { type: "text"; text: string }[] }) => {
      if (!mcpServers.length) return
      const pins = loadPins()
      let changed = false
      const blocked: string[] = []
      for (const [tool, def] of Object.entries(ev.tools)) {
        const server = mcpToolServer(tool, mcpServers)
        if (!server) continue
        const hash = sha256(`${def.description}\n${JSON.stringify(def.input)}`)
        const pinned = pins[server]?.[tool]
        if (!pinned) {
          ;(pins[server] ??= {})[tool] = hash
          changed = true
        } else if (pinned !== hash) {
          delete ev.tools[tool]
          blocked.push(`${tool} (server "${server}")`)
        }
      }
      if (changed) {
        mkdirSync(dirname(pinsFile), { recursive: true })
        writeFileSync(pinsFile, JSON.stringify(pins, null, 2))
        pinCache = { mtime: statSync(pinsFile).mtimeMs, pins }
      }
      if (blocked.length)
        ev.system.push({
          type: "text",
          text:
            `Coder disabled these MCP tools because their definitions changed after they were first approved: ${blocked.join(", ")}. ` +
            `Tell the user; if the change is expected they can review it and run "coder mcp approve <server>".`,
        })
    })

    // --- Audit log: one JSON line per tool call, kept on this machine.
    await ctx.tool.hook("execute.after", (ev: any) => {
      try {
        const day = new Date().toISOString().slice(0, 10)
        const file = join(o.auditDir, `${day}.jsonl`)
        mkdirSync(o.auditDir, { recursive: true })
        const input = JSON.stringify(ev.input ?? null)
        appendFileSync(
          file,
          JSON.stringify({
            time: new Date().toISOString(),
            directory: base,
            session: ev.sessionID,
            agent: ev.agent,
            tool: ev.tool,
            status: ev.status,
            input: input.length > 2000 ? input.slice(0, 2000) + "…" : input,
            error: ev.status === "error" ? String(ev.error?.message ?? ev.error ?? "").slice(0, 500) : undefined,
          }) + "\n",
        )
      } catch {}
    })
  },
}
