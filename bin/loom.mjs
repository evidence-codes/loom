#!/usr/bin/env node
// loom: a design workflow toolkit. Commands: capture, adopt, learn.

import { resolve } from "node:path"
import { capture, parseViewports } from "../lib/capture.mjs"
import { adopt } from "../lib/adopt/index.mjs"
import { runLearn } from "../lib/learn/cli.mjs"
import { doctor } from "../lib/doctor.mjs"
import { runPreview, runAdapt } from "../lib/adapters/cli.mjs"
import { guide } from "../lib/guide.mjs"
import { report } from "../lib/report.mjs"
import { findImpeccable, installImpeccable, IMPECCABLE_DISCLOSURE } from "../lib/setup.mjs"
import { createInterface } from "node:readline/promises"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")).version

const TOP_HELP = `loom <command>

  setup [--yes]          Install what loom needs (impeccable, pinned to a reviewed version)
  doctor                 Check this machine is ready (Node, Chrome, rules, skills)
  preview <dir>          Run a project safely and get a link (and screenshots with --capture)
  adapt <dir>            What loom knows about this project's stack, in plain language
  report <dir> [--open]  One readable page of everything loom found (screenshots, fixes, review)
  capture <url>          Review-grade screenshots plus validity checks
  adopt <dir> [--url U]  Evidence report for taking over an existing project's design
  learn <action>         Lessons from reviews, compiled into house rules and checks

Run \`loom\` on its own for a guided menu. loom <command> --help shows options. loom --version prints the version.
`

const ADOPT_HELP = `loom adopt <dir> [options]

Scans an existing project (as text: nothing in it is executed) and writes an
evidence report for adopting its design: stack, routes, product facts, the
design system in source, supply-chain safety, findings and interview
questions. With --url (an already running instance) it adds a rendered census
(palette by painted area, type as used, contrast) and captures.

Options
  --url URL             Running instance to measure and capture
  --out DIR             Output directory           (default <dir>/.design/adopt)
  --viewports LIST      Capture viewports           (default 1440x900,390x844)
  --no-captures         Rendered census only, no screenshots
  --renderer MODE       gpu | software             (default gpu on macOS)
  --quiet               No progress lines

Exit codes: 0 done, 3 supply-chain markers found (review before running the project), 1 error.
`

const HELP = `loom capture <url> [options]

Captures review-grade screenshots: first viewport and stitched full page per
viewport, plus a manifest of validity checks and page findings.

Options
  --viewports LIST      Comma list of WIDTHxHEIGHT[@DPR]  (default 1440x900,390x844)
  --out DIR             Output directory                  (default ./.design/captures)
  --name NAME           Prefix for output files
  --no-full             Skip the stitched full page
  --no-first            Skip the first-viewport capture
  --motion MODE         reduce | full | both               (default reduce)
                          reduce: still record, every reveal at its final state
                          full:   capture with motion on
                          both:   still record + a motion first viewport
  --settle MS           Wait after load before capturing  (default 1500)
  --motion-settle MS    Wait for the motion first viewport (default 3500)
  --slice-settle MS     Wait after each scroll step        (default 500)
  --hide SELECTOR       Hide elements (repeatable)
  --css CSS             Extra CSS to inject before capture
  --wait-for SELECTOR   Wait until a selector exists
  --keep-fixed          Keep fixed/sticky chrome on every slice
  --frames              Also save every scroll frame (automatic when the page
                          has large fixed or pinned scenes)
  --color-scheme MODE   light | dark                       (default light)
  --timeout MS          Navigation/network timeout         (default 30000)
  --renderer MODE       gpu | software  (default gpu on macOS, software elsewhere)
                          software (SwiftShader) runs anywhere but heavy canvas
                          or WebGL pages can take a minute to settle
  --headed              Show the browser (debugging)
  --json                Print the manifest as JSON
  --quiet               No progress lines

Exit codes: 0 valid, 2 a capture is invalid as evidence, 1 error.
`

