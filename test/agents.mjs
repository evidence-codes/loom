// Agents self-test: loom's skills and impeccable's per-agent builds land in
// the folders Cursor, Codex and Antigravity read, renamed for an
// un-namespaced skill list, and nothing loom didn't write is ever replaced.
// Uses a throwaway home and a fake impeccable checkout, so no network.
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const home = mkdtempSync(join(tmpdir(), "loom-agents-"))
process.env.HOME = home
delete process.env.CODEX_HOME
for (const d of [".cursor", ".codex", ".gemini/antigravity"]) mkdirSync(join(home, d), { recursive: true })

const { detectAgents, parseAgents, installLoomSkills, findLoomSkills, installImpeccableFor, findImpeccableFor, LOOM_SKILLS } = await import("../lib/agents.mjs")

function write(rel, text) {
  mkdirSync(dirname(join(home, rel)), { recursive: true })
  writeFileSync(join(home, rel), text)
}
const read = (rel) => readFileSync(join(home, rel), "utf8")

// Something already called loom-capture that loom didn't write.
write(".cursor/skills/loom-capture/SKILL.md", "---\nname: loom-capture\n---\nmine\n")

const first = installLoomSkills("cursor")
const again = installLoomSkills("cursor")
installLoomSkills("codex")
installLoomSkills("antigravity")
const project = mkdtempSync(join(home, "p-"))
installLoomSkills("codex", { project })

const fake = mkdtempSync(join(home, "impeccable-"))
const skill = "---\nname: impeccable\nversion: 4.6.0\n---\n"
for (const p of [".cursor/skills/impeccable", ".agents/skills/impeccable", ".agent/skills/impeccable"]) {
  mkdirSync(join(fake, p, "scripts"), { recursive: true })
  writeFileSync(join(fake, p, "SKILL.md"), skill)
  writeFileSync(join(fake, p, "scripts/impeccable"), "#!/bin/sh\n")
}
mkdirSync(join(fake, ".cursor/agents"))
writeFileSync(join(fake, ".cursor/agents/impeccable-finish-reviewer.md"), "reviewer\n")
// impeccable's own installer already put it in ~/.agents/skills for Codex.
write(".agents/skills/impeccable/SKILL.md", "---\nname: impeccable\nmetadata:\n  version: 4.5.0\n---\n")

const cursorImp = installImpeccableFor("cursor", { source: fake, commit: "abc" })
const codexImp = installImpeccableFor("codex", { source: fake, commit: "abc" })
const agImp = installImpeccableFor("antigravity", { source: fake, commit: "abc" })
const cursorAgain = installImpeccableFor("cursor", { source: fake, commit: "abc" })

const env = { ...process.env, HOME: home }
const found = execFileSync(process.execPath, [join(root, "bin/loom.mjs"), "agents", "--found"], { env, encoding: "utf8" }).trim()
let unknown = false
try { parseAgents("cursor,vscode") } catch { unknown = true }

const workflow = read(".gemini/config/skills/loom-workflow/SKILL.md")
const expect = [
  ["detects all three agents", detectAgents().join() === "cursor,codex,antigravity"],
  ["CLI lists them for the installer", found === "Cursor, Codex, Antigravity"],
  ["unknown agent refused", unknown],
  ["all/claude accepted", parseAgents("all").length === 4 && parseAgents("claude,codex").join() === "claude,codex"],
  ["cursor skills added", first.filter((r) => r.state === "added").length === LOOM_SKILLS.length - 1],
  ["someone else's folder left alone", first.find((r) => r.skill === "loom-capture").state === "kept" && read(".cursor/skills/loom-capture/SKILL.md").includes("mine")],
  ["re-run updates loom's own folders", again.filter((r) => r.state === "updated").length === LOOM_SKILLS.length - 1],
  ["codex skills in ~/.codex/skills", findLoomSkills("codex").length === LOOM_SKILLS.length && existsSync(join(home, ".codex/skills/loom-adopt/.loom-installed"))],
  ["antigravity skills in ~/.gemini/config/skills", findLoomSkills("antigravity").length === LOOM_SKILLS.length],
  ["project install uses the repo's folder", existsSync(join(project, ".agents/skills/loom-learn/SKILL.md"))],
  ["skills renamed", /^name: loom-workflow$/m.test(workflow) && /^name: loom-adopt$/m.test(read(".codex/skills/loom-adopt/SKILL.md"))],
  ["no namespaced references left", !/loom:/.test(workflow) && workflow.includes("`loom-adopt` skill")],
  ["impeccable added to cursor", cursorImp.state === "added" && cursorImp.version === "4.6.0"],
  ["cursor reviewer agent copied", existsSync(join(home, ".cursor/agents/impeccable-finish-reviewer.md"))],
  ["launcher is executable", (statSync(join(home, ".cursor/skills/impeccable/scripts/impeccable")).mode & 0o111) !== 0],
  ["existing impeccable kept for codex", codexImp.state === "kept" && codexImp.version === "4.5.0" && !existsSync(join(home, ".codex/skills/impeccable"))],
  ["impeccable added to antigravity", agImp.state === "added" && findImpeccableFor("antigravity")?.byLoom === true],
  ["impeccable re-run updates", cursorAgain.state === "updated"],
]
let failed = 0
for (const [name, ok] of expect) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`)
  if (!ok) failed++
}
rmSync(home, { recursive: true, force: true })
process.exitCode = failed ? 1 : 0
