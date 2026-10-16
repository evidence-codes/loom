// Compile the ledger into house rules, and run the mechanical ones.

import { join } from "node:path"
import { readLedger, projectsOf, writeAtomic, LOOM_HOME, CATEGORIES } from "./ledger.mjs"
import { walk, read } from "../adopt/walk.mjs"

const TITLES = {
  craft: "Craft",
  copy: "Copy and truth",
  motion: "Motion",
  responsive: "Responsive",
  a11y: "Accessibility",
  stack: "Stack traps",
  process: "Process",
}

// A lesson seen in two or more projects (or confirmed by the user) is a
// standing rule: it applies by default. Others are provisional.
export function standing(e) {
  return projectsOf(e).size >= 2 || e.source === "user"
}

export function compile(entries) {
  const live = entries.filter((e) => !e.retired)
  const lines = [
    "# House rules",
    "",
    `Compiled by \`loom learn rules\` from ${live.length} lesson(s) in the ledger. Read this before building; \`loom learn check <dir>\` runs the mechanical ones.`,
    "",
    "**Standing** rules were seen in two or more projects or confirmed by the user and apply by default. **Provisional** rules were seen once; apply them, and record a second sighting or retire them.",
    "",
  ]
  for (const cat of CATEGORIES) {
    const group = live.filter((e) => e.category === cat)
    if (!group.length) continue
    group.sort((a, b) => Number(standing(b)) - Number(standing(a)) || projectsOf(b).size - projectsOf(a).size)
    lines.push(`## ${TITLES[cat]}`, "")
    for (const e of group) {
      const projects = [...projectsOf(e)]
      const tag = standing(e) ? "standing" : "provisional"
      lines.push(`- **${e.rule}** _(${tag}${projects.length ? `; seen in ${projects.join(", ")}` : ""}${e.check ? "; checked" : ""})_`)
      if (e.why) lines.push(`  ${e.why}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

export function writeRules(out = join(LOOM_HOME, "house-rules.md")) {
  const entries = readLedger()
  writeAtomic(out, compile(entries))
  return { out, count: entries.filter((e) => !e.retired).length }
}

// A check is { ext: [".tsx"], all: [regex...], none?: [regex...], message }.
// A file violates it when every `all` pattern matches and no `none` pattern does.
export function runChecks(dir, entries = readLedger()) {
  const checks = entries.filter((e) => e.check && !e.retired)
  const files = walk(dir)
  const hits = []
  for (const e of checks) {
    const c = e.check
    const all = (c.all ?? []).map((p) => new RegExp(p, "m"))
    const none = (c.none ?? []).map((p) => new RegExp(p, "m"))
    const exts = new Set(c.ext ?? [".tsx", ".jsx", ".ts", ".js", ".css"])
    const scope = c.scope === "project"
    if (scope) {
      // Project-wide: patterns may match in different files.
      const text = files.filter((f) => exts.has(f.ext)).map((f) => read(f)).join("\n")
      if (all.every((r) => r.test(text)) && !none.some((r) => r.test(text))) hits.push({ id: e.id, rule: e.rule, file: "(project)", message: c.message ?? e.rule })
      continue
    }
    for (const f of files) {
      if (!exts.has(f.ext)) continue
      const t = read(f)
      if (all.every((r) => r.test(t)) && !none.some((r) => r.test(t))) hits.push({ id: e.id, rule: e.rule, file: f.rel, message: c.message ?? e.rule })
    }
  }
  return { checked: checks.length, hits }
}
