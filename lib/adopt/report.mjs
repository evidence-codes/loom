// Turns scan + census + captures into findings and a readable evidence report.
// Findings are signals for the agent and the user, never verdicts on taste.

export function findings(scan, census, captures) {
  const out = [] // { level: "stop" | "fix" | "note", text }
  const s = scan.safety
  for (const f of s.findings) out.push({ level: "stop", text: `Supply-chain marker in ${f.file}:${f.line}: ${f.issue}. Do not run this project until it is reviewed.` })

  if (scan.apps.length > 1) out.push({ level: "note", text: `${scan.apps.length} apps in this folder (${scan.apps.map((a) => `${a.dir}: ${a.primary}`).join("; ")}). Decide which one this adoption covers; each can get its own PRODUCT.md and DESIGN.md.` })
  if (!scan.apps.length) out.push({ level: "note", text: "No app root found (no package.json, pubspec.yaml or index.html)." })
  if (scan.existingDesignDocs.includes("PRODUCT.md")) out.push({ level: "note", text: "PRODUCT.md already exists: update it, do not replace it." })
  if (scan.existingDesignDocs.includes("DESIGN.md")) out.push({ level: "note", text: "DESIGN.md already exists: compare it with the evidence below and report drift instead of rewriting." })

  const t = scan.tokens
  for (const f of t.unusedStylesheets) out.push({ level: "fix", text: `${f} is not imported anywhere; its tokens are not live. Exclude it from the documented system or delete it.` })
  const solid = t.colors.filter((c) => c.hex.length === 7)
  if (solid.length > 24) out.push({ level: "fix", text: `${solid.length} distinct colour literals in source; the palette is not tokenised.` })
  for (const g of t.nearDuplicateColors.slice(0, 6)) out.push({ level: "fix", text: `Near-identical colours that probably mean one thing: ${g.join(", ")}` })
  for (const u of (t.unappliedFonts ?? []).filter((u) => u.scope)) out.push({ level: "fix", text: `${u.family}: ${u.variable} is set on <body> in ${u.file}, but a plain @theme block reads it at :root, where it is undefined; the font never applies. Put the variable class on <html> or use @theme inline.` })
  for (const u of (t.unappliedFonts ?? []).filter((u) => !u.scope)) out.push({ level: "fix", text: `${u.family} is loaded in ${u.file} as ${u.variable}, but nothing reads var(${u.variable}) or uses its className; it downloads and never applies. Text falls back to the default stack.` })
  const v4 = t.tailwind.v4
  if (v4?.configFilePresent && !v4.configLoaded) out.push({ level: "fix", text: `Tailwind v4 is in use but ${t.tailwind.config?.file ?? "tailwind.config"} is never loaded (no @config in the CSS). Its theme colours and fonts are dead; do not document them as the system.` })
  if (v4?.undefinedColorUtilities.length) out.push({ level: "fix", text: `Colour utilities that name no defined colour, so Tailwind generates no CSS for them: ${v4.undefinedColorUtilities.slice(0, 8).join(", ")}${v4.undefinedColorUtilities.length > 8 ? ", …" : ""}` })
  if (t.tailwind.arbitraryValues > 60) out.push({ level: "note", text: `${t.tailwind.arbitraryValues} arbitrary Tailwind values ([...]); much of the system lives outside the theme.` })
  if (t.inlineStyleColors > 5) out.push({ level: "fix", text: `${t.inlineStyleColors} inline style colours in components.` })
  if (scan.product.readmeIsBoilerplate || !scan.product.readmeIntro) out.push({ level: "note", text: "README does not describe the product; purpose and audience must come from the interview." })

  if (census?.error) out.push({ level: "fix", text: census.error })
  if (census && !census.error) {
    if (census.distinctTextStyles > 20) out.push({ level: "fix", text: `${census.distinctTextStyles} distinct text styles rendered; the type system is loose.` })
    const body = census.sizeScale.filter((s) => s.px >= 13 && s.px <= 20)
    if (body.length > 4) out.push({ level: "fix", text: `${body.length} body-range font sizes in use (${body.map((s) => s.px + "px").join(", ")}); a scale usually needs 2–3.` })
    for (const c of census.lowContrast.slice(0, 6)) out.push({ level: c.uncertain ? "note" : "fix", text: `Low contrast ${c.ratio}:1 (needs ${c.need}:1): ${c.pair}, e.g. "${c.sample}"${c.uncertain ? " (background is an image, gradient or canvas; verify by eye)" : ""}` })
    const radii = census.radii.length
    if (radii > 5) out.push({ level: "note", text: `${radii} distinct corner radii rendered.` })
  }

  for (const v of captures?.viewports ?? []) for (const w of v.warnings) if (/^page:|^check:/.test(w)) out.push({ level: /overflow|failed|error/.test(w) ? "fix" : "note", text: `${v.name} ${v.width}px: ${w.replace(/^(page|check): /, "")}` })
  return out
}

