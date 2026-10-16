// loom report: one readable page from a project's evidence, for people who
// will never open a terminal. Writes <dir>/.design/report/index.html plus the
// screenshots it shows, ready to open locally or publish as a link.

import { existsSync, readFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs"
import { join, basename, resolve } from "node:path"
import { writeAtomic } from "./learn/ledger.mjs"
import { runChecks } from "./learn/rules.mjs"
import { detect } from "./adapters/index.mjs"

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return null
  }
}

// Newest capture manifest among the places loom and impeccable write them.
function latestCaptures(root) {
  const dirs = [".design/preview", ".impeccable/review", ".design/adopt/captures"].map((d) => join(root, d))
  const found = []
  for (const d of dirs) {
    if (!existsSync(d)) continue
    for (const f of readdirSync(d)) if (/manifest\.json$/.test(f) && !/^privacy-/.test(f)) found.push(join(d, f))
  }
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return found[0] ? { file: found[0], data: readJson(found[0]) } : null
}

// First paragraph after a heading in a markdown file, as plain text.
function section(md, heading) {
  const m = md.match(new RegExp(`##\\s+${heading}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s|$)`, "i"))
  if (!m) return ""
  const block = m[1].trim().split(/\n\s*\n/)[0]
  // Bullet lists read as one sentence per bullet.
  return block
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/[*_`>]/g, "")
    .trim()
}

export function report(dir) {
  const root = resolve(dir)
  const out = join(root, ".design/report")
  mkdirSync(join(out, "img"), { recursive: true })

  const adopt = readJson(join(root, ".design/adopt/adopt.json"))
  const caps = latestCaptures(root)
  const product = existsSync(join(root, "PRODUCT.md")) ? readFileSync(join(root, "PRODUCT.md"), "utf8") : ""
  const reviewMd = existsSync(join(root, ".design/review.md")) ? readFileSync(join(root, ".design/review.md"), "utf8") : ""
  const checks = runChecks(root)
  const { adapter } = detect(root)
  const name = adopt?.scan?.product?.metadata?.[0]?.title ?? adopt?.scan?.product?.name ?? basename(root)

  // Screenshots: copy the first viewports and full pages next to the page.
  const shots = []
  for (const v of caps?.data?.viewports ?? []) {
    for (const [kind, f] of [["first", v.files.first], ["full", v.files.full?.[0]]]) {
      if (!f || !existsSync(f)) continue
      const target = `img/${v.name}-${kind}.png`
      copyFileSync(f, join(out, target))
      shots.push({ viewport: v.name, width: v.width, kind, src: target, valid: v.valid })
    }
  }

  const findings = adopt?.findings ?? []
  const verdict = reviewMd.match(/disposition:\s*(ship|fix|rebuild|recapture)/i)?.[1]?.toLowerCase()
  const capWarnings = (caps?.data?.viewports ?? []).flatMap((v) => v.warnings.map((w) => ({ v: v.name, w: w.split("\n")[0] })))
  const counts = { stop: 0, fix: 0, note: 0 }
  for (const f of findings) counts[f.level] = (counts[f.level] ?? 0) + 1
  const when = (p) => (p && existsSync(p) ? new Date(statSync(p).mtimeMs).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null)
  const sources = [
    ["Design scan", when(join(root, ".design/adopt/adopt.json"))],
    ["Screenshots", when(caps?.file)],
    ["Review", when(join(root, ".design/review.md"))],
  ].filter(([, t]) => t)
  const purpose = section(product, "Product Purpose")
  const users = section(product, "Users")

  const status = counts.stop
    ? { tone: "stop", text: "Stopped for safety: suspicious code was found. Nothing should run until it's reviewed." }
    : verdict === "ship"
      ? { tone: "good", text: "The independent design review passed this version." }
      : verdict
        ? { tone: "warn", text: `The independent design review asked for changes (${verdict}).` }
        : counts.fix || checks.hits.length
          ? { tone: "warn", text: `${counts.fix + checks.hits.length} thing(s) to fix, listed below.` }
          : { tone: "good", text: "No problems found in the checks that ran." }

  const shotHtml = ["desktop", "tablet", "mobile"]
    .map((vp) => {
      const first = shots.find((s) => s.viewport === vp && s.kind === "first")
      const full = shots.find((s) => s.viewport === vp && s.kind === "full")
      if (!first) return ""
      return `<figure class="shot ${vp}"><a href="${full?.src ?? first.src}" target="_blank" rel="noopener"><img src="${first.src}" alt="${esc(name)} on ${vp}, first screen" loading="lazy"></a><figcaption>${vp === "desktop" ? "Laptop" : vp === "mobile" ? "Phone" : "Tablet"} · ${first.width}px wide${full ? ` · <a href="${full.src}" target="_blank" rel="noopener">whole page</a>` : ""}${first.valid ? "" : " · <strong>screenshot not reliable</strong>"}</figcaption></figure>`
    })
    .join("")

  const li = (items) => items.map((x) => `<li>${x}</li>`).join("")
  const findingItems = findings.filter((f) => f.level !== "note").map((f) => `<span class="pill ${f.level}">${f.level === "stop" ? "Stop" : "Fix"}</span> ${esc(f.text)}`)
  const noteItems = findings.filter((f) => f.level === "note").map((f) => esc(f.text))
  const checkItems = checks.hits.map((h) => `<span class="pill fix">Rule</span> ${esc(h.message)} <span class="where">${esc(h.file)}</span>`)
  const pageItems = capWarnings.filter((c) => /^page:|^check:/.test(c.w)).map((c) => `<span class="where">${esc(c.v)}</span> ${esc(c.w.replace(/^(page|check): /, ""))}`)

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)} design report</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#16181d;--soft:#4a4f5a;--mute:#767b86;--line:#e3e1dc;--good:#1f7a4d;--warn:#9a5b00;--stop:#b3261e;--accent:#2f4fd8}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121317;--card:#1b1d23;--ink:#eceef3;--soft:#b6bac6;--mute:#8a8f9c;--line:#2c2f38;--good:#5cc793;--warn:#e8a94a;--stop:#ff8a80;--accent:#8fa4ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:40px 16px 80px}
h1{font-size:clamp(28px,4vw,40px);line-height:1.1;margin:0 0 8px;letter-spacing:-.02em}h2{font-size:20px;margin:48px 0 14px}
.meta{color:var(--mute);font-size:14px}.status{margin:28px 0;padding:18px 20px;border-radius:12px;background:var(--card);border:1px solid var(--line);border-left:6px solid var(--good);font-size:18px}
.status.warn{border-left-color:var(--warn)}.status.stop{border-left-color:var(--stop)}
.shots{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,1fr);gap:20px;align-items:start}
@media (max-width:720px){.shots{grid-template-columns:1fr}}
.shot{margin:0}.shot img{display:block;width:100%;height:auto;border-radius:10px;border:1px solid var(--line);background:var(--card)}
.shot figcaption{font-size:14px;color:var(--mute);margin-top:8px}a{color:var(--accent)}
ul{padding-left:0;list-style:none;margin:0}li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:8px}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;margin-right:6px;background:var(--line);color:var(--ink)}
.pill.stop{background:var(--stop);color:#fff}.pill.fix{background:var(--warn);color:#fff}.where{color:var(--mute);font-size:13px;margin-left:4px}
.about p{margin:0 0 10px;color:var(--soft);max-width:70ch}dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;margin:0}dt{color:var(--mute)}dd{margin:0}
pre{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;font-size:13px;line-height:1.5;overflow:auto}
</style></head><body><main>
<h1>${esc(name)}</h1>
<p class="meta">Design report · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}${adapter ? ` · ${esc(adapter.name)}` : ""}</p>
<div class="status ${status.tone}">${esc(status.text)}</div>
${sources.length ? `<p class="meta">Evidence: ${sources.map(([k, t]) => `${k} ${esc(t)}`).join(" · ")}. Older evidence may describe an earlier version.</p>` : ""}
${purpose || users ? `<section class="about"><h2>What this site is for</h2>${purpose ? `<p>${esc(purpose)}</p>` : ""}${users ? `<p><strong>Who it's for:</strong> ${esc(users)}</p>` : ""}</section>` : ""}
${shotHtml ? `<h2>How it looks</h2><div class="shots">${shotHtml}</div>` : ""}
${findingItems.length || checkItems.length ? `<h2>What to fix</h2><ul>${li([...findingItems, ...checkItems])}</ul>` : ""}
${pageItems.length ? `<h2>Found while taking screenshots</h2><ul>${li(pageItems)}</ul>` : ""}
${noteItems.length ? `<h2>Good to know</h2><ul>${li(noteItems)}</ul>` : ""}
${adopt?.questions?.length ? `<h2>Questions to answer</h2><ul>${li(adopt.questions.map(esc))}</ul>` : ""}
${reviewMd ? `<h2>Independent review</h2><pre>${esc(reviewMd.slice(0, 6000))}</pre>` : ""}
${adopt ? `<h2>Built with</h2><dl>${[["Framework", adopt.scan.stack.framework], ["Styling", adopt.scan.stack.styling], ["Motion", adopt.scan.stack.motion], ["Fonts", adopt.scan.tokens.fonts.map((f) => f.family)]].filter(([, v]) => v?.length).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v.join(", "))}</dd>`).join("")}</dl>` : ""}
</main></body></html>`

  writeAtomic(join(out, "index.html"), html)
  return { out, page: join(out, "index.html"), images: shots.map((s) => join(out, s.src)), status }
}
