// Learn self-test: each checked lesson fires on the bug as it was actually
// written, and stays quiet on the fix. Uses a throwaway ledger.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const home = mkdtempSync(join(tmpdir(), "loom-learn-"))
process.env.LOOM_HOME = home
const { runLearn } = await import("../lib/learn/cli.mjs")
const { runChecks, compile } = await import("../lib/learn/rules.mjs")
const { readLedger, addEntry } = await import("../lib/learn/ledger.mjs")

const log = console.log
console.log = () => {}
await runLearn(["seed"])
console.log = log

function project(files) {
  const dir = mkdtempSync(join(home, "p-"))
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true })
    writeFileSync(join(dir, rel), text)
  }
  return dir
}
const ids = (dir) => runChecks(dir).hits.map((h) => h.id)

const fontBug = project({
  "app/globals.css": '@import "tailwindcss";\n@theme {\n  --font-sans: var(--font-geologica), sans-serif;\n}\n',
  "app/layout.tsx": 'const geologica = Geologica({ variable: "--font-geologica" })\nexport default function L({children}){return <html lang="en"><body className={`${geologica.variable} antialiased`}>{children}</body></html>}\n',
})
const fontFix = project({
  "app/globals.css": '@import "tailwindcss";\n@theme {\n  --font-sans: var(--font-geologica), sans-serif;\n}\n',
  "app/layout.tsx": 'const geologica = Geologica({ variable: "--font-geologica" })\nexport default function L({children}){return <html lang="en" className={`${geologica.variable}`}><body className="antialiased">{children}</body></html>}\n',
})
const dashBug = project({
  "components/Hero.tsx": '<motion.path d={PLANNED} stroke="x" strokeWidth="2" strokeDasharray="8 9" fill="none" {...draw(0.3, 1.1)} />\n',
})
const dashFix = project({
  "components/Hero.tsx": '<mask id="m"><motion.path d={PLANNED} stroke="#fff" {...draw(0.3, 1.1)} /></mask>\n<path d={PLANNED} strokeDasharray="8 9" mask="url(#m)" />\n',
})
const reduceBug = project({
  "components/Hero.tsx": 'const reduce = useReducedMotion()\nconst draw = () => reduce ? { initial: false } : { initial: { pathLength: 0 } }\n',
})
const reduceFix = project({
  "components/Hero.tsx": 'const reduce = useReducedMotion()\nconst t = () => (reduce ? { duration: 0 } : { duration: 1 })\n',
})
const v3Bug = project({
  "tailwind.config.js": 'module.exports = { theme: { extend: { colors: { dip: { 6: "var(--dip-6)" } } } } }\n',
  "app/Hero.tsx": '<div className="bg-dip-6/55" />\n',
})
const v3Fix = project({
  "tailwind.config.js": 'module.exports = { theme: { extend: { colors: { dip: { 6: "#0e1638" } } } } }\n',
  "app/Hero.tsx": '<div className="bg-dip-6/55" />\n',
})

// Ledger writes through the CLI keep house-rules.md current.
const rulesFile = () => readFileSync(join(home, "house-rules.md"), "utf8")
const seededRules = rulesFile()
console.log = () => {}
await runLearn(["add", "--rule", "Rebuild test lesson.", "--id", "rebuild-test", "--category", "process"])
const afterAdd = rulesFile()
await runLearn(["retire", "rebuild-test"])
const afterRetire = rulesFile()
console.log = log

// Doctor flags house rules that lag the ledger, as a direct write leaves them.
const { houseRules } = await import("../lib/doctor.mjs")
const freshState = houseRules().state
addEntry({ id: "stale-test", rule: "Stale test lesson.", category: "process" })
const staleState = houseRules().state

// Promotion: a second project's sighting makes a provisional lesson standing.
addEntry({ id: "framer-pathlength-kills-dashes", rule: readLedger().find((e) => e.id === "framer-pathlength-kills-dashes").rule, category: "motion", evidence: [{ project: "another-project" }] })
const rules = compile(readLedger())

const expect = [
  ["seeds every starter lesson", readLedger().filter((e) => !["rebuild-test", "stale-test"].includes(e.id)).length === JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../lib/learn/seed.json"), "utf8")).length],
  ["font scope bug caught", ids(fontBug).includes("next-font-variable-on-html")],
  ["font scope fix clean", !ids(fontFix).includes("next-font-variable-on-html")],
  ["dashed pathLength bug caught", ids(dashBug).includes("framer-pathlength-kills-dashes")],
  ["mask-reveal fix clean", !ids(dashFix).includes("framer-pathlength-kills-dashes")],
  ["reduced-motion branch caught", ids(reduceBug).includes("no-reduced-motion-branch-in-render")],
  ["zero-duration fix clean", !ids(reduceFix).includes("no-reduced-motion-branch-in-render")],
  ["v3 var-colour opacity caught", ids(v3Bug).includes("tailwind-v3-var-colour-opacity")],
  ["v3 hex colours clean", !ids(v3Fix).includes("tailwind-v3-var-colour-opacity")],
  ["second project promotes to standing", /\*\*Never animate pathLength[^\n]*standing; seen in landing-page-a, another-project/.test(rules)],
  ["seed writes house rules", /Compiled by/.test(seededRules)],
  ["add rebuilds house rules", afterAdd.includes("Rebuild test lesson.")],
  ["retire rebuilds house rules", !afterRetire.includes("Rebuild test lesson.")],
  ["doctor passes current house rules", freshState === "ok"],
  ["doctor flags stale house rules", staleState === "warn"],
  ["user-sourced lesson is standing", /Ask before installing[^\n]*\(standing/.test(rules)],
]
let failed = 0
for (const [name, ok] of expect) {
  log(`${ok ? "ok  " : "FAIL"} ${name}`)
  if (!ok) failed++
}
rmSync(home, { recursive: true, force: true })
process.exitCode = failed ? 1 : 0
