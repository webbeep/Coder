/** Restricts x to the range [lo, hi]. */
export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(x, lo))
}
