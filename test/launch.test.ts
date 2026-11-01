import { expect, test } from "bun:test"
import { mkdtempSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeExecPlan } from "../src/launch"

test.skipIf(process.platform === "win32")("exec plan passes env and args through the shell untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "coder-plan-"))
  const plan = join(dir, "exec.1")
  const tricky = `it's "quoted" $HOME \`cmd\` \\ back\nnew line`
  writeExecPlan(plan, ["sh", "-c", 'printf "%s|%s" "$X" "$1"', "sh", "arg with 'quote' and $VAR"], {
    X: tricky,
    "BAD-NAME": "ignored",
  })
  const r = Bun.spawnSync(["sh", "-c", `. '${plan}'`], { env: { PATH: process.env.PATH ?? "" } })
  expect(r.stdout.toString()).toBe(`${tricky}|arg with 'quote' and $VAR`)
  expect(existsSync(plan)).toBe(false) // the plan removes itself before exec
  rmSync(dir, { recursive: true, force: true })
})
