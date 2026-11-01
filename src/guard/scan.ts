// Scans text that is about to become long-lived agent context (knowledge files,
// memory) for things that should never be persisted: hidden characters,
// instructions aimed at the AI, and secrets. Pure functions, no I/O.

export type FindingKind = "invisible-unicode" | "injection" | "secret"

export interface Finding {
  kind: FindingKind
  detail: string
  /** 1-based line number of the first occurrence. */
  line: number
}

// Zero-width and joiner chars, bidi overrides/isolates, BOM, and Unicode "tag"
// characters (U+E0000–E007F) that can smuggle invisible instructions.
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿­]|\uDB40[\uDC00-\uDC7F]/g

const INJECTION: [RegExp, string][] = [
  [/\b(ignore|disregard|forget|override)\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|preceding|system)\s+(instructions?|prompts?|rules|messages?)/i, "tells the AI to ignore its instructions"],
  [/\b(you\s+are\s+now|from\s+now\s+on\s+you\s+(are|will|must))\b/i, "tries to change the AI's role"],
  [/\b(new|updated|real|hidden)\s+(system\s+)?instructions?\s*:/i, "claims to be new instructions"],
  [/<\/?\s*(system|assistant|im_start|im_end)\s*>|\[\/?INST\]|<\|im_start\|>/i, "contains chat-role markup"],
  [/\b(do\s+not|don't|never)\s+(tell|inform|mention\s+(this\s+)?to|alert)\s+the\s+user\b/i, "asks the AI to hide something from the user"],
  [/\b(send|post|upload|exfiltrate|forward|leak)\b[^\n]{0,60}\b(ssh|private\s+key|credentials?|secrets?|tokens?|api[\s_-]?keys?|passwords?|\.env)\b/i, "asks to send secrets somewhere"],
  [/\b(curl|wget|iwr|invoke-webrequest)\b[^\n]{0,120}\|\s*(ba|z)?sh\b/i, "pipes a download into a shell"],
  [/\bcat\s+~?\/?[^\s]*\.ssh\/|\bid_(rsa|ed25519|ecdsa)\b/i, "references SSH private keys"],
]

const SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{60,}\b/, "GitHub token"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, "Slack token"],
  [/\bsk-(ant-|proj-)?[A-Za-z0-9_-]{32,}\b/, "API key"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, "JWT"],
  [/\b(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["']?[A-Za-z0-9_\-+/]{24,}["']?/i, "credential assignment"],
]

function lineOf(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

export function scanText(text: string): Finding[] {
  const findings: Finding[] = []
  const inv = INVISIBLE.exec(text)
  INVISIBLE.lastIndex = 0
  if (inv) {
    const cp = inv[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")
    findings.push({ kind: "invisible-unicode", detail: `hidden character U+${cp}`, line: lineOf(text, inv.index) })
  }
  for (const [re, detail] of INJECTION) {
    const m = re.exec(text)
    if (m) findings.push({ kind: "injection", detail, line: lineOf(text, m.index) })
  }
  for (const [re, detail] of SECRETS) {
    const m = re.exec(text)
    if (m) findings.push({ kind: "secret", detail, line: lineOf(text, m.index) })
  }
  return findings
}

/** Removes invisible characters (used to show the user what the text really says). */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, "")
}

export function describeFindings(path: string, findings: Finding[]): string {
  const lines = findings.map((f) => `  - line ${f.line}: ${f.detail}`)
  return `Coder blocked this write to ${path} because it would store unsafe content in long-lived context:\n${lines.join("\n")}\nRemove that content (never store AI-directed instructions or secrets in knowledge or memory) and try again.`
}
