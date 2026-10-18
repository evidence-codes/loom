// Coding agents other than Claude Code (which gets loom as a plugin). Each one
// reads plain SKILL.md folders, so loom installs its skills, and the pinned
// impeccable build made for that agent, into the folders the agent's own skill
// installer uses. Only folders loom wrote (marked .loom-installed) are ever
// replaced; anything else with the same name is left alone.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, cpSync, chmodSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const VERSION = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version
const MARK = ".loom-installed"

const home = () => homedir()
const codexHome = () => process.env.CODEX_HOME || join(home(), ".codex")

export const AGENTS = {
  cursor: {
    name: "Cursor",
    found: () => existsSync(join(home(), ".cursor")),
    userSkills: () => join(home(), ".cursor/skills"),
    projectSkills: ".cursor/skills",
    userAgents: () => join(home(), ".cursor/agents"),
    projectAgents: ".cursor/agents",
    // Paths inside the impeccable repo at the pinned commit.
    impeccable: { skill: ".cursor/skills/impeccable", agents: ".cursor/agents" },
    ask: "/loom-workflow, or ask in plain words",
  },
  codex: {
    name: "Codex",
    found: () => existsSync(codexHome()),
    userSkills: () => join(codexHome(), "skills"),
    projectSkills: ".agents/skills",
    // impeccable's own installer uses ~/.agents/skills; Codex reads both.
    otherSkills: () => [join(home(), ".agents/skills")],
    // Codex finds the reviewer and documenter inside the skill's agents/ folder.
    impeccable: { skill: ".agents/skills/impeccable" },
    ask: "$loom-workflow, or ask in plain words",
  },
  antigravity: {
    name: "Antigravity",
    found: () => [".gemini/antigravity", ".gemini/antigravity-ide", ".gemini/antigravity-cli"].some((p) => existsSync(join(home(), p))),
    userSkills: () => join(home(), ".gemini/config/skills"),
    projectSkills: ".agent/skills",
    impeccable: { skill: ".agent/skills/impeccable" },
    ask: "ask in plain words",
  },
}

export const LOOM_SKILLS = readdirSync(join(root, "skills")).filter((n) => existsSync(join(root, "skills", n, "SKILL.md"))).sort()

export const detectAgents = () => Object.keys(AGENTS).filter((id) => AGENTS[id].found())

// "cursor,codex" or "all" into agent ids; claude is accepted and handled by the caller.
export function parseAgents(list) {
  const ids = list.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (ids.includes("all")) return ["claude", ...Object.keys(AGENTS)]
  for (const id of ids) if (id !== "claude" && !AGENTS[id]) throw new Error(`Unknown agent "${id}". loom supports: claude, ${Object.keys(AGENTS).join(", ")}`)
  return [...new Set(ids)]
}

const skillsDir = (id, project) => (project ? join(resolve(project), AGENTS[id].projectSkills) : AGENTS[id].userSkills())
const agentsDir = (id, project) => (project ? join(resolve(project), AGENTS[id].projectAgents) : AGENTS[id].userAgents?.())
const ours = (dir) => existsSync(join(dir, MARK))

// Outside Claude Code the skills aren't namespaced, so `adopt` becomes
// `loom-adopt` and every loom:adopt reference follows.
export function forAgent(text) {
  return text.replace(/^name:\s*(\S+)/m, (_, n) => `name: loom-${n}`).replace(/\/?loom:([a-z]+)\b/g, "loom-$1")
}

// Replace dir with fill()'s output, unless something loom didn't write is there.
function writeOwned(dir, fill, mark) {
  const existed = existsSync(dir)
  if (existed && !ours(dir)) return "kept"
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  fill(dir)
  writeFileSync(join(dir, MARK), JSON.stringify(mark, null, 2) + "\n")
  return existed ? "updated" : "added"
}

export function installLoomSkills(id, { project } = {}) {
  const base = skillsDir(id, project)
  return LOOM_SKILLS.map((n) => {
    const dir = join(base, `loom-${n}`)
    const state = writeOwned(
      dir,
      (d) => {
        cpSync(join(root, "skills", n), d, { recursive: true })
        writeFileSync(join(d, "SKILL.md"), forAgent(readFileSync(join(root, "skills", n, "SKILL.md"), "utf8")))
      },
      { by: "loom", version: VERSION, from: join(root, "skills", n) },
    )
    return { skill: `loom-${n}`, dir, state }
  })
}

export function findLoomSkills(id, { project } = {}) {
  const base = skillsDir(id, project)
  return LOOM_SKILLS.filter((n) => existsSync(join(base, `loom-${n}`, "SKILL.md")))
}

const skillVersion = (dir) => readFileSync(join(dir, "SKILL.md"), "utf8").match(/version:\s*["']?([\d.]+)/)?.[1] ?? "unknown"

export function findImpeccableFor(id, { project } = {}) {
  const dirs = [skillsDir(id, project), ...(project ? [] : AGENTS[id].otherSkills?.() ?? [])]
  const dir = dirs.map((d) => join(d, "impeccable")).find((d) => existsSync(join(d, "SKILL.md")))
  return dir ? { where: dir, version: skillVersion(dir), byLoom: ours(dir) } : null
}

// Copy impeccable's build for this agent out of a checkout of the pinned commit.
export function installImpeccableFor(id, { source, commit, project } = {}) {
  const spec = AGENTS[id].impeccable
  const from = join(source, spec.skill)
  if (!existsSync(join(from, "SKILL.md"))) throw new Error(`impeccable's ${AGENTS[id].name} build is missing from ${source}`)
  const existing = findImpeccableFor(id, { project })
  if (existing && !existing.byLoom) return { state: "kept", dir: existing.where, version: existing.version }
  const dir = join(skillsDir(id, project), "impeccable")
  const state = writeOwned(
    dir,
    (d) => {
      cpSync(from, d, { recursive: true })
      for (const s of ["impeccable", "impeccable.cmd"]) if (existsSync(join(d, "scripts", s))) chmodSync(join(d, "scripts", s), 0o755)
    },
    { by: "loom", impeccable: commit ?? "unknown" },
  )
  const agents = []
  if (spec.agents && state !== "kept") {
    const out = agentsDir(id, project)
    mkdirSync(out, { recursive: true })
    for (const f of readdirSync(join(source, spec.agents)).filter((f) => /^impeccable-.*\.md$/.test(f))) {
      cpSync(join(source, spec.agents, f), join(out, f))
      agents.push(join(out, f))
    }
  }
  return { state, dir, version: skillVersion(dir), agents }
}
