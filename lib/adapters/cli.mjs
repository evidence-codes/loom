import { writeFileSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { detect } from "./index.mjs"
import { previewAndCapture, PreviewError } from "./preview.mjs"
import { readLedger } from "../learn/ledger.mjs"
import { parseViewports } from "../capture.mjs"

export const PREVIEW_HELP = `loom preview <dir> [options]

Runs a project locally the safe way and gives you a link. loom works out the
stack, scans the project for supply-chain markers first, and starts it on a
free port. Nothing is installed unless you say --install.

Options
  --install           Install missing packages from the lockfile (install scripts off)
  --capture           Take review screenshots once it's running (into <dir>/.design/preview)
  --once              With --capture: stop the site afterwards instead of leaving it running
  --open              Open the link in your browser
  --port N            Use this port instead of the first free one from 3300
  --viewports LIST    Capture viewports (default 1440x900,390x844)

Exit codes: 0 ok, 3 stopped by a safety finding, 5 stack not supported,
6 packages need installing, 7 the site failed to start.
`

export const ADAPT_HELP = `loom adapt <dir>

Plain-language brief for a project's stack: how loom runs and builds it, and
which house rules apply. Also written to <dir>/.design/adapter.md.
`

function flags(argv) {
  const o = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("--")) o._.push(a)
    else if (["--port", "--viewports", "--out"].includes(a)) o[a.slice(2)] = argv[++i]
    else o[a.slice(2)] = true
  }
  return o
}

export async function runPreview(argv) {
  const o = flags(argv)
  if (o.help || !o._[0]) return console.log(PREVIEW_HELP)
  try {
    const r = await previewAndCapture(o._[0], {
      install: !!o.install,
      port: o.port ? +o.port : undefined,
      capture: !!o.capture,
      out: o.out,
      viewports: parseViewports(o.viewports ?? "1440x900,390x844"),
      renderer: process.platform === "darwin" ? "gpu" : "software",
    })
    console.log(`\nYour site is running: ${r.url}`)
    if (r.caps) {
      for (const v of r.caps.viewports) console.log(`  ${v.name} ${v.valid ? "screenshots ok" : "screenshots NOT valid"}: ${[v.files.first, ...(v.files.full ?? [])].join(", ")}`)
      for (const v of r.caps.viewports) for (const w of v.warnings) console.log(`  ! ${v.name}: ${w.split("\n")[0]}`)
    }
    if (o.open && process.platform === "darwin") spawn("open", [r.url], { stdio: "ignore", detached: true }).unref()
    if (o.once) {
      r.stop()
      return
    }
    console.log("Press Ctrl-C to stop it.")
    await new Promise((res) => {
      const done = () => {
        r.stop()
        res()
      }
      process.once("SIGINT", done)
      process.once("SIGTERM", done)
    })
  } catch (e) {
    if (e instanceof PreviewError) {
      console.error(`\n${e.message}`)
      process.exitCode = e.code
    } else throw e
  }
}

export function runAdapt(argv) {
  const o = flags(argv)
  if (o.help || !o._[0]) return console.log(ADAPT_HELP)
  const root = resolve(o._[0])
  const { adapter, pkg } = detect(root)
  if (!adapter) {
    console.log("loom doesn't recognise this project's stack yet.")
    process.exitCode = 5
    return
  }
  const lessons = new Map(readLedger().map((e) => [e.id, e]))
  const traps = adapter.traps(root, pkg).map((id) => lessons.get(id)).filter(Boolean)
  const dev = adapter.dev(root, pkg, 3300)
  const lines = [
    `# ${adapter.name}`,
    "",
    "## Running it",
    adapter.unsupported?.(root, pkg) ?? `\`loom preview ${o._[0]}\` starts it${dev?.builtin ? " with loom's built-in static server" : ` (${[dev.cmd.split("/").pop(), ...dev.args].join(" ")})`} after a safety scan.`,
    "",
    "## Notes for this stack",
    ...adapter.notes(root, pkg).map((n) => `- ${n}`),
    "",
    "## House rules that apply here",
    ...(traps.length ? traps.map((t) => `- **${t.rule}** ${t.why}`) : ["- none recorded yet"]),
    "",
  ]
  const text = lines.join("\n")
  mkdirSync(join(root, ".design"), { recursive: true })
  writeFileSync(join(root, ".design/adapter.md"), text)
  console.log(text)
}
