import { expect, test } from "bun:test"
import { formatDuration } from "./duration.js"

test("hours, minutes, seconds", () => expect(formatDuration(3725)).toBe("1h 2m 5s"))
// This expectation contradicts the documented format (zero parts are left out).
test("whole hour", () => expect(formatDuration(3600)).toBe("1h 0m 0s"))
