// Maintainers: pin a new OpenCode release.   bun scripts/pin-upstream.ts 2.3.0
// Rewrites upstream.json with npm integrity hashes for every CLI platform package and the
// GitHub release's SHA-256 sums for desktop builds. Review the diff and the release notes,
// run CI, then merge: everyone gets the new version on their next ./coder start.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: bun scripts/pin-upstream.ts <version>   e.g. 2.3.0")
  process.exit(2)
}
const file = join(import.meta.dir, "..", "upstream.json")
const pin = JSON.parse(readFileSync(file, "utf8"))

for (const target of Object.keys(pin.opencode.cli)) {
  const name = `@opencode/cli-${target}`
  const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}/${version}`)
  if (!res.ok) throw new Error(`${name}@${version}: HTTP ${res.status}`)
  const meta: any = await res.json()
  pin.opencode.cli[target] = { package: name, tarball: meta.dist.tarball, integrity: meta.dist.integrity }
  console.log(`cli ${target}: ${meta.dist.integrity.slice(0, 24)}…`)
}

const sums = await fetch(`https://github.com/anomalyco/opencode/releases/download/v${version}/SHA256SUMS`)
if (!sums.ok) throw new Error(`SHA256SUMS for v${version}: HTTP ${sums.status}`)
const table = new Map((await sums.text()).trim().split("\n").map((l) => l.split(/\s+/).reverse() as [string, string]))
for (const [target, entry] of Object.entries<any>(pin.opencode.desktop)) {
  const asset = entry.url.split("/").pop()
  const sha256 = table.get(asset)
  if (!sha256) throw new Error(`No checksum for ${asset} in v${version}`)
  pin.opencode.desktop[target] = { url: `https://github.com/anomalyco/opencode/releases/download/v${version}/${asset}`, sha256 }
  console.log(`desktop ${target}: ${sha256.slice(0, 16)}…`)
}

pin.opencode.version = version
writeFileSync(file, JSON.stringify(pin, null, 2) + "\n")
console.log(`\nPinned OpenCode ${version}. Review: git diff upstream.json`)
