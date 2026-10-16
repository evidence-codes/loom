// Static scan of an existing project: what it is built with, what it says
// about itself, and what its design system actually is in the source.
// Reads files as text only; nothing in the project is executed.

import { existsSync, readFileSync } from "node:fs"
import { join, basename, dirname, extname } from "node:path"
import { walk, read } from "./walk.mjs"
import { toHex, nearDuplicates } from "./color.mjs"

const LIBS = {
  framework: { next: "Next.js", nuxt: "Nuxt", "@sveltejs/kit": "SvelteKit", astro: "Astro", "@remix-run/react": "Remix", vite: "Vite", expo: "Expo", "react-native": "React Native", gatsby: "Gatsby", "@angular/core": "Angular", vue: "Vue", svelte: "Svelte", react: "React" },
  styling: { tailwindcss: "Tailwind CSS", "styled-components": "styled-components", "@emotion/react": "Emotion", sass: "Sass", nativewind: "NativeWind", "@vanilla-extract/css": "vanilla-extract", "@stitches/react": "Stitches", "@pandacss/dev": "Panda CSS" },
  ui: { "@radix-ui/react-slot": "Radix (shadcn/ui)", "@mui/material": "MUI", "@chakra-ui/react": "Chakra UI", antd: "Ant Design", "@mantine/core": "Mantine", tamagui: "Tamagui", "@headlessui/react": "Headless UI", "react-native-paper": "React Native Paper", "@nextui-org/react": "NextUI", "@heroui/react": "HeroUI", "daisyui": "daisyUI" },
  motion: { gsap: "GSAP", "framer-motion": "Framer Motion", motion: "Motion", lenis: "Lenis", "@studio-freight/lenis": "Lenis", "lottie-react": "Lottie", "lottie-react-native": "Lottie", "react-native-reanimated": "Reanimated", "@react-spring/web": "React Spring", "tailwindcss-animate": "tailwindcss-animate" },
  threeD: { three: "three.js", "@react-three/fiber": "react-three-fiber", "@react-three/drei": "drei", "@splinetool/react-spline": "Spline", "ogl": "OGL" },
  icons: { "lucide-react": "Lucide", "lucide-react-native": "Lucide", "@heroicons/react": "Heroicons", "react-icons": "react-icons", "@expo/vector-icons": "Expo vector icons", "@phosphor-icons/react": "Phosphor", "@tabler/icons-react": "Tabler" },
  charts: { recharts: "Recharts", "chart.js": "Chart.js", "@nivo/core": "Nivo", d3: "D3", "victory-native": "Victory" },
}

// Loader markers of the Sep 2026 npm worm (PolinRider / EtherHiding family):
// obfuscated loaders prepended to config files, often hidden after long runs
// of spaces, that fetch payloads via Ethereum RPC.
const WORM_MARKERS = [
  /global\.o\s*=\s*['"]5-/,
  /global\.i\s*=\s*['"]/,
  /global\[['"]e['"]\]\s*=\s*['"]NPM['"]/,
  /_\$_[0-9a-f]{4}\s*=\s*\(function\s*\(\s*n\s*,\s*c\s*\)/,
  /eth_getBlockByNumber/,
  /\/\*C260521A\*\//,
]
const CONFIG_RE = /(^|\/)(postcss|vite|metro|next|tailwind|babel|webpack|rollup|astro|svelte|nuxt)\.config\.[cm]?[jt]s$|\.(cjs|mjs)$/

function pkgJson(root) {
  const p = join(root, "package.json")
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return null
  }
}

function detectLibs(pkg) {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
  const out = {}
  for (const [cat, map] of Object.entries(LIBS)) {
    const found = Object.entries(map).filter(([k]) => deps[k]).map(([k, label]) => `${label} ${deps[k]}`.trim())
    out[cat] = [...new Set(found)]
  }
  // The most specific framework wins the headline.
  out.primary = out.framework[0]?.split(" ")[0] ?? (pkg ? "Node project" : "Static site")
  return out
}

function routes(files) {
  const out = []
  for (const f of files) {
    const r = f.rel.replace(/\\/g, "/")
    let m
    if ((m = r.match(/^(?:src\/)?app\/(.*?)(?:^|\/)?page\.(tsx|jsx|ts|js|mdx)$/))) {
      out.push({ route: "/" + m[1].replace(/\/$/, "").replace(/\([^)]*\)\/?/g, "").replace(/\/$/, ""), file: r, kind: "next-app" })
    } else if ((m = r.match(/^(?:src\/)?pages\/(.*)\.(tsx|jsx|ts|js|mdx|vue|astro|svelte)$/)) && !/^(_app|_document|api\/)/.test(m[1])) {
      out.push({ route: "/" + m[1].replace(/(^|\/)index$/, ""), file: r, kind: "pages" })
    } else if ((m = r.match(/^(?:src\/)?routes\/(.*?)\+page\.svelte$/))) {
      out.push({ route: "/" + m[1].replace(/\/$/, ""), file: r, kind: "sveltekit" })
    } else if (/\.html?$/.test(r) && !r.includes("/")) {
      out.push({ route: "/" + (r === "index.html" ? "" : r), file: r, kind: "static" })
    }
  }
  // Expo Router: app/ with _layout files and no page.tsx convention.
  if (!out.length && files.some((f) => /^app\/_layout\.(tsx|jsx|js)$/.test(f.rel))) {
    for (const f of files) {
      const m = f.rel.match(/^app\/(.*)\.(tsx|jsx|js)$/)
      if (m && !m[1].includes("_layout") && !m[1].startsWith("+")) out.push({ route: "/" + m[1].replace(/(^|\/)index$/, ""), file: f.rel, kind: "expo-router" })
    }
  }
  return out.sort((a, b) => a.route.localeCompare(b.route))
}

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]{5,40}\)|hsla?\([^)]{5,40}\)/g

