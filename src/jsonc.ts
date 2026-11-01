// Minimal JSONC: strips // and /* */ comments and trailing commas, then JSON.parse.
// Handles comment-like text inside strings correctly.

export function stripJsonc(text: string): string {
  let out = ""
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]!
    if (c === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
    } else {
      out += c
      i++
    }
  }
  return dropTrailingCommas(out)
}

function dropTrailingCommas(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1
      out += text.slice(i, j + 1)
      i = j
      continue
    }
    if (c === ",") {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j]!)) j++
      if (text[j] === "}" || text[j] === "]") continue
    }
    out += c
  }
  return out
}

export function parseJsonc<T = unknown>(text: string, file = "config"): T {
  try {
    return JSON.parse(stripJsonc(text)) as T
  } catch (e) {
    throw new Error(`Invalid JSON in ${file}: ${(e as Error).message}`)
  }
}
