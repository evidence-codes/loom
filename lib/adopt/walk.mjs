// File walking for static scans. Never executes project code: every file is
// read as text, configs included.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, extname } from "node:path"

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", ".svelte-kit", ".expo", ".turbo", ".vercel", ".cache",
  "dist", "build", "out", "coverage", "Pods", "DerivedData", ".gradle", "vendor", ".venv", "venv",
  "__pycache__", ".impeccable", ".design", "storybook-static", ".output",
  "playwright-report", "test-results", ".dart_tool", "ephemeral", ".symlinks", "generated",
])

export const SOURCE_EXT = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro",
  ".css", ".scss", ".sass", ".less", ".html", ".htm", ".mdx", ".md", ".json", ".dart",
])

const MAX_FILE_BYTES = 1_500_000

export function walk(root, { maxFiles = 20000 } = {}) {
  const files = []
  const stack = [root]
  while (stack.length && files.length < maxFiles) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.name === ".DS_Store") continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !(e.name.startsWith(".") && e.name !== ".github")) stack.push(full)
      } else if (e.isFile()) {
        const ext = extname(e.name).toLowerCase()
        if (!SOURCE_EXT.has(ext) && e.name !== "pubspec.yaml" && !/^(postcss|tailwind|vite|next|metro|babel|app)\.config\./.test(e.name)) continue
        let size = 0
        try {
          size = statSync(full).size
        } catch {}
        files.push({ path: full, rel: relative(root, full), ext, size })
      }
    }
  }
  return files
}

export function read(file) {
  if (file.size > MAX_FILE_BYTES) return ""
  try {
    return readFileSync(file.path, "utf8")
  } catch {
    return ""
  }
}
