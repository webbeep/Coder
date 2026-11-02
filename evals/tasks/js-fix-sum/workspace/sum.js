// Returns the sum of all numbers in the array.
export function sum(numbers) {
  let total = 0
  for (const n of numbers) {
    if (n > 0) total += n
  }
  return total
}
