// loom learn: record lessons, compile house rules, run the mechanical ones.

import { readFileSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { addEntry, readLedger, retire, projectsOf, LEDGER, CATEGORIES, SOURCES } from "./ledger.mjs"
import { writeRules, runChecks, standing } from "./rules.mjs"

export const LEARN_HELP = `loom learn <action>

Lessons from reviews and corrections, kept per machine in ${LEDGER},
compiled into house rules that every build starts from.

  add --rule "…" [--why "…"] [--category C] [--source S] [--project P] [--note "…"]
        Record a lesson, or a new sighting of one (same rule or --id).
        Categories: ${CATEGORIES.join(", ")}. Sources: ${SOURCES.join(", ")}.
  list [--category C]      Show lessons, standing first
  rules [--out FILE]       Compile house-rules.md (default ~/.loom/house-rules.md)
  check <dir>              Run the mechanical lessons against a project
  retire <id> [--why "…"]  Retire a lesson that proved wrong
  seed                     Load the starter lessons shipped with loom (idempotent)

add, retire and seed recompile ~/.loom/house-rules.md, so it never lags the ledger.
check exits 4 when a project violates a checked lesson.
`

function flags(argv) {
  const o = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--")) {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith("--")) o[a.slice(2)] = true
      else {
        o[a.slice(2)] = v
        i++
      }
    } else o._.push(a)
  }
  return o
}

// Every ledger write recompiles the default house rules: builds read that
// file, not the ledger, so a lesson left out of it is a lesson not applied.
function rebuilt() {
  const r = writeRules()
  console.log(`house rules: ${r.out} (${r.count} lessons)`)
}

export async function runLearn(argv) {
  const [action, ...rest] = argv
  const o = flags(rest)
  switch (action) {
    case "add": {
      const evidence = o.project ? [{ project: o.project, note: o.note ?? "", at: new Date().toISOString().slice(0, 10) }] : []
      const e = addEntry({ id: o.id, rule: o.rule, why: o.why, category: o.category, source: o.source, evidence })
      const merged = readLedger().find((x) => x.id === e.id)
      console.log(`recorded ${e.id} (${standing(merged) ? "standing" : "provisional"}; ${projectsOf(merged).size} project(s))`)
      return rebuilt()
    }
    case "list": {
      const all = readLedger().filter((e) => !e.retired && (!o.category || e.category === o.category))
      all.sort((a, b) => Number(standing(b)) - Number(standing(a)) || a.category.localeCompare(b.category))
      for (const e of all) console.log(`${standing(e) ? "●" : "○"} [${e.category}] ${e.id}${e.check ? " (checked)" : ""}\n    ${e.rule}`)
      console.log(`\n${all.length} lesson(s); ● standing, ○ provisional`)
      return
    }
    case "rules": {
      const r = writeRules(o.out ? resolve(o.out) : undefined)
      console.log(`house rules: ${r.out} (${r.count} lessons)`)
      return
    }
    case "check": {
      const dir = o._[0]
      if (!dir) return console.log(LEARN_HELP)
      const r = runChecks(resolve(dir))
      if (!r.hits.length) console.log(`clean: ${r.checked} checked lesson(s) pass`)
      for (const h of r.hits) console.log(`! ${h.file}: ${h.message}\n    rule: ${h.rule} [${h.id}]`)
      process.exitCode = r.hits.length ? 4 : 0
      return
    }
    case "retire": {
      if (!o._[0]) throw new Error("retire needs a lesson id")
      retire(o._[0], typeof o.why === "string" ? o.why : "")
      console.log(`retired ${o._[0]}`)
      return rebuilt()
    }
    case "seed": {
      const here = dirname(fileURLToPath(import.meta.url))
      const seed = JSON.parse(readFileSync(join(here, "seed.json"), "utf8"))
      const have = new Set(readLedger().map((e) => e.id))
      let n = 0
      for (const s of seed) if (!have.has(s.id)) (addEntry(s), n++)
      console.log(`seeded ${n} lesson(s) (${seed.length - n} already present)`)
      return n ? rebuilt() : undefined
    }
    default:
      console.log(LEARN_HELP)
  }
}
