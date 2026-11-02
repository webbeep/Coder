import { expect, test } from "bun:test"
import { formatDuration } from "../duration.js"

test("full", () => expect(formatDuration(3725)).toBe("1h 2m 5s"))
test("whole hour per spec", () => expect(formatDuration(3600)).toBe("1h"))
test("minutes", () => expect(formatDuration(125)).toBe("2m 5s"))
test("zero", () => expect(formatDuration(0)).toBe("0s"))
