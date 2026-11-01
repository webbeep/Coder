// Downloads the pinned OpenCode build for this machine and verifies it against
// the hashes committed in upstream.json before it is ever executed.
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { paths } from "./paths"
import { detectPlatform, type Platform } from "./platform"

interface CliPin {
  package: string
  tarball: string
  integrity: string
}
interface DesktopPin {
  url: string
  sha256: string
}
export interface Upstream {
  opencode: { version: string; cli: Record<string, CliPin>; desktop: Record<string, DesktopPin> }
  sandboxRuntime: { version: string }
  bun: { version: string }
}

export function readUpstream(): Upstream {
  return JSON.parse(readFileSync(join(paths.root, "upstream.json"), "utf8"))
}

/** Checks Subresource-Integrity strings like "sha512-<base64>". */
export function verifyIntegrity(data: Uint8Array, integrity: string): boolean {
  const [algo, expected] = integrity.split("-", 2)
  if (!algo || !expected || !["sha256", "sha384", "sha512"].includes(algo)) return false
  return createHash(algo).update(data).digest("base64") === expected
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex")
}

async function download(url: string, label: string): Promise<Uint8Array> {
  process.stderr.write(`Downloading ${label}…\n`)
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}

function extractTgz(file: string, dest: string) {
  // tar ships with macOS, Linux and Windows 10+.
  const r = Bun.spawnSync(["tar", "-xzf", file, "-C", dest], { stderr: "pipe" })
  if (r.exitCode !== 0) throw new Error(`Could not extract ${file}: ${r.stderr.toString()}`)
}

export function opencodeDir(up: Upstream, platform: Platform): string {
  return join(paths.local, "opencode", up.opencode.version, platform.cliTarget)
}

export function opencodeBinary(up = readUpstream(), platform = detectPlatform()): string {
  return join(opencodeDir(up, platform), "package", "bin", `opencode${platform.exe}`)
}

/** Returns the verified OpenCode binary, downloading it first if needed. */
export async function ensureOpencode(platform = detectPlatform()): Promise<string> {
  const up = readUpstream()
  const pin = up.opencode.cli[platform.cliTarget]
  if (!pin) throw new Error(`No pinned OpenCode build for ${platform.cliTarget}.`)
  const dir = opencodeDir(up, platform)
  const bin = opencodeBinary(up, platform)
  const marker = join(dir, ".verified")
  if (existsSync(bin) && existsSync(marker) && readFileSync(marker, "utf8") === pin.integrity) return bin

  const data = await download(pin.tarball, `OpenCode ${up.opencode.version} (${platform.cliTarget})`)
  if (!verifyIntegrity(data, pin.integrity)) {
    throw new Error(`Integrity check FAILED for ${pin.tarball}. Not installing it. Expected ${pin.integrity}.`)
  }
  const tmp = `${dir}.tmp-${process.pid}`
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const tgz = join(tmp, "cli.tgz")
  writeFileSync(tgz, data)
  extractTgz(tgz, tmp)
  rmSync(tgz)
  const tmpBin = join(tmp, "package", "bin", `opencode${platform.exe}`)
  if (!existsSync(tmpBin)) throw new Error(`Package did not contain bin/opencode${platform.exe}`)
  if (platform.os !== "windows") chmodSync(tmpBin, 0o755)
  writeFileSync(join(tmp, ".verified"), pin.integrity)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, ".."), { recursive: true })
  renameSync(tmp, dir)
  process.stderr.write(`Verified and installed OpenCode ${up.opencode.version}.\n`)
  return bin
}

/** Downloads and verifies the pinned desktop build; returns the file path. */
export async function ensureDesktopDownload(platform = detectPlatform()): Promise<string> {
  const up = readUpstream()
  const pin = up.opencode.desktop[platform.desktopTarget]
  if (!pin) throw new Error(`No pinned desktop build for ${platform.desktopTarget}.`)
  const dir = join(paths.local, "desktop", up.opencode.version)
  const file = join(dir, pin.url.split("/").pop()!)
  if (existsSync(file) && sha256Hex(new Uint8Array(readFileSync(file))) === pin.sha256) return file
  const data = await download(pin.url, `OpenCode desktop ${up.opencode.version}`)
  if (sha256Hex(data) !== pin.sha256) throw new Error(`Checksum FAILED for ${pin.url}. Not using it.`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, data)
  return file
}
