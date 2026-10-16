// Installer self-test: run the real install.sh against a throwaway home with
// only node on PATH (no claude, so no plugin or impeccable step), then check
// the CLI works and the house rules exist. Guards against shipping a broken
// or empty installer.
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, symlinkSync, existsSync, statSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const home = mkdtempSync(join(tmpdir(), "loom-install-"))
const bin = join(home, "toolbin")
mkdirSync(bin)
symlinkSync(process.execPath, join(bin, "node"))
const env = { HOME: home, PATH: `${join(home, ".local/bin")}:${bin}:/usr/bin:/bin`, LOOM_CHROME: process.env.LOOM_CHROME ?? "" }

let out = ""
let code = 0
try {
  out = execFileSync("sh", [join(root, "install.sh"), "--no-plugin"], { env, encoding: "utf8", cwd: home })
} catch (e) {
  out = `${e.stdout ?? ""}${e.stderr ?? ""}`
  code = e.status
}
const loom = join(home, ".local/bin/loom")
let version = ""
try {
  version = execFileSync(loom, ["--version"], { env, encoding: "utf8" }).trim()
} catch {}

const expect = [
  ["installer is not empty", statSync(join(root, "install.sh")).size > 1000],
  ["installer exits cleanly", code === 0],
  ["loom linked into ~/.local/bin", existsSync(loom)],
  ["linked loom runs", /^\d+\.\d+\.\d+$/.test(version)],
  ["house rules compiled", existsSync(join(home, ".loom/house-rules.md"))],
  ["no plugin step without claude", !/Claude Code\n/.test(out.replace(/\x1b\[[0-9;]*m/g, ""))],
]
let failed = 0
for (const [name, ok] of expect) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`)
  if (!ok) failed++
}
if (failed) console.log(out)
rmSync(home, { recursive: true, force: true })
process.exitCode = failed ? 1 : 0
