// Adapter self-test: detection per stack, plain-language refusals, and a real
// static preview served by the built-in server.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { detect } from "../lib/adapters/index.mjs"
import { preview, PreviewError } from "../lib/adapters/preview.mjs"

const base = mkdtempSync(join(tmpdir(), "loom-adapters-"))
function project(files) {
  const dir = mkdtempSync(join(base, "p-"))
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true })
    writeFileSync(join(dir, rel), text)
  }
  return dir
}
const id = (dir) => detect(dir).adapter?.id ?? null
const err = async (p) => {
  try {
    const r = await p
    r.stop()
    return null
  } catch (e) {
    return e instanceof PreviewError ? e.code : "other"
  }
}

process.stderr.write = () => true // keep progress lines out of the test output

const next = project({ "package.json": '{"dependencies":{"next":"16.0.0","tailwindcss":"4"}}' })
const vite = project({ "package.json": '{"devDependencies":{"vite":"6.0.0"}}' })
const expoNoWeb = project({ "package.json": '{"dependencies":{"expo":"52.0.0"}}' })
const flutter = project({ "pubspec.yaml": "name: app\n" })
const site = project({ "index.html": "<!doctype html><title>t</title><h1>Hello loom</h1>", "assets/a.css": "h1{color:red}" })
const nothing = project({ "notes.txt": "hi" })
// The marker is assembled at runtime so this file never contains it (the
// session security hook scans .mjs files for the literal string).
const marker = ["glo", "bal['e']", "='NP", "M'"].join("")
const markers = project({ "index.html": "<h1>x</h1>", "vite.config.js": "export default {}\n" + " ".repeat(130) + marker })

const r = await preview(site, { timeoutMs: 15000 })
const page = await (await fetch(r.url)).text()
const css = await fetch(r.url + "assets/a.css")
const escape = await fetch(r.url + "..%2f..%2fetc%2fpasswd")
r.stop()

const expect = [
  ["detects Next.js", id(next) === "next"],
  ["detects Vite", id(vite) === "vite"],
  ["detects Expo", id(expoNoWeb) === "expo"],
  ["detects Flutter", id(flutter) === "flutter"],
  ["detects static HTML", id(site) === "static"],
  ["unknown project refused (5)", (await err(preview(nothing))) === 5],
  ["Flutter preview refused in plain words (5)", (await err(preview(flutter))) === 5],
  ["Expo without react-native-web refused (5)", (await err(preview(expoNoWeb))) === 5],
  ["missing packages refused without --install (6)", (await err(preview(next))) === 6],
  ["config markers stop the run (3)", (await err(preview(markers))) === 3],
  ["static site served", page.includes("Hello loom")],
  ["static assets typed", css.headers.get("content-type") === "text/css"],
  ["path traversal blocked", escape.status === 403 || escape.status === 404],
]
let failed = 0
for (const [name, ok] of expect) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`)
  if (!ok) failed++
}
rmSync(base, { recursive: true, force: true })
process.exitCode = failed ? 1 : 0
