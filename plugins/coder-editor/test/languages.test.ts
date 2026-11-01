import { expect, test } from "bun:test"
import { StringStream } from "@codemirror/language"
import { simpleParser } from "../src/languages"

function tokens(line: string, lang = { name: "Acme", extensions: [".acme"], keywords: ["func", "return"], types: ["int"], builtins: ["print"], lineComment: "//", blockComment: ["/*", "*/"] as [string, string], strings: ['"'] }) {
  const parser = simpleParser(lang)
  const state = parser.startState!(2)
  const stream = new StringStream(line, 2, 2)
  const out: [string, string | null][] = []
  while (!stream.eol()) {
    stream.start = stream.pos
    const style = parser.token(stream, state)
    const text = stream.current()
    if (text.trim()) out.push([text, style])
  }
  return out
}

test("highlights a custom language from languages.json", () => {
  expect(tokens('func main() int { print("hi // not a comment") return 42 } // done')).toEqual([
    ["func", "keyword"],
    ["main", "variableName"],
    ["(", null],
    [")", null],
    ["int", "typeName"],
    ["{", null],
    ["print", "builtin"],
    ["(", null],
    ['"', "string"],
    ['hi // not a comment"', "string"],
    [")", null],
    ["return", "keyword"],
    ["42", "number"],
    ["}", null],
    ["// done", "comment"],
  ])
})

test("block comments", () => {
  expect(tokens("/* a */ func")).toEqual([
    ["/*", "comment"],
    [" a */", "comment"],
    ["func", "keyword"],
  ])
})
