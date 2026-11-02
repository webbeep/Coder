/**
 * Formats seconds as "1h 2m 5s". Parts that are zero are left out ("1h", "2m 5s"),
 * except that zero seconds overall is "0s". This format is relied on by the billing export.
 */
export function formatDuration(seconds) {
  const h = Math.floor(seconds / 60)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const parts = []
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  if (s || !parts.length) parts.push(`${s}s`)
  return parts.join(" ")
}
