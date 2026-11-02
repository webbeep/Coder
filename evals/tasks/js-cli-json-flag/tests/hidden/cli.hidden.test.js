import { expect, test } from "bun:test"
import { join } from "node:path"

const run = (...args) => Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "cli.js"), ...args]).stdout.toString()

test("default output unchanged", () => expect(run("1", "2", "3")).toBe("count=3 sum=6 mean=2\n"))
test("--json", () => expect(JSON.parse(run("--json", "1", "2", "3"))).toEqual({ count: 3, sum: 6, mean: 2 }))
test("--json anywhere", () => expect(JSON.parse(run("4", "--json"))).toEqual({ count: 1, sum: 4, mean: 4 }))
