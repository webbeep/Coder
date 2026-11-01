import { existsSync, readFileSync } from "node:fs"

export type OS = "linux" | "darwin" | "windows"
export type Arch = "x64" | "arm64"

export interface Platform {
  os: OS
  arch: Arch
  /** OpenCode CLI package target, e.g. "linux-x64", "linux-x64-baseline-musl", "darwin-arm64". */
  cliTarget: string
  /** Desktop build key, e.g. "linux-x64", "darwin-arm64", "windows-x64". */
  desktopTarget: string
  exe: string
}

export function currentOS(): OS {
  if (process.platform === "win32") return "windows"
  if (process.platform === "darwin") return "darwin"
  if (process.platform === "linux") return "linux"
  throw new Error(`Unsupported OS: ${process.platform}. Coder supports Windows, macOS and Linux.`)
}

export function currentArch(): Arch {
  if (process.arch === "x64") return "x64"
  if (process.arch === "arm64") return "arm64"
  throw new Error(`Unsupported CPU architecture: ${process.arch}. Coder supports x64 and arm64.`)
}

function isMusl(): boolean {
  return existsSync("/lib/ld-musl-x86_64.so.1") || existsSync("/lib/ld-musl-aarch64.so.1")
}

/** x64 builds need AVX2; older CPUs (and x64 under Rosetta) need the "baseline" build. */
function hasAvx2(os: OS): boolean {
  try {
    if (os === "linux") return /\bavx2\b/.test(readFileSync("/proc/cpuinfo", "utf8"))
    if (os === "darwin") {
      const out = Bun.spawnSync(["sysctl", "-n", "machdep.cpu.leaf7_features"]).stdout.toString()
      return /AVX2/i.test(out)
    }
  } catch {}
  // Windows: no cheap check, so use the baseline build, which runs everywhere.
  return false
}

export function detectPlatform(): Platform {
  const os = currentOS()
  const arch = currentArch()
  let cliTarget = `${os}-${arch}`
  if (arch === "x64" && !hasAvx2(os)) cliTarget += "-baseline"
  if (os === "linux" && isMusl()) cliTarget += "-musl"
  return { os, arch, cliTarget, desktopTarget: `${os}-${arch}`, exe: os === "windows" ? ".exe" : "" }
}

/** Finds an executable on PATH (with Windows extensions). */
export function which(name: string): string | undefined {
  return Bun.which(name) ?? undefined
}
