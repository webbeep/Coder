import { readFileSync } from "node:fs"
process.exit(readFileSync("done.txt", "utf8").trim() === "ok" ? 0 : 1)
