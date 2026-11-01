import { expect, test } from "bun:test"
import { parseJsonc } from "../src/jsonc"

test("parses comments and trailing commas, keeps comment-like strings", () => {
  const text = `{
    // line comment
    "url": "http://host//path", /* block */
    "glob": "src/**/*.ts",
    "list": [1, 2,],
  }`
  expect(parseJsonc(text)).toEqual({ url: "http://host//path", glob: "src/**/*.ts", list: [1, 2] })
})

test("escaped quotes inside strings", () => {
  expect(parseJsonc(`{"a": "say \\"hi\\" // not a comment"}`)).toEqual({ a: 'say "hi" // not a comment' })
})

test("reports the file on errors", () => {
  expect(() => parseJsonc("{", "x.jsonc")).toThrow("x.jsonc")
})

test("commas inside strings are kept", () => {
  expect(parseJsonc(`{"a": "x, }", "b": [",]"],}`)).toEqual({ a: "x, }", b: [",]"] })
})
