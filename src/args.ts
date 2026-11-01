// Minimal flag parser: --name value, --name=value, --flag, and positionals.
export interface Args {
  _: string[]
  flags: Record<string, string | true>
  /** Everything after a literal "--", passed through untouched. */
  rest: string[]
}

export function parseArgs(argv: string[], booleans: string[] = []): Args {
  const out: Args = { _: [], flags: {}, rest: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--") {
      out.rest = argv.slice(i + 1)
      break
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=")
      if (eq > 0) out.flags[a.slice(2, eq)] = a.slice(eq + 1)
      else {
        const name = a.slice(2)
        const next = argv[i + 1]
        if (!booleans.includes(name) && next !== undefined && !next.startsWith("--")) {
          out.flags[name] = next
          i++
        } else out.flags[name] = true
      }
    } else out._.push(a)
  }
  return out
}

export function str(args: Args, name: string): string | undefined {
  const v = args.flags[name]
  return typeof v === "string" ? v : undefined
}
