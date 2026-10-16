// Supply-chain checks before anything in a project runs: the config scan from
// adopt, plus the loader markers of the Sep 2026 npm worm (PolinRider /
// EtherHiding family) across node_modules.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { scan } from "./adopt/scan.mjs"

const MARKERS = /global\.[a-z!]='5-[0-9]+-du'|global\['[a-z!]'\]='NPM'|\/\*C260521A\*\/|_\$_[0-9a-f]{4}=\(function\([a-z],[a-z]\)\{var [a-z]=[a-z]\.length/

export function scanConfigs(root) {
  return scan(root).safety.findings
}

export function scanNodeModules(root) {
  const start = join(root, "node_modules")
  const hits = []
  let files = 0
  const stack = [start]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name !== ".cache") stack.push(p)
      } else if (e.isFile() && [".js", ".cjs", ".mjs"].includes(extname(e.name))) {
        let size = 0
        try {
          size = statSync(p).size
        } catch {}
        if (size > 2_000_000) continue
        files++
        try {
          if (MARKERS.test(readFileSync(p, "latin1"))) hits.push(p)
        } catch {}
      }
    }
  }
  return { files, hits }
}
