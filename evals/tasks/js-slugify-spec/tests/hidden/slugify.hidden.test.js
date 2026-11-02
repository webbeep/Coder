import { expect, test } from "bun:test"
import { slugify } from "../slugify.js"

test("basic", () => expect(slugify("Hello World")).toBe("hello-world"))
test("accents and punctuation", () => expect(slugify("  Crème Brûlée!  ")).toBe("creme-brulee"))
test("runs collapse", () => expect(slugify("a---b__c")).toBe("a-b-c"))
test("empty", () => expect(slugify("")).toBe(""))
test("truncation", () => {
  const s = slugify("word ".repeat(30))
  expect(s.length).toBeLessThanOrEqual(50)
  expect(s.endsWith("-")).toBe(false)
  expect(s.startsWith("word-word")).toBe(true)
})