export function questions(scan, census) {
  const q = []
  if (!scan.existingDesignDocs.includes("PRODUCT.md")) {
    q.push("Who is the primary user, in what situation, and what job are they doing here?")
    q.push(scan.product.readmeIntro && !scan.product.readmeIsBoilerplate ? `Is this still accurate as the product's purpose: "${scan.product.readmeIntro.slice(0, 160)}…"?` : "What does the product do, and what makes it different from the obvious alternative?")
  }
  if (census?.error) census = null
  const palette = census?.palette.slice(0, 5).map((p) => p.color).join(", ") ?? scan.tokens.colors.slice(0, 5).map((c) => c.hex).join(", ")
  const fonts = (census?.families.map((f) => f.family) ?? scan.tokens.fonts.map((f) => f.family)).slice(0, 3).join(", ")
  q.push(`Which parts of the current look are deliberate brand and must stay (dominant colours ${palette}; type ${fonts || "system fonts"}), and which are accidents?`)
  q.push(`Which screens matter most? Found ${scan.routes.length} route(s)${scan.routes.length ? ": " + scan.routes.slice(0, 8).map((r) => r.route || "/").join(", ") : ""}.`)
  q.push("Is the goal to document and tighten the current design, or to replace it?")
  return q
}

const list = (arr, empty = "none found") => (arr?.length ? arr.map((x) => `- ${x}`).join("\n") : `- ${empty}`)

