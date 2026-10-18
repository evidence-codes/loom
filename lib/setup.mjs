// loom setup: get loom's dependencies onto the user's machine. Today that is
// impeccable, from a pinned, reviewed commit — never "whatever is newest". In
// Claude Code it goes in as its official plugin; Cursor, Codex and Antigravity
// get the build impeccable ships for each of them, from the same commit.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import { AGENTS, installImpeccableFor } from "./agents.mjs"

export const IMPECCABLE = {
  repo: "https://github.com/pbakaus/impeccable",
  // Reviewed in this repo's history (skill 4.6.0, engine 0.1.15). Bump only after reviewing the new commit.
  commit: "4809728d390d08f0254cd43f856fc75ef63b408d",
  version: "4.6.0",
}

const configDir = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")
const vendorDir = () => join(process.env.LOOM_HOME ?? join(homedir(), ".loom"), "vendor", "impeccable")

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts })
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() }
}

export const hasClaude = () => run("claude", ["--version"]).ok

// Where impeccable already lives, if anywhere: a plugin install, or a skill
// copied into the user's skills folder (how it was set up on this machine).
export function findImpeccable() {
  const skill = [join(configDir(), "skills/impeccable"), join(homedir(), ".claude/skills/impeccable")].find((p) => existsSync(join(p, "SKILL.md")))
  if (skill) {
    const v = readFileSync(join(skill, "SKILL.md"), "utf8").match(/version:\s*([\d.]+)/)?.[1]
    return { how: "skill", where: skill, version: v ?? "unknown" }
  }
  if (hasClaude()) {
    const list = run("claude", ["plugin", "list"]).out
    const m = list.match(/impeccable@([\w.-]+)[\s\S]*?Version:\s*([\d.]+)/)
    if (m) return { how: "plugin", where: `impeccable@${m[1]}`, version: m[2] }
  }
  return null
}

export const IMPECCABLE_DISCLOSURE = [
  `impeccable ${IMPECCABLE.version} by Paul Bakaus (Apache-2.0), pinned to a reviewed commit.`,
  "It adds the design skill and its reviewer and documenter agents. In Claude Code it also",
  "adds hooks that run its design detector when a session starts, after file edits, and",
  "when Claude stops; in other agents those hooks are per project and aren't added.",
  "Its engine is a small binary it downloads and checksum-verifies on first use, and it",
  "contacts impeccable.style for design directions; set IMPECCABLE_NO_TELEMETRY=1 to stop",
  "its anonymous usage pings.",
]

// Fetch only the files loom installs (the Claude Code plugin and the builds for
// the other agents) at the pinned commit, and verify what arrived.
export function fetchImpeccable({ log = () => {} } = {}) {
  if (!run("git", ["--version"]).ok) throw new Error("git isn't installed, so impeccable can't be downloaded.")
  const dir = vendorDir()
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true })
    log("downloading impeccable (only the files loom installs)")
    for (const args of [
      ["init", "-q"],
      ["remote", "add", "origin", IMPECCABLE.repo],
      ["config", "core.sparseCheckout", "true"],
    ]) {
      const r = run("git", args, { cwd: dir })
      if (!r.ok) throw new Error(`git ${args[0]} failed: ${r.out}`)
    }
  }
  // Rewritten every time so a checkout from an older loom gains the new paths.
  const paths = ["/.claude-plugin/", "/plugin/", ...Object.values(AGENTS).flatMap((a) => Object.values(a.impeccable).map((p) => `/${p}/`))]
  writeFileSync(join(dir, ".git/info/sparse-checkout"), paths.join("\n") + "\n")
  log(`checking out the reviewed commit ${IMPECCABLE.commit.slice(0, 7)}`)
  let r = run("git", ["fetch", "-q", "--depth", "1", "origin", IMPECCABLE.commit], { cwd: dir })
  if (!r.ok) throw new Error(`Couldn't download impeccable: ${r.out}`)
  r = run("git", ["checkout", "-q", "--force", IMPECCABLE.commit], { cwd: dir })
  if (!r.ok) throw new Error(`Couldn't check out impeccable: ${r.out}`)
  r = run("git", ["read-tree", "-mu", "HEAD"], { cwd: dir })
  if (!r.ok) throw new Error(`Couldn't check out impeccable: ${r.out}`)
  const head = run("git", ["rev-parse", "HEAD"], { cwd: dir }).out
  if (head !== IMPECCABLE.commit) throw new Error(`impeccable checkout is at ${head}, expected ${IMPECCABLE.commit}; stopping.`)
  const manifest = JSON.parse(readFileSync(join(dir, "plugin/.claude-plugin/plugin.json"), "utf8"))
  if (manifest.name !== "impeccable" || manifest.version !== IMPECCABLE.version) throw new Error(`Unexpected impeccable manifest (${manifest.name} ${manifest.version}); stopping.`)
  return dir
}

// agents: "claude" and/or ids from AGENTS. Returns one result per agent.
export function installImpeccable({ log = () => {}, agents = ["claude"] } = {}) {
  if (agents.includes("claude") && !hasClaude()) throw new Error("Claude Code isn't installed. Install it first (https://claude.com/claude-code), or leave it out with --agents.")
  const dir = fetchImpeccable({ log })
  const results = []
  for (const id of agents) {
    if (id === "claude") {
      log("adding impeccable to Claude Code")
      let r = run("claude", ["plugin", "marketplace", "add", dir, "--scope", "user"])
      if (!r.ok && !/already/i.test(r.out)) throw new Error(`Couldn't add impeccable's marketplace: ${r.out}`)
      r = run("claude", ["plugin", "install", "impeccable@impeccable", "--scope", "user"])
      if (!r.ok && !/already/i.test(r.out)) throw new Error(`Couldn't install the impeccable plugin: ${r.out}`)
      results.push({ agent: "claude", state: "added", version: IMPECCABLE.version, dir: "impeccable@impeccable" })
    } else {
      log(`adding impeccable to ${AGENTS[id].name}`)
      results.push({ agent: id, ...installImpeccableFor(id, { source: dir, commit: IMPECCABLE.commit }) })
    }
  }
  return { version: IMPECCABLE.version, source: dir, results }
}
