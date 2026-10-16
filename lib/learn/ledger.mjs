// The lesson ledger: what reviews and corrections taught, kept per machine so
// it carries across projects. One JSON object per line, append-only; a later
// entry with the same id updates the earlier one.

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { createHash } from "node:crypto"

export const LOOM_HOME = process.env.LOOM_HOME ?? join(homedir(), ".loom")
export const LEDGER = join(LOOM_HOME, "ledger.jsonl")

export const CATEGORIES = ["craft", "copy", "motion", "responsive", "a11y", "stack", "process"]
export const SOURCES = ["review", "user", "adopt", "self"]

export function slug(rule) {
  const base = rule.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)
  return base || createHash("sha1").update(rule).digest("hex").slice(0, 8)
}

export function readLedger(file = LEDGER) {
  if (!existsSync(file)) return []
  const byId = new Map()
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    const prev = byId.get(e.id)
    if (!prev) byId.set(e.id, { ...e, evidence: [...(e.evidence ?? [])] })
    else {
      // Merge: keep the latest wording, accumulate evidence.
      byId.set(e.id, { ...prev, ...e, evidence: [...prev.evidence, ...(e.evidence ?? [])], retired: e.retired ?? prev.retired })
    }
  }
  return [...byId.values()]
}

export function addEntry(entry, file = LEDGER) {
  if (!entry.rule) throw new Error("A lesson needs a rule (an imperative sentence).")
  if (entry.category && !CATEGORIES.includes(entry.category)) throw new Error(`Category must be one of ${CATEGORIES.join(", ")}`)
  if (entry.source && !SOURCES.includes(entry.source)) throw new Error(`Source must be one of ${SOURCES.join(", ")}`)
  const e = {
    id: entry.id ?? slug(entry.rule),
    rule: entry.rule,
    why: entry.why ?? "",
    category: entry.category ?? "craft",
    source: entry.source ?? "review",
    evidence: entry.evidence ?? [],
    check: entry.check,
    at: new Date().toISOString(),
  }
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, JSON.stringify(e) + "\n")
  return e
}

export function retire(id, reason, file = LEDGER) {
  appendFileSync(file, JSON.stringify({ id, retired: reason || "retired", at: new Date().toISOString() }) + "\n")
}

export function projectsOf(e) {
  return new Set(e.evidence.map((x) => x.project).filter(Boolean))
}

export function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}
