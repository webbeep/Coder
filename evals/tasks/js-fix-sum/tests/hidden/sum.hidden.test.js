import { expect, test } from "bun:test"
import { sum } from "../sum.js"

test("empty", () => expect(sum([])).toBe(0))
test("mixed signs", () => expect(sum([5, -2])).toBe(3))
test("negatives", () => expect(sum([-1, -1])).toBe(-2))
test("decimals", () => expect(sum([1.5, 2.5])).toBe(4))
