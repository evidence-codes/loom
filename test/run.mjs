// Self-test: capture the broken fixture and check every planted defect is reported.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const out = mkdtempSync(join(tmpdir(), "loom-test-"))
const fixture = "file://" + join(root, "test/fixtures/broken.html")
let code = 0
try {
  execFileSync("node", [join(root, "bin/loom.mjs"), "capture", fixture, "--viewports", "390x844", "--out", out, "--quiet", "--timeout", "8000"], { stdio: "pipe" })
} catch (e) {
  code = e.status
}
const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"))
const w = m.viewports[0].warnings.join("\n")
const expect = [
  ["exit code 2 (invalid capture)", code === 2],
  ["blank band flagged", /taller than the viewport/.test(w)],
  ["broken image flagged", /image\(s\) failed to load/.test(w)],
  ["overflow flagged at true width", /horizontal overflow, content is 6\d\dpx wide at a 390px viewport/.test(w)],
  ["console error flagged", /console error/.test(w)],
  ["full page is true 390px wide", m.viewports[0].fullAnalysis[0].width === 390],
  ["fixed header hidden after first slice", m.viewports[0].fixedChromeHidden === 1 && m.viewports[0].slices === 2],
]
let failed = 0
for (const [name, ok] of expect) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`)
  if (!ok) failed++
}
rmSync(out, { recursive: true, force: true })
process.exitCode = failed ? 1 : 0