function parse(argv) {
  const opts = {
    viewports: "1440x900,390x844",
    out: ".design/captures",
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
    headed: false,
    json: false,
    renderer: process.platform === "darwin" ? "gpu" : "software",
  }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} needs a value`)
      return v
    }
    switch (a) {
      case "--viewports": opts.viewports = val(); break
      case "--out": opts.out = val(); break
      case "--name": opts.name = val(); break
      case "--no-full": opts.full = false; break
      case "--no-first": opts.first = false; break
      case "--motion": opts.motion = val(); break
      case "--settle": opts.settleMs = +val(); break
      case "--motion-settle": opts.motionSettleMs = +val(); break
      case "--slice-settle": opts.sliceSettleMs = +val(); break
      case "--hide": opts.hide.push(val()); break
      case "--css": opts.css = val(); break
      case "--wait-for": opts.waitFor = val(); break
      case "--keep-fixed": opts.keepFixed = true; break
      case "--frames": opts.frames = true; break
      case "--color-scheme": opts.colorScheme = val(); break
      case "--timeout": opts.timeoutMs = +val(); break
      case "--headed": opts.headed = true; break
      case "--renderer": opts.renderer = val(); break
      case "--json": opts.json = true; opts.quiet = true; break
      case "--quiet": opts.quiet = true; break
      case "-h": case "--help": opts.help = true; break
      default:
        if (a.startsWith("--")) throw new Error(`Unknown option ${a}`)
        rest.push(a)
    }
  }
  if (!["reduce", "full", "both"].includes(opts.motion)) throw new Error("--motion must be reduce, full or both")
  return { opts, rest }
}

async function runAdopt(argv) {
  const o = { viewports: "1440x900,390x844", captures: true, renderer: process.platform === "darwin" ? "gpu" : "software" }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} needs a value`)
      return v
    }
    if (a === "--url") o.url = val()
    else if (a === "--out") o.out = val()
    else if (a === "--viewports") o.viewports = val()
    else if (a === "--no-captures") o.captures = false
    else if (a === "--renderer") o.renderer = val()
    else if (a === "--quiet") o.quiet = true
    else if (a === "-h" || a === "--help") return console.log(ADOPT_HELP)
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`)
    else rest.push(a)
  }
  if (!rest[0]) return console.log(ADOPT_HELP)
  if (o.url && !/^[a-z]+:\/\//i.test(o.url)) o.url = `http://${o.url}`
  const r = await adopt({ dir: rest[0], ...o, viewports: parseViewports(o.viewports) })
  const counts = r.found.reduce((m, f) => ((m[f.level] = (m[f.level] ?? 0) + 1), m), {})
  console.log(`\nfindings: ${counts.stop ?? 0} stop, ${counts.fix ?? 0} fix, ${counts.note ?? 0} note`)
  for (const f of r.found.filter((f) => f.level !== "note").slice(0, 12)) console.log(`  ${f.level === "stop" ? "!!" : "! "} ${f.text}`)
  console.log(`\nreport  ${r.outDir}/adopt.md\ndata    ${r.outDir}/adopt.json`)
  process.exitCode = r.safety ? 3 : 0
}

async function main(args = process.argv.slice(2)) {
  const [cmd, ...argv] = args
  if (!cmd && process.stdin.isTTY && process.stdout.isTTY) return guide((a) => main(a))
  if (!cmd || cmd === "-h" || cmd === "--help") return console.log(TOP_HELP)
  if (cmd === "-v" || cmd === "--version") return console.log(VERSION)
  if (cmd === "setup") {
    const found = findImpeccable()
    if (found) return console.log(`impeccable ${found.version} is already installed (${found.how}: ${found.where}). Nothing to do.`)
    console.log("loom uses impeccable for design directions, reviews and documentation.\n")
    for (const l of IMPECCABLE_DISCLOSURE) console.log(`  ${l}`)
    if (!argv.includes("--yes") && process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      const a = (await rl.question("\nInstall it now? [Y/n] ")).trim().toLowerCase()
      rl.close()
      if (a === "n" || a === "no") return console.log("Skipped. Run `loom setup` any time.")
    }
    try {
      const r = installImpeccable({ log: (m) => process.stderr.write(`  · ${m}\n`) })
      console.log(`\nimpeccable ${r.version} installed. Start a new Claude Code session (or run /reload-plugins) to use it.`)
    } catch (e) {
      console.error(`\n${e.message}`)
      process.exitCode = 1
    }
    return
  }
  if (cmd === "doctor") {
    const rows = doctor()
    const mark = { ok: "✓", warn: "!", fail: "✗" }
    for (const r of rows) console.log(`${mark[r.state]} ${r.name.padEnd(17)} ${r.detail}`)
    process.exitCode = rows.some((r) => r.state === "fail") ? 1 : 0
    return
  }
  if (cmd === "adopt") return runAdopt(argv)
  if (cmd === "preview") return runPreview(argv)
  if (cmd === "adapt") return runAdapt(argv)
  if (cmd === "report") {
    const dir = argv.find((a) => !a.startsWith("--"))
    if (!dir) return console.log("loom report <dir> [--open]\n\nWrites <dir>/.design/report/index.html from the evidence loom has gathered.")
    const r = report(dir)
    console.log(`${r.status.text}\nreport  ${r.page} (${r.images.length} screenshot(s))`)
    if (argv.includes("--open") && process.platform === "darwin") spawn("open", [r.page], { stdio: "ignore", detached: true }).unref()
    return
  }
  if (cmd === "learn") return runLearn(argv)
  if (cmd !== "capture") throw new Error(`Unknown command "${cmd}". Try: loom --help`)
  const { opts, rest } = parse(argv)
  if (opts.help || !rest[0]) return console.log(HELP)

  opts.url = /^[a-z]+:\/\//i.test(rest[0]) ? rest[0] : `http://${rest[0]}`
  opts.viewports = parseViewports(opts.viewports)
  opts.out = resolve(opts.out)

  const m = await capture(opts)
  if (opts.json) console.log(JSON.stringify(m, null, 2))
  else {
    for (const v of m.viewports) {
      console.log(`\n${v.name} ${v.width}x${v.height}${v.dpr !== 1 ? "@" + v.dpr : ""}  ${v.valid ? "valid" : "INVALID"}`)
      if (v.files.first) console.log(`  first   ${v.files.first}`)
      if (v.files.motionFirst) console.log(`  motion  ${v.files.motionFirst}`)
      for (const f of v.files.full ?? []) console.log(`  full    ${f}  (${v.pageHeight}px, ${v.slices} slices)`)
      if (v.files.frames) console.log(`  frames  ${v.files.frames.length} in ${v.files.frames[0].replace(/\/[^/]+$/, "")}`)
      for (const w of v.warnings) console.log(`  ! ${w}`)
    }
    console.log(`\nmanifest ${m.file}`)
  }
  process.exitCode = m.valid ? 0 : 2
}

main().catch((e) => {
  console.error(`loom: ${e.message}`)
  process.exitCode = 1
})
