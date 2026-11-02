import { summarize } from "./stats.js"

const values = process.argv.slice(2).map(Number)
const s = summarize(values)
console.log(`count=${s.count} sum=${s.sum} mean=${s.mean}`)
