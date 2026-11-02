import { expect, test } from "bun:test"
import { clamp } from "../math.js"

test("inside", () => expect(clamp(5, 0, 10)).toBe(5))
test("below", () => expect(clamp(-3, 0, 10)).toBe(0))
test("above", () => expect(clamp(42, 0, 10)).toBe(10))
