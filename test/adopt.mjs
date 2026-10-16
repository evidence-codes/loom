// Adopt self-test: static scan of a fixture app, plus a rendered census of a
// fixture page with a planted contrast failure.
import { scan } from "../lib/adopt/scan.mjs"
import { findings, questions } from "../lib/adopt/report.mjs"
import { renderedCensus } from "../lib/adopt/rendered.mjs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures/adopt-app")
const s = scan(root)
const census = await renderedCensus("file://" + join(root, "census.html"), { renderer: process.platform === "darwin" ? "gpu" : "software" })
const f = findings(s, census, null).map((x) => x.text).join("\n")
const q = questions(s, census)

const expect = [
  ["detects Next.js", s.stack.primary === "Next.js"],
  ["finds both routes", s.routes.map((r) => r.route).sort().join(",") === "/,/settings"],
  ["reads metadata", s.product.metadata.some((m) => m.title === "Fixture App")],
  ["finds Inter", s.tokens.fonts.some((x) => x.family === "Inter")],
  ["flags unused stylesheet", /styles\/old\.css is not imported/.test(f)],
  ["flags near-duplicate brand colours", /#3355ff.*#3456fe|#3456fe.*#3355ff/.test(f)],
  ["counts arbitrary colour utility", s.tokens.tailwind.topColorUtilities.some((u) => u.startsWith("text-[#fafafa]"))],
  ["ignores size utilities as colours", !s.tokens.tailwind.topColorUtilities.some((u) => u.startsWith("text-[34px]"))],
  ["rendered contrast failure found", census.lowContrast.some((c) => c.pair.startsWith("#bbbbbb on #ffffff"))],
  ["lab() backgrounds resolved (no false white-on-white)", !census.lowContrast.some((c) => c.sample.startsWith("Badge on lab"))],
  ["readable text not flagged", !census.lowContrast.some((c) => c.pair.startsWith("#222222"))],
  ["asks for purpose when no PRODUCT.md", q.some((x) => /primary user/.test(x))],
  ["safety clean", s.safety.findings.length === 0],
]
let failed = 0
for (const [name, ok] of expect) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`)
  if (!ok) failed++
}
process.exitCode = failed ? 1 : 0