function tokenScan(files, texts) {
  const cssVars = [] // { name, value, selector, file }
  const literals = new Map() // hex -> { count, files:Set }
  const tw = { color: new Map(), radius: new Map(), shadow: new Map(), text: new Map(), arbitrary: 0 }
  const fonts = new Map() // family -> sources:Set
  let inlineStyleColors = 0

  for (const f of files) {
    const t = texts.get(f.rel)
    if (!t) continue
    const isStyle = [".css", ".scss", ".sass", ".less"].includes(f.ext)
    const isCode = [".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".astro", ".html", ".htm", ".mdx", ".dart"].includes(f.ext)
    if (!isStyle && !isCode) continue
    if (f.rel.includes("components/ui/")) continue // vendored shadcn primitives

    // CSS custom properties with their selector context.
    if (isStyle || f.ext === ".html" || f.ext === ".astro" || f.ext === ".vue" || f.ext === ".svelte") {
      const blockRe = /([^{}]+)\{([^{}]*)\}/g
      let b
      while ((b = blockRe.exec(t))) {
        const sel = b[1].trim().split("\n").pop().trim().slice(0, 60)
        const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g
        let d
        while ((d = declRe.exec(b[2]))) cssVars.push({ name: d[1], value: d[2].trim().slice(0, 80), selector: sel, file: f.rel })
      }
      for (const m of t.matchAll(/font-family\s*:\s*([^;}{]+)/g)) addFont(fonts, m[1].split(",")[0], `font-family in ${f.rel}`)
      for (const m of t.matchAll(/@font-face\s*\{[^}]*font-family\s*:\s*['"]?([^'";]+)/g)) addFont(fonts, m[1], `@font-face in ${f.rel}`)
    }

    if (f.ext === ".dart") {
      for (const m of t.matchAll(/Color\(0x([0-9a-fA-F]{2})([0-9a-fA-F]{6})\)/g)) {
        const hex = "#" + m[2].toLowerCase() + (m[1].toLowerCase() === "ff" ? "" : m[1].toLowerCase())
        const e = literals.get(hex) ?? { count: 0, files: new Set() }
        e.count++
        e.files.add(f.rel)
        literals.set(hex, e)
      }
      for (const m of t.matchAll(/GoogleFonts\.([a-z][a-zA-Z0-9]+?)(?:TextTheme)?\(/g)) addFont(fonts, m[1].replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()), `google_fonts in ${f.rel}`)
      for (const m of t.matchAll(/fontFamily\s*:\s*['"]([^'"]+)['"]/g)) addFont(fonts, m[1], `fontFamily in ${f.rel}`)
      continue
    }
    for (const m of t.matchAll(COLOR_LITERAL)) {
      const hex = toHex(m[0])
      if (!hex) continue
      const e = literals.get(hex) ?? { count: 0, files: new Set() }
      e.count++
      e.files.add(f.rel)
      literals.set(hex, e)
    }

    if (isCode) {
      for (const m of t.matchAll(/style=\{\{[^}]*(?:color|background)[^}]*\}\}/g)) if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(m[0])) inlineStyleColors++
      // Tailwind utility census from class strings.
      for (const cls of t.matchAll(/class(?:Name)?=\{?[`"']([^`"']+)[`"']/g)) {
        for (const u of cls[1].split(/\s+/)) {
          const base = u.split(":").pop().replace(/^!/, "")
          let m2
          if (/\[[^\]]+\]/.test(base)) tw.arbitrary++
          if (isColorUtility(base)) bump(tw.color, base)
          if ((m2 = base.match(/^rounded(?:-[trblse]{1,2})?(?:-(.+))?$/))) bump(tw.radius, base)
          if (/^shadow(-.+)?$/.test(base) && !/shadow-(?!sm|md|lg|xl|2xl|inner|none|\[)/.test(base)) bump(tw.shadow, base)
          if ((m2 = base.match(/^text-(xs|sm|base|lg|xl|[2-9]xl|\[[\d.]+(?:px|rem)\])$/))) bump(tw.text, base)
        }
      }
      // Font loading in code.
      for (const m of t.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/g)) for (const n of m[1].split(",")) addFont(fonts, n.trim().replace(/_/g, " "), `next/font/google in ${f.rel}`)
      for (const m of t.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/g)) for (const fam of m[1].matchAll(/family=([^:&]+)/g)) addFont(fonts, decodeURIComponent(fam[1]).replace(/\+/g, " "), `Google Fonts link in ${f.rel}`)
      for (const m of t.matchAll(/useFonts\(\{([^}]+)\}/g)) for (const k of m[1].matchAll(/['"]?([\w-]+)['"]?\s*:/g)) addFont(fonts, k[1], `expo-font in ${f.rel}`)
      for (const m of t.matchAll(/fontFamily\s*:\s*\[?\s*["']([^"']+)["']/g)) addFont(fonts, m[1], `fontFamily in ${f.rel}`)
    }
  }

  // Tailwind config read as text: theme colour keys and font families.
  const twConfig = files.find((f) => /^tailwind\.config\.[cm]?[jt]s$/.test(basename(f.rel)) && !f.rel.includes("/node_modules/"))
  let twTheme = null
  if (twConfig) {
    const t = texts.get(twConfig.rel) ?? ""
    twTheme = {
      file: twConfig.rel,
      colorKeys: [...new Set([...t.matchAll(/^\s*["']?([\w-]+)["']?\s*:\s*(?:["'](?:#|hsl|rgb|var)|\{)/gm)].map((m) => m[1]))].filter((k) => !/^(theme|extend|colors|fontFamily|keyframes|animation|borderRadius|plugins|content|screens|container|padding|DEFAULT|from|to)$/.test(k)).slice(0, 40),
      fontFamily: [...t.matchAll(/(\w+)\s*:\s*\[\s*["']([^"']+)["']/g)].map((m) => `${m[1]}: ${m[2]}`).slice(0, 10),
      darkMode: /darkMode/.test(t),
    }
  }

  // Stylesheets nothing imports or links: stale systems that confuse adoption.
  const referenced = new Set()
  for (const f of files) {
    const t = texts.get(f.rel) ?? ""
    for (const m of t.matchAll(/(?:import\s+(?:[\w{}\s,*]+from\s+)?|@import\s+(?:url\()?|href=)["']([^"']+\.(?:css|scss|sass|less))["']/g)) {
      const spec = m[1]
      let target
      if (spec.startsWith("@/") || spec.startsWith("~/")) target = spec.slice(2)
      else if (spec.startsWith(".")) target = join(dirname(f.rel), spec)
      else if (spec.startsWith("/")) target = spec.slice(1)
      else continue // package stylesheet
      referenced.add(target.replace(/\\/g, "/").replace(/^\.\//, ""))
    }
  }
  const unusedStylesheets = files
    .filter((f) => /\.(css|scss|sass|less)$/.test(f.ext) && !referenced.has(f.rel.replace(/\\/g, "/")))
    .map((f) => f.rel)

  // Tailwind v4: the JS config is only loaded via @config; theme colours come
  // from @theme. Utilities naming colours that exist in neither generate no CSS.
  const twV4 = files.some((f) => /@import\s+["']tailwindcss["']/.test(texts.get(f.rel) ?? ""))
  let tailwindV4 = null
  if (twV4) {
    const css = files.filter((f) => /\.(css|scss)$/.test(f.ext)).map((f) => texts.get(f.rel) ?? "").join("\n")
    const configLoaded = /@config\s+["']/.test(css)
    const themeColors = new Set([...css.matchAll(/--color-([\w-]+)\s*:/g)].map((m) => m[1]))
    const DEFAULT_PALETTE = /^(white|black|transparent|current|inherit|(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})$/
    const undefinedUse = new Map()
    for (const [util, count] of tw.color) {
      const m = util.match(/^[a-z]+(?:-[trblxyse])?-(.+?)(?:\/[\d.\[\]]+)?$/)
      const name = m?.[1]
      if (!name || name.startsWith("[") || DEFAULT_PALETTE.test(name) || themeColors.has(name)) continue
      undefinedUse.set(util, count)
    }
    tailwindV4 = {
      configFilePresent: !!files.find((f) => /^tailwind\.config\./.test(basename(f.rel))),
      configLoaded,
      themeColors: [...themeColors],
      undefinedColorUtilities: [...undefinedUse.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`),
    }
  }

  // next/font loaded as a CSS variable that nothing reads: the font downloads
  // but never applies (common with Tailwind v4 when @theme is missing).
  const allText = [...texts.values()].join("\n")
  const unappliedFonts = []
  for (const f of files) {
    const t = texts.get(f.rel) ?? ""
    for (const m of t.matchAll(/const\s+(\w+)\s*=\s*(\w+)\(\{[^}]*variable\s*:\s*["'](--[\w-]+)["']/g)) {
      const [, ident, family, variable] = m
      const read = allText.includes(`var(${variable})`)
      const classUsed = new RegExp(`\\b${ident}\\.className\\b`).test(allText)
      if (!read && !classUsed) unappliedFonts.push({ family: family.replace(/_/g, " "), variable, file: f.rel })
      // Tailwind v4: a plain @theme block resolves var() at :root, but the
      // next/font variable is often set on <body>, so the token is invalid.
      const plainTheme = [...allText.matchAll(/@theme\s*\{([^}]*)\}/g)].some((m) => m[1].includes(`var(${variable})`))
      const onBody = new RegExp(`<body[^>]*\\$\\{${ident}\\.variable\\}`).test(t)
      const onHtml = new RegExp(`<html[^>]*\\$\\{${ident}\\.variable\\}`).test(t)
      if (read && plainTheme && onBody && !onHtml) unappliedFonts.push({ family: family.replace(/_/g, " "), variable, file: f.rel, scope: true })
    }
  }

  const colorList = [...literals.entries()]
    .map(([hex, e]) => ({ hex, count: e.count, files: e.files.size }))
    .sort((a, b) => b.count - a.count)

  return {
    cssVars,
    colors: colorList,
    nearDuplicateColors: nearDuplicates(colorList.slice(0, 120)).map((g) => g.map((c) => `${c.hex} ×${c.count}`)),
    tailwind: {
      config: twTheme,
      v4: tailwindV4,
      topColorUtilities: top(tw.color, 30),
      radius: top(tw.radius, 15),
      shadow: top(tw.shadow, 10),
      textSizes: top(tw.text, 15),
      arbitraryValues: tw.arbitrary,
    },
    inlineStyleColors,
    unusedStylesheets,
    unappliedFonts,
    fonts: [...fonts.entries()].map(([family, src]) => ({ family, sources: [...src].slice(0, 4) })),
  }
}

const COLOR_PREFIX = /^(bg|text|border(?:-[trblxyse])?|ring|from|to|via|fill|stroke|outline|divide|decoration|accent|caret|placeholder)-(.+)$/
const NOT_COLOR = /^(xs|sm|base|lg|xl|\d?xl|left|right|center|justify|start|end|wrap|nowrap|balance|pretty|clip|ellipsis|none|inner|solid|dashed|dotted|double|inherit|auto|offset-\d+|opacity-\d+|\d+|x|y|t|b|l|r|s|e|x-\d+|y-\d+|collapse|separate|hidden|wavy|from-font|clone|slice|underline|transparent|current)$/

// A Tailwind utility that sets a colour: named tokens (bg-accent, text-red-500)
// or arbitrary colour values (text-[#888]); not sizes, widths or alignment.
function isColorUtility(base) {
  const m = base.match(COLOR_PREFIX)
  if (!m) return false
  const v = m[2].split("/")[0]
  if (m[1] === "bg" && /^(gradient-|linear-|radial-|conic-|clip-|origin-|blend-|repeat|no-repeat|fixed|local|scroll|cover|contain|bottom|top|left|right|center)/.test(v)) return false
  if (m[1] === "text" && /^(opacity-|shadow-)/.test(v)) return false
  if (v.startsWith("[")) return /#|rgb|hsl|oklch|var\(--/.test(v)
  return !NOT_COLOR.test(v)
}

function addFont(map, raw, src) {
  const fam = raw.replace(/["']/g, "").replace(/var\(--[\w-]+\)/, "").trim()
  if (!fam || /^(inherit|initial|unset|sans-serif|serif|monospace|system-ui|ui-\w+|-apple-system|BlinkMacSystemFont)$/i.test(fam) || fam.length > 40) return
  if (!map.has(fam)) map.set(fam, new Set())
  map.get(fam).add(src)
}

function bump(map, k) {
  map.set(k, (map.get(k) ?? 0) + 1)
}

function top(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ×${v}`)
}

function components(files) {
  const comps = files.filter((f) => /(^|\/)components\//.test(f.rel) && /\.(tsx|jsx|vue|svelte|astro)$/.test(f.ext))
  const vendored = comps.filter((f) => f.rel.includes("components/ui/"))
  const own = comps.filter((f) => !f.rel.includes("components/ui/"))
  const appLocal = files.filter((f) => /^(?:src\/)?app\/.*components?\/.*\.(tsx|jsx)$/.test(f.rel) && !own.includes(f))
  const all = [...own, ...appLocal]
  return {
    count: all.length,
    vendoredUi: vendored.length,
    names: all.map((f) => basename(f.rel, extname(f.rel))).slice(0, 60),
  }
}

function productFacts(root, files, texts, pkg) {
  const facts = { name: pkg?.name ?? basename(root), description: pkg?.description ?? null }
  const readme = files.find((f) => /^readme\.md$/i.test(f.rel))
  if (readme) {
    const t = texts.get(readme.rel) ?? read(readme)
    const para = t.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith("#") && !p.startsWith("![") && !p.startsWith("[!") && p.length > 40)
    facts.readmeIntro = para?.slice(0, 600) ?? null
    facts.readmeIsBoilerplate = /bootstrapped with|create-next-app|This template provides|Expo app|getting started/i.test(t.slice(0, 800))
  }
  const meta = []
  for (const f of files) {
    if (!/(layout|_app|_document|index|head|root)\.(tsx|jsx|ts|js|html|astro|vue)$/.test(f.rel) && !/\.html$/.test(f.rel)) continue
    const t = texts.get(f.rel) ?? ""
    const title = t.match(/<title>([^<]{2,120})<\/title>/)?.[1] ?? t.match(/\btitle\s*:\s*["'`]([^"'`]{2,120})["'`]/)?.[1]
    const desc = t.match(/name=["']description["']\s+content=["']([^"']{10,300})/)?.[1] ?? t.match(/\bdescription\s*:\s*["'`]([^"'`]{10,300})["'`]/)?.[1]
    if (title || desc) meta.push({ file: f.rel, title: title ?? null, description: desc ?? null })
  }
  facts.metadata = meta.slice(0, 6)
  const appJson = join(root, "app.json")
  if (existsSync(appJson)) {
    try {
      const j = JSON.parse(readFileSync(appJson, "utf8"))
      facts.expo = { name: j.expo?.name, slug: j.expo?.slug, scheme: j.expo?.scheme, userInterfaceStyle: j.expo?.userInterfaceStyle }
    } catch {}
  }
  return facts
}

function safety(files, texts) {
  const findings = []
  for (const f of files) {
    if (!CONFIG_RE.test(f.rel.replace(/\\/g, "/")) && !/^scripts\//.test(f.rel)) continue
    const t = texts.get(f.rel) ?? read(f)
    const lines = t.split("\n")
    lines.forEach((line, i) => {
      if (line.length > 1000) findings.push({ file: f.rel, line: i + 1, issue: `line is ${line.length} characters long` })
      if (/ {120,}[^ ]/.test(line)) findings.push({ file: f.rel, line: i + 1, issue: "code hidden after a long run of spaces" })
      for (const re of WORM_MARKERS) if (re.test(line)) findings.push({ file: f.rel, line: i + 1, issue: `loader marker ${re}` })
    })
    if (/^\s*import\s*\{\s*createRequire\s*\}/.test(t.split("\n").slice(0, 3).join("\n")) && /config/.test(f.rel)) {
      findings.push({ file: f.rel, line: 1, issue: "createRequire(import.meta.url) at the top of a config (check whether it was prepended)" })
    }
  }
  return { scannedConfigs: files.filter((f) => CONFIG_RE.test(f.rel.replace(/\\/g, "/"))).length, findings }
}

// Every app inside the folder: package.json or pubspec.yaml roots, plus
// plain static sites (an index.html with no app root above it).
function findApps(root, files, texts) {
  const roots = new Map()
  for (const f of files) {
    const name = basename(f.rel)
    if (name === "package.json" || name === "pubspec.yaml") {
      const dir = dirname(f.rel) === "." ? "" : dirname(f.rel)
      if (dir.split("/").length <= 3) roots.set(dir, name === "pubspec.yaml" ? "flutter" : "node")
    }
  }
  for (const f of files) {
    if (basename(f.rel) !== "index.html") continue
    const dir = dirname(f.rel) === "." ? "" : dirname(f.rel)
    const covered = [...roots.keys()].some((r) => r === "" || dir === r || dir.startsWith(r + "/"))
    if (!covered && dir.split("/").length <= 2) roots.set(dir, "static")
  }
  const apps = []
  for (const [dir, kind] of roots) {
    const inApp = files
      .filter((f) => dir === "" || f.rel.startsWith(dir + "/"))
      .filter((f) => ![...roots.keys()].some((r) => r !== dir && r.startsWith(dir === "" ? "" : dir + "/") && r !== "" && f.rel.startsWith(r + "/")))
      .map((f) => ({ ...f, rel: dir ? f.rel.slice(dir.length + 1) : f.rel, fullRel: f.rel }))
    let stack, appRoutes
    if (kind === "flutter") {
      const pub = texts.get(dir ? dir + "/pubspec.yaml" : "pubspec.yaml") ?? ""
      const deps = [...pub.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1])
      stack = { primary: "Flutter", framework: ["Flutter"], styling: [], ui: deps.filter((d) => /flutter_screenutil|google_fonts|material|cupertino|shadcn|forui/.test(d)), motion: deps.filter((d) => /animat|lottie|rive/.test(d)), threeD: [], icons: deps.filter((d) => /icon/.test(d)), charts: deps.filter((d) => /chart/.test(d)) }
      appRoutes = inApp.filter((f) => /_(screen|page|view)\.dart$/.test(f.rel)).map((f) => ({ route: basename(f.rel, ".dart"), file: f.fullRel, kind: "flutter-screen" }))
    } else if (kind === "static") {
      stack = { primary: "Static site", framework: [], styling: [], ui: [], motion: [], threeD: [], icons: [], charts: [] }
      appRoutes = inApp.filter((f) => /\.html?$/.test(f.rel) && f.rel.split("/").length <= 2).map((f) => ({ route: "/" + f.rel.replace(/(^|\/)index\.html$/, ""), file: f.fullRel, kind: "static" }))
    } else {
      const pkg = pkgJson(join(root, dir))
      stack = detectLibs(pkg)
      appRoutes = routes(inApp).map((r) => ({ ...r, file: dir ? dir + "/" + r.file : r.file }))
      // Loose .html files are not routes in a framework app.
      if (appRoutes.some((r) => r.kind !== "static")) appRoutes = appRoutes.filter((r) => r.kind !== "static")
    }
    if (kind === "node" && !stack.framework.length && !appRoutes.length && dir === "" && roots.size > 1) continue // workspace root
    apps.push({ dir: dir || ".", kind, stack, routes: appRoutes })
  }
  return apps.sort((a, b) => b.routes.length - a.routes.length)
}

export function scan(root) {
  const files = walk(root)
  const texts = new Map()
  for (const f of files) texts.set(f.rel, read(f))
  const pkg = pkgJson(root)
  const apps = findApps(root, files, texts)
  const main = apps[0]
  const existing = ["PRODUCT.md", "DESIGN.md", ".impeccable/design.json", "components.json"].filter((p) => existsSync(join(root, p)))
  return {
    root,
    scannedFiles: files.length,
    apps: apps.map((a) => ({ dir: a.dir, kind: a.kind, primary: a.stack.primary, routes: a.routes.length })),
    stack: apps.length > 1 ? { ...main.stack, primary: `${apps.length} apps (largest: ${main.dir} ${main.stack.primary})` } : main?.stack ?? detectLibs(pkg),
    scripts: pkg?.scripts ?? {},
    routes: apps.length > 1 ? apps.flatMap((a) => a.routes) : main?.routes ?? [],
    existingDesignDocs: existing,
    tokens: tokenScan(files, texts),
    components: components(files),
    product: productFacts(root, files, texts, pkg),
    safety: safety(files, texts),
  }
}