export function markdown({ scan, census, captures, found, asks }) {
  const st = scan.stack
  const t = scan.tokens
  const lines = []
  lines.push(`# Adopt report: ${scan.product.name}`)
  lines.push("")
  lines.push(`Scanned ${scan.scannedFiles} files at \`${scan.root}\` (read as text; nothing executed).${census?.error ? " The app failed to render at the given URL." : census ? " Rendered census and captures taken from the running app." : " No URL given: no rendered census or captures."}`)
  lines.push("")
  lines.push("## Findings")
  lines.push(found.length ? found.map((f) => `- **${f.level}**: ${f.text}`).join("\n") : "- none")
  lines.push("")
  lines.push("## Questions for the interview")
  lines.push(asks.map((a, i) => `${i + 1}. ${a}`).join("\n"))
  lines.push("")
  lines.push("## Stack")
  for (const [k, label] of [["framework", "Framework"], ["styling", "Styling"], ["ui", "UI kit"], ["motion", "Motion"], ["threeD", "3D"], ["icons", "Icons"], ["charts", "Charts"]]) if (st[k]?.length) lines.push(`- ${label}: ${st[k].join(", ")}`)
  if (scan.apps.length > 1) {
    lines.push(`- Apps in this folder (${scan.apps.length}); consider adopting each separately:`)
    for (const a of scan.apps) lines.push(`  - \`${a.dir}\`: ${a.primary}, ${a.routes} route(s)/screen(s)`)
  }
  lines.push(`- Routes (${scan.routes.length}): ${scan.routes.slice(0, 20).map((r) => `\`${r.route || "/"}\``).join(", ") || "none detected"}`)
  lines.push(`- Components: ${scan.components.count} own${scan.components.vendoredUi ? `, ${scan.components.vendoredUi} vendored UI primitives` : ""}${scan.components.names.length ? ` (${scan.components.names.slice(0, 24).join(", ")})` : ""}`)
  lines.push(`- Existing design docs: ${scan.existingDesignDocs.join(", ") || "none"}`)
  lines.push("")
  lines.push("## What it says about itself")
  const p = scan.product
  lines.push(`- Package: ${p.name}${p.description ? ` — ${p.description}` : ""}`)
  for (const m of p.metadata) lines.push(`- ${m.file}: ${m.title ? `title "${m.title}"` : ""}${m.description ? ` · description "${m.description}"` : ""}`)
  if (p.expo) lines.push(`- Expo app: ${JSON.stringify(p.expo)}`)
  lines.push(`- README: ${p.readmeIntro ? (p.readmeIsBoilerplate ? "(boilerplate) " : "") + p.readmeIntro.replace(/\n/g, " ") : "none"}`)
  lines.push("")
  lines.push("## Design system in source")
  lines.push("### Colour")
  lines.push(list(t.colors.slice(0, 16).map((c) => `\`${c.hex}\` ×${c.count} in ${c.files} file(s)`)))
  const vars = t.cssVars.filter((v) => !t.unusedStylesheets.includes(v.file))
  lines.push(`\nCSS custom properties (${vars.length} live${t.unusedStylesheets.length ? `, plus ${t.cssVars.length - vars.length} in unused stylesheets` : ""}):`)
  lines.push(list(vars.slice(0, 30).map((v) => `\`${v.name}: ${v.value}\` (${v.selector}, ${v.file})`)))
  if (t.tailwind.config) {
    lines.push(`\nTailwind theme (${t.tailwind.config.file}, read as text): colour keys ${t.tailwind.config.colorKeys.join(", ") || "none"}; fonts ${t.tailwind.config.fontFamily.join("; ") || "default"}.`)
    lines.push(`\nMost used colour utilities:`)
    lines.push(list(t.tailwind.topColorUtilities.slice(0, 16)))
  }
  lines.push("\n### Type")
  lines.push(list(t.fonts.map((f) => `${f.family} (${f.sources.join("; ")})`)))
  if (t.tailwind.textSizes.length) lines.push(`\nText size utilities: ${t.tailwind.textSizes.join(", ")}`)
  lines.push("\n### Shape")
  lines.push(`- Radius utilities: ${t.tailwind.radius.join(", ") || "none"}`)
  lines.push(`- Shadow utilities: ${t.tailwind.shadow.join(", ") || "none"}`)
  if (census?.error) {
    lines.push("")
    lines.push(`## Design system as rendered\n\n${census.error}`)
  } else if (census) {
    lines.push("")
    lines.push("## Design system as rendered (desktop, reduced motion)")
    lines.push(`Page background ${census.pageBackground}. ${census.distinctBackgrounds} distinct backgrounds, ${census.distinctTextStyles} distinct text styles.`)
    lines.push("\n### Palette by painted area")
    lines.push(list(census.palette.map((c) => `\`${c.color}\` ${c.share}%`)))
    lines.push("\n### Type as used")
    lines.push(list(census.families.map((f) => `${f.family} ${f.share}% of text`)))
    lines.push(`\nSize scale (px: characters): ${census.sizeScale.map((s) => `${s.px}: ${s.chars}`).join(", ")}`)
    lines.push("\nTop text styles:")
    lines.push(list(census.typeStyles.map((s) => `${s.style} (${s.chars} chars) "${s.sample}"`)))
    lines.push("\n### Shape and depth")
    lines.push(`- Radii: ${census.radii.join(", ") || "none"}`)
    lines.push(`- Shadows: ${census.shadows.join(" | ") || "none"}`)
    lines.push(`- Borders: ${census.borders.join(", ") || "none"}`)
    lines.push("\n### Contrast")
    lines.push(list(census.lowContrast.map((c) => `${c.ratio}:1 (needs ${c.need}) ${c.pair}${c.uncertain ? " (uncertain background)" : ""}: "${c.sample}"`), "no text below WCAG AA against its resolved background"))
  }
  if (captures) {
    lines.push("")
    lines.push("## Captures")
    for (const v of captures.viewports) {
      lines.push(`- ${v.name} ${v.width}x${v.height} (${v.valid ? "valid" : "INVALID"}): ${[v.files.first, ...(v.files.full ?? [])].filter(Boolean).map((f) => `\`${f}\``).join(", ")}`)
    }
  }
  lines.push("")
  lines.push("## Safety")
  lines.push(`Scanned ${scan.safety.scannedConfigs} config/script files for known npm-worm loader markers and for lines over 1,000 characters: ${scan.safety.findings.length ? `${scan.safety.findings.length} finding(s), see Findings.` : "clean."}`)
  return lines.join("\n") + "\n"
}
