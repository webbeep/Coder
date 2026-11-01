// Tiny terminal UI helpers: no dependencies.
const tty = () => Boolean(process.stdin.isTTY && process.stdout.isTTY)
const color = (code: number) => (s: string) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s)

export const bold = color(1)
export const dim = color(2)
export const red = color(31)
export const green = color(32)
export const yellow = color(33)
export const cyan = color(36)

export const isInteractive = tty

export function ask(question: string, fallback = ""): string {
  if (!tty()) return fallback
  const hint = fallback ? dim(` [${fallback}]`) : ""
  const answer = prompt(`${question}${hint}`)
  return answer?.trim() || fallback
}

export function confirm(question: string, fallback = true): boolean {
  if (!tty()) return fallback
  const answer = prompt(`${question} ${dim(fallback ? "[Y/n]" : "[y/N]")}`)?.trim().toLowerCase()
  if (!answer) return fallback
  return answer === "y" || answer === "yes"
}

export function choose<T>(question: string, items: { label: string; value: T }[], fallback = 0): T {
  if (items.length === 1 || !tty()) return items[fallback]!.value
  console.log(question)
  items.forEach((item, i) => console.log(`  ${i + 1}) ${item.label}`))
  for (;;) {
    const answer = prompt(`Choose 1-${items.length} ${dim(`[${fallback + 1}]`)}`)?.trim()
    if (!answer) return items[fallback]!.value
    const n = Number(answer)
    if (Number.isInteger(n) && n >= 1 && n <= items.length) return items[n - 1]!.value
  }
}

/** Reads a line without echoing it (API keys). Falls back to visible input when raw mode isn't available. */
export async function askSecret(question: string): Promise<string> {
  if (!tty() || typeof process.stdin.setRawMode !== "function") return ask(question)
  process.stdout.write(`${question} ${dim("(input hidden)")} `)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  let value = ""
  try {
    for await (const chunk of process.stdin) {
      const s = chunk.toString("utf8")
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") return value
        if (ch === "\u0003") throw new Error("Cancelled")
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1)
        else if (ch >= " ") value += ch
      }
    }
    return value
  } finally {
    process.stdin.setRawMode(false)
    process.stdin.pause()
    process.stdout.write("\n")
  }
}
