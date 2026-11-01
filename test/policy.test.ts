import { describe, expect, test } from "bun:test"
import { isLongLivedContext, normalize, protectedReason, secretReason, sizeLimit } from "../plugins/coder/policy"

const o = {
  coderRoot: "/opt/coder",
  coderHome: "/home/me/.config/coder",
  knowledgeDir: "/opt/coder/knowledge",
  memoryFile: "/home/me/.config/coder/memory/MEMORY.md",
  allowSelfEdit: false,
  home: "/home/me",
  caseInsensitive: false,
}

describe("normalize", () => {
  test("resolves relative and ~ paths", () => {
    expect(normalize("src/a.ts", "/work/proj", "/home/me")).toBe("/work/proj/src/a.ts")
    expect(normalize("~/.ssh/id_rsa", "/work", "/home/me")).toBe("/home/me/.ssh/id_rsa")
    expect(normalize("../x/../y", "/work/proj", "/home/me")).toBe("/work/y")
  })
})

describe("protectedReason", () => {
  const p = (path: string, opts = o) => protectedReason(path, opts)
  test("normal project files are writable", () => {
    expect(p("/work/proj/src/main.ts")).toBeUndefined()
    expect(p("/work/proj/.github/workflows/ci.yml")).toBeUndefined()
    expect(p("/work/proj/AGENTS.md")).toBeUndefined()
  })
  test("files that run code or configure agents are not", () => {
    expect(p("/work/proj/.git/hooks/pre-commit")).toContain(".git")
    expect(p("/work/proj/.git/config")).toContain(".git")
    expect(p("/work/proj/.opencode/plugins/evil.ts")).toContain(".opencode")
    expect(p("/work/proj/opencode.json")).toContain("opencode.json")
    expect(p("/work/proj/.vscode/tasks.json")).toContain("tasks.json")
    expect(p("/work/proj/.envrc")).toBeDefined()
    expect(p("/home/me/.bashrc")).toBe("shell startup file")
    expect(p("/home/me/.ssh/authorized_keys")).toBe("SSH keys and config")
  })
  test("Coder's own engine and private dir are protected; knowledge and memory are not", () => {
    expect(p("/opt/coder/plugins/coder/server.ts")).toContain("engine")
    expect(p("/opt/coder/config/coder.jsonc")).toContain("engine")
    expect(p("/opt/coder/knowledge/acme/CHEATSHEET.md")).toBeUndefined()
    expect(p("/opt/coder/skills/knowledge/SKILL.md")).toBeUndefined()
    expect(p("/home/me/.config/coder/providers.json")).toContain("private")
    expect(p("/home/me/.config/coder/secrets/company.key")).toContain("private")
    expect(p("/home/me/.config/coder/memory/MEMORY.md")).toBeUndefined()
  })
  test("self-edit opt-in unlocks the engine but not secrets", () => {
    const dev = { ...o, allowSelfEdit: true }
    expect(p("/opt/coder/plugins/coder/server.ts", dev)).toBeUndefined()
    expect(p("/home/me/.config/coder/secrets/company.key", dev)).toBeDefined()
  })
  test("case-insensitive filesystems", () => {
    expect(p("/WORK/proj/.GIT/hooks/x", { ...o, caseInsensitive: true })).toBeDefined()
  })
})

describe("secretReason", () => {
  test("credentials are unreadable", () => {
    expect(secretReason("/home/me/.ssh/id_ed25519", o)).toBeDefined()
    expect(secretReason("/home/me/.aws/credentials", o)).toBeDefined()
    expect(secretReason("/work/proj/.env", o)).toBeDefined()
    expect(secretReason("/work/proj/.env.production", o)).toBeDefined()
    expect(secretReason("/work/proj/certs/server.key", o)).toBeDefined()
    expect(secretReason("/home/me/.config/coder/secrets/x.key", o)).toBeDefined()
    expect(secretReason("/home/me/.local/share/opencode/opencode.db", o)).toBeDefined()
  })
  test("ordinary and example files are readable", () => {
    expect(secretReason("/work/proj/.env.example", o)).toBeUndefined()
    expect(secretReason("/work/proj/src/env.ts", o)).toBeUndefined()
    expect(secretReason("/home/me/.ssh_notes.md", o)).toBeUndefined()
    expect(secretReason("/home/me/.ssh/id_ed25519.pub", o)).toBeDefined() // still inside ~/.ssh
    expect(secretReason("/work/proj/keys/deploy.pub", o)).toBeUndefined()
  })
})

describe("long-lived context", () => {
  test("knowledge, memory, AGENTS.md and skills are scanned", () => {
    expect(isLongLivedContext("/opt/coder/knowledge/INDEX.md", o)).toBe(true)
    expect(isLongLivedContext("/home/me/.config/coder/memory/MEMORY.md", o)).toBe(true)
    expect(isLongLivedContext("/work/proj/AGENTS.md", o)).toBe(true)
    expect(isLongLivedContext("/work/proj/.agents/skills/x/SKILL.md", o)).toBe(true)
    expect(isLongLivedContext("/work/proj/src/main.ts", o)).toBe(false)
  })
  test("size limits for always-loaded files", () => {
    const lim = { ...o, memoryChars: 4000, indexChars: 12000 }
    expect(sizeLimit("/home/me/.config/coder/memory/MEMORY.md", lim)).toBe(4000)
    expect(sizeLimit("/opt/coder/knowledge/INDEX.md", lim)).toBe(12000)
    expect(sizeLimit("/opt/coder/knowledge/acme/CHEATSHEET.md", lim)).toBeUndefined()
  })
})
