// loom doctor: is this machine ready to run the workflow?

import { existsSync, readFileSync, lstatSync, readlinkSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { findChrome } from "./cdp.mjs"
import { readLedger, LOOM_HOME } from "./learn/ledger.mjs"
import { findImpeccable, hasClaude } from "./setup.mjs"
import { AGENTS, detectAgents, findLoomSkills, findImpeccableFor, LOOM_SKILLS } from "./agents.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

export function doctor() {
  const rows = []
  const ok = (name, detail) => rows.push({ state: "ok", name, detail })
  const warn = (name, detail) => rows.push({ state: "warn", name, detail })
  const fail = (name, detail) => rows.push({ state: "fail", name, detail })

  const major = +process.versions.node.split(".")[0]
  major >= 22 ? ok("Node", process.version) : fail("Node", `${process.version}; loom needs Node 22 or newer (built-in WebSocket)`)

  try {
    const chrome = findChrome()
    const v = execFileSync(chrome, ["--version"], { encoding: "utf8" }).trim()
    ok("Chrome", v)
  } catch (e) {
    fail("Chrome", e.message)
  }

  const bin = join(homedir(), ".local/bin/loom")
  if (existsSync(bin) && lstatSync(bin).isSymbolicLink() && readlinkSync(bin).startsWith(root)) ok("CLI on PATH", bin)
  else warn("CLI on PATH", "not linked; run install.sh")

  const lessons = readLedger().filter((e) => !e.retired)
  lessons.length ? ok("Lesson ledger", `${lessons.length} lessons in ${join(LOOM_HOME, "ledger.jsonl")}`) : warn("Lesson ledger", "empty; run `loom learn seed`")
  existsSync(join(LOOM_HOME, "house-rules.md")) ? ok("House rules", join(LOOM_HOME, "house-rules.md")) : warn("House rules", "not compiled; run `loom learn rules`")

  // Claude Code rows are skipped only when another agent is here and Claude isn't.
  const others = detectAgents()
  if (hasClaude() || !others.length) {
    const imp = findImpeccable()
    imp ? ok("impeccable", `${imp.version} (${imp.how}: ${imp.where})`) : warn("impeccable", "not installed; run `loom setup`")

    const cfg = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")
    const agents = ["impeccable-finish-reviewer", "impeccable-documenter"].filter((a) => existsSync(join(cfg, "agents", `${a}.md`)))
    if (agents.length === 2) ok("Review agents", `finish reviewer and documenter in ${join(cfg, "agents")}`)
    else if (imp?.how === "plugin") ok("Review agents", "provided by the impeccable plugin")
    else warn("Review agents", "impeccable's finish reviewer/documenter not found; run `loom setup`")
  }

  for (const id of others) {
    const skills = findLoomSkills(id).length
    const imp = findImpeccableFor(id)
    const detail = `loom skills ${skills}/${LOOM_SKILLS.length}, impeccable ${imp ? imp.version : "missing"}`
    const todo = [skills < LOOM_SKILLS.length && "`loom agents install`", !imp && "`loom setup`"].filter(Boolean)
    todo.length ? warn(AGENTS[id].name, `${detail}; run ${todo.join(" and ")}`) : ok(AGENTS[id].name, detail)
  }

  const hook = join(homedir(), ".claude/hooks/security-check.sh")
  if (existsSync(hook)) ok("Security hook", hook) // optional; only reported when present

  return rows
}
