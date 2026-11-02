import { expect, test } from "bun:test"
import { sum } from "./sum.js"

test("adds positive numbers", () => expect(sum([1, 2, 3])).toBe(6))
