// Picks CodeMirror language support by file extension. Custom languages (e.g. a
// proprietary one) come from ../languages.json as a simple keyword highlighter.
import { StreamLanguage, type StreamParser, type LanguageSupport } from "@codemirror/language"
import type { Extension } from "@codemirror/state"
import custom from "../languages.json"

export interface CustomLanguage {
  name: string
  extensions: string[]
  keywords?: string[]
  types?: string[]
  builtins?: string[]
  lineComment?: string
  blockComment?: [string, string]
  strings?: string[]
}

interface State {
  inBlock: boolean
  inString: string | null
}

/** A small tokenizer: comments, strings, numbers, keywords, types, builtins. */
export function simpleParser(lang: CustomLanguage): StreamParser<State> {
  const kw = new Set(lang.keywords ?? [])
  const types = new Set(lang.types ?? [])
  const builtins = new Set(lang.builtins ?? [])
  const quotes = lang.strings ?? ['"']
  const [open, close] = lang.blockComment ?? [undefined, undefined]
  return {
    name: lang.name,
    startState: () => ({ inBlock: false, inString: null }),
    token(stream, state) {
      if (state.inBlock && close) {
        if (stream.skipTo(close)) {
          stream.pos += close.length
          state.inBlock = false
        } else stream.skipToEnd()
        return "comment"
      }
      if (state.inString) {
        let escaped = false
        while (!stream.eol()) {
          const ch = stream.next()
          if (ch === state.inString && !escaped) {
            state.inString = null
            break
          }
          escaped = !escaped && ch === "\\"
        }
        return "string"
      }
      if (stream.eatSpace()) return null
      if (lang.lineComment && stream.match(lang.lineComment)) {
        stream.skipToEnd()
        return "comment"
      }
      if (open && stream.match(open)) {
        state.inBlock = true
        return "comment"
      }
      const ch = stream.peek()
      if (ch && quotes.includes(ch)) {
        stream.next()
        state.inString = ch
        return "string"
      }
      if (stream.match(/^-?(0x[0-9a-f]+|\d+(\.\d+)?(e[+-]?\d+)?)/i)) return "number"
      if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
        const word = stream.current()
        if (kw.has(word)) return "keyword"
        if (types.has(word)) return "typeName"
        if (builtins.has(word)) return "builtin"
        return "variableName"
      }
      stream.next()
      return null
    },
    languageData: {
      commentTokens: { line: lang.lineComment, block: open && close ? { open, close } : undefined },
    },
  }
}

const customLanguages = ((custom as unknown as { languages?: CustomLanguage[] }).languages ?? [])

const ext = (path: string) => {
  const name = path.split("/").pop() ?? ""
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot).toLowerCase() : name.toLowerCase()
}

/** Language support for a file, loaded on demand. */
export async function languageFor(path: string): Promise<Extension | LanguageSupport | []> {
  const e = ext(path)
  const own = customLanguages.find((l) => l.extensions.map((x) => x.toLowerCase()).includes(e))
  if (own) return StreamLanguage.define(simpleParser(own))
  switch (e) {
    case ".js":
    case ".mjs":
    case ".cjs":
    case ".jsx":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true })
    case ".ts":
    case ".mts":
    case ".cts":
    case ".tsx":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: e === ".tsx" })
    case ".py":
      return (await import("@codemirror/lang-python")).python()
    case ".json":
    case ".jsonc":
      return (await import("@codemirror/lang-json")).json()
    case ".md":
    case ".mdx":
      return (await import("@codemirror/lang-markdown")).markdown()
    case ".html":
    case ".htm":
    case ".vue":
    case ".svelte":
      return (await import("@codemirror/lang-html")).html()
    case ".css":
    case ".scss":
    case ".less":
      return (await import("@codemirror/lang-css")).css()
    case ".rs":
      return (await import("@codemirror/lang-rust")).rust()
    case ".go":
      return (await import("@codemirror/lang-go")).go()
    case ".java":
    case ".kt":
      return (await import("@codemirror/lang-java")).java()
    case ".c":
    case ".h":
    case ".cc":
    case ".cpp":
    case ".hpp":
    case ".cs":
      return (await import("@codemirror/lang-cpp")).cpp()
    case ".sql":
      return (await import("@codemirror/lang-sql")).sql()
    case ".yaml":
    case ".yml":
      return (await import("@codemirror/lang-yaml")).yaml()
    case ".xml":
    case ".svg":
      return (await import("@codemirror/lang-xml")).xml()
    case ".sh":
    case ".bash":
    case ".zsh":
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/shell")).shell)
    case ".toml":
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/toml")).toml)
    case ".ps1":
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/powershell")).powerShell)
    case "dockerfile":
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile)
    default:
      return []
  }
}
