export function summarize(values) {
  const count = values.length
  const sum = values.reduce((a, b) => a + b, 0)
  const mean = count ? sum / count : 0
  return { count, sum, mean }
}
