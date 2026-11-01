// `coder editor build`: rebuild the desktop code editor (after changing plugins/coder-editor/languages.json).
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { paths } from "./paths"
import { sha256Hex } from "./upstream"
import { green, red } from "./ui"

const DIR = join(paths.plugins, "coder-editor")
const BUNDLE = join(DIR, "gui-experimental.cjs")

export function editorCommand(argv: string[]): number {
  if (argv[0] !== "build") {
    console.error("Usage: coder editor build [--check]")
    return 2
  }
  const before = sha256Hex(new Uint8Array(readFileSync(BUNDLE)))
  const steps = [
    [process.execPath, "install", "--frozen-lockfile", "--ignore-scripts"],
    [process.execPath, "run", "build"],
  ]
  for (const cmd of steps) {
    const r = Bun.spawnSync(cmd, { cwd: DIR, stdout: "inherit", stderr: "inherit" })
    if (r.exitCode !== 0) return r.exitCode ?? 1
  }
  const after = sha256Hex(new Uint8Array(readFileSync(BUNDLE)))
  if (argv.includes("--check")) {
    if (before !== after) {
      console.error(red("The committed editor bundle does not match its sources. Run ./coder editor build and commit it."))
      return 1
    }
    console.log(green("Editor bundle matches its sources."))
    return 0
  }
  console.log(green("Editor rebuilt. Restart the desktop app (./coder desktop) to load it."))
  return 0
}
