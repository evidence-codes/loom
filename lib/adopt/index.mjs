// loom adopt: gather the evidence an agent needs to take over an existing
// project's design: what it is, what it says, and what its design system is
// in source and as rendered. Writes .design/adopt/{adopt.md, adopt.json}.

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { scan } from "./scan.mjs"
import { renderedCensus } from "./rendered.mjs"
import { findings, questions, markdown } from "./report.mjs"
import { capture } from "../capture.mjs"
import { runChecks } from "../learn/rules.mjs"

export async function adopt({ dir, url, out, viewports, renderer, captures: doCapture = true, quiet }) {
  const root = resolve(dir)
  const outDir = resolve(out ?? join(root, ".design/adopt"))
  mkdirSync(outDir, { recursive: true })
  const log = quiet ? () => {} : (m) => process.stderr.write(`  · ${m}\n`)

  log(`scanning ${root}`)
  const s = scan(root)

  let census = null
  let caps = null
  if (url) {
    if (s.safety.findings.length) {
      log("supply-chain findings in configs; skipping the live steps")
    } else {
      log(`rendered census of ${url}`)
      census = await renderedCensus(url, { renderer })
      if (census.documentStatus >= 400) {
        log(`the page returned HTTP ${census.documentStatus}; discarding the rendered census`)
        census = { error: `HTTP ${census.documentStatus} from ${url}: the app did not render, so there is no rendered census.` }
      }
      if (doCapture) {
        log("captures")
        caps = await capture({
          url,
          out: join(outDir, "captures"),
          viewports,
          full: true,
          first: true,
          motion: "reduce",
          settleMs: 1500,
          motionSettleMs: 3500,
          sliceSettleMs: 500,
          hide: [],
          keepFixed: false,
          colorScheme: "light",
          timeoutMs: 30000,
          renderer,
          quiet: true,
        })
      }
    }
  }

  const found = findings(s, census, caps)
  // Everything learned on earlier projects, checked here too.
  const learned = runChecks(root)
  for (const h of learned.hits) found.push({ level: "fix", text: `House rule broken in ${h.file}: ${h.message} (${h.id})` })
  const asks = questions(s, census)
  const report = { scan: s, census, captures: caps, findings: found, questions: asks, generatedAt: new Date().toISOString() }
  writeFileSync(join(outDir, "adopt.json"), JSON.stringify(report, null, 2))
  writeFileSync(join(outDir, "adopt.md"), markdown({ scan: s, census, captures: caps, found, asks }))
  return { outDir, found, asks, safety: s.safety.findings.length }
}
