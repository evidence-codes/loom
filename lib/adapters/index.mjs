// Build adapters: what loom needs to know about a stack to run, build and
// check a project without the user knowing anything about it.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

function pkgOf(root) {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  } catch {
    return null
  }
}

const has = (pkg, name) => !!(pkg?.dependencies?.[name] || pkg?.devDependencies?.[name])
const ver = (pkg, name) => pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name] ?? ""
const major = (range) => +(String(range).match(/\d+/)?.[0] ?? 0)
const localBin = (root, name) => join(root, "node_modules", ".bin", name)

export const adapters = [
  {
    id: "next",
    name: "Next.js",
    detect: (root, pkg) => has(pkg, "next"),
    dev: (root, pkg, port) => ({ cmd: localBin(root, "next"), args: ["dev", "-p", String(port), "-H", "127.0.0.1"] }),
    build: (root) => ({ cmd: localBin(root, "next"), args: ["build"] }),
    needsInstall: true,
    traps: (root, pkg) => [
      major(ver(pkg, "tailwindcss")) >= 4 ? "tailwind-v4-config-not-loaded" : "tailwind-v3-var-colour-opacity",
      "next-font-variable-on-html",
      "no-reduced-motion-branch-in-render",
      ...(has(pkg, "framer-motion") || has(pkg, "motion") ? ["framer-pathlength-kills-dashes"] : []),
    ],
    notes: (root, pkg) => [
      `Tailwind ${major(ver(pkg, "tailwindcss")) || "not installed"}${major(ver(pkg, "tailwindcss")) >= 4 ? ": tokens go in @theme in your CSS; tailwind.config is ignored without @config." : ""}`,
      "Load fonts with next/font and put the variable classes on <html>.",
      "Client components that read reduced motion must render the same markup on the server.",
      "next.config.* runs when the project runs: loom scans it before preview.",
    ],
  },
  {
    id: "vite",
    name: "Vite",
    detect: (root, pkg) => has(pkg, "vite"),
    dev: (root, pkg, port) => ({ cmd: localBin(root, "vite"), args: ["--port", String(port), "--host", "127.0.0.1", "--strictPort"] }),
    build: (root) => ({ cmd: localBin(root, "vite"), args: ["build"] }),
    needsInstall: true,
    traps: (root, pkg) => [major(ver(pkg, "tailwindcss")) >= 4 ? "tailwind-v4-config-not-loaded" : "tailwind-v3-var-colour-opacity", ...(has(pkg, "framer-motion") ? ["framer-pathlength-kills-dashes"] : [])],
    notes: () => ["vite.config.* runs when the project runs: loom scans it before preview.", "Fonts are self-hosted or linked in index.html; check they apply in the rendered census."],
  },
  {
    id: "expo",
    name: "Expo (web preview)",
    detect: (root, pkg) => has(pkg, "expo"),
    dev: (root, pkg, port) => (has(pkg, "react-native-web") ? { cmd: localBin(root, "expo"), args: ["start", "--web", "--port", String(port)], env: { BROWSER: "none", CI: "1" } } : null),
    build: (root) => ({ cmd: localBin(root, "expo"), args: ["export", "--platform", "web"] }),
    needsInstall: true,
    unsupported: (root, pkg) => (has(pkg, "react-native-web") ? null : "This Expo app has no react-native-web, so it can't be previewed in a browser. Use a simulator; loom capture can't reach native screens yet."),
    traps: () => ["reserve-space-for-art-on-phones", "verify-the-still-record"],
    notes: () => ["The web preview approximates the app; native fonts, safe areas and gestures differ. Confirm on a device.", "metro.config.* runs when the project runs: loom scans it before preview."],
  },
  {
    id: "flutter",
    name: "Flutter",
    detect: (root) => existsSync(join(root, "pubspec.yaml")),
    dev: () => null,
    build: () => null,
    needsInstall: false,
    unsupported: () => "Flutter preview isn't supported yet. loom adopt can still scan the code (colours, fonts, screens).",
    traps: () => [],
    notes: () => ["Design tokens live in Dart (Color(0x…), ThemeData); keep them in one theme file."],
  },
  {
    id: "static",
    name: "Static HTML",
    detect: (root, pkg) => !pkg && existsSync(join(root, "index.html")),
    dev: () => ({ builtin: "static" }),
    build: () => null,
    needsInstall: false,
    traps: () => ["decorative-text-off-content", "verify-the-still-record"],
    notes: () => ["Served by loom's built-in static server: nothing in the project is executed except in the browser.", "Pin CDN script versions exactly (e.g. three@0.169.0), never a floating major."],
  },
]

export function detect(root) {
  const pkg = pkgOf(root)
  const a = adapters.find((x) => x.detect(root, pkg))
  return a ? { adapter: a, pkg } : { adapter: null, pkg }
}
