// `loom` with no arguments in a terminal: a guided menu in plain words, for
// people who don't know (or want to know) the commands.

import { createInterface } from "node:readline/promises"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { homedir } from "node:os"

const CHOICES = [
  { key: "1", label: "Show me my site", hint: "runs it safely and gives you a link", run: (dir) => ["preview", dir, "--open"] },
  { key: "2", label: "Take screenshots for a review", hint: "desktop and phone, the way visitors see it", run: (dir) => ["preview", dir, "--capture", "--once"] },
  { key: "3", label: "Check my site's design", hint: "what it's built with, what's inconsistent or broken", run: (dir) => ["adopt", dir] },
  { key: "4", label: "Redesign or improve my site", hint: "best done by asking your coding agent", run: null },
  { key: "5", label: "Check loom is set up properly", hint: "", run: () => ["doctor"] },
]

export async function guide(dispatch) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log("\nloom: design help for your website\n")
    for (const c of CHOICES) console.log(`  ${c.key}. ${c.label}${c.hint ? `  (${c.hint})` : ""}`)
    const pick = (await rl.question("\nWhat would you like to do? [1-5] ")).trim()
    const choice = CHOICES.find((c) => c.key === pick)
    if (!choice) return console.log("No problem. Run `loom` again any time, or `loom --help` for every command.")

    if (!choice.run) {
      console.log(
        "\nOpen Claude Code, Cursor, Codex or Antigravity in your site's folder and say something like:\n\n" +
          '  "Use loom to redesign my landing page."\n' +
          '  "Use loom to check my site and fix what\'s broken."\n\n' +
          "It runs the whole workflow: a few questions, design directions to choose from,\nthe build, an independent review, and screenshots.",
      )
      return
    }
    let dir = process.cwd()
    if (choice.key !== "5") {
      const answer = (await rl.question(`Which folder is your site in? [${dir.replace(homedir(), "~")}] `)).trim()
      if (answer) dir = resolve(answer.replace(/^~(?=$|\/)/, homedir()))
      if (!existsSync(dir)) return console.log(`Can't find ${dir}. Check the folder and try again.`)
    }
    rl.close()
    console.log("")
    await dispatch(choice.run(dir))
  } finally {
    rl.close()
  }
}
