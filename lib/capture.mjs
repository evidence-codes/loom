// Design captures that hold up as review evidence.
//
// What this handles that a plain screenshot does not:
// - true device widths (390 really is 390; desktop Chrome windows cannot go that narrow)
// - viewport-height heroes: full pages are captured as viewport slices and
//   stitched, so a 100vh hero is not stretched to the page height
// - fixed and sticky chrome appears once, at the top, not on every slice
// - reduced motion as the default still record, so nothing is caught mid-tween
// - WebGL rendered through SwiftShader
// - dev overlays (Next.js badge, Vite overlay) hidden
// - validity checks: blank bands, broken images, failed fonts, console errors,
//   failed requests, horizontal overflow, recorded in a manifest

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { launchChrome } from "./cdp.mjs"
import { pageChecks, hideFixedChrome, scanFixed } from "./page-scripts.mjs"
import { decode, encode, stackAt, uniformBand } from "./png.mjs"

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

const DEV_OVERLAYS = ["nextjs-portal", "[data-nextjs-toast]", "#__next-build-watcher", "vite-error-overlay", "[data-astro-dev-toolbar]", "astro-dev-toolbar"]

// Chrome caps canvas edges at 32767px; stay under it per stitched part.
const MAX_PART_PX = 32000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let progress = () => {}

export function viewportName(w) {
  return w >= 1024 ? "desktop" : w >= 768 ? "tablet" : "mobile"
}

export function parseViewports(spec) {
  return spec.split(",").map((s) => {
    const m = s.trim().match(/^(\d+)x(\d+)(?:@(\d+(?:\.\d+)?))?$/)
    if (!m) throw new Error(`Bad viewport "${s}". Use WIDTHxHEIGHT or WIDTHxHEIGHT@DPR, e.g. 390x844@2`)
    const width = +m[1]
    return { width, height: +m[2], dpr: m[3] ? +m[3] : 1, name: viewportName(width) }
  })
}

// Requests open longer than this are treated as long-lived (dev-server
// event streams, analytics beacons, polling) and do not block idleness.
const LONG_LIVED_MS = 3000

function busy(inflight) {
  const now = Date.now()
  for (const r of inflight.values()) if (now - r.start < LONG_LIVED_MS) return true
  return false
}

async function waitForNetworkIdle(page, inflight, { idleMs = 500, timeoutMs = 10000 } = {}) {
  const start = Date.now()
  let quietSince = 0
  while (Date.now() - start < timeoutMs) {
    if (!busy(inflight)) {
      if (!quietSince) quietSince = Date.now()
      if (Date.now() - quietSince >= idleMs) return true
    } else quietSince = 0
    await sleep(100)
  }
  return false
}

export async function openViewport(browser, vp, opts) {
  const page = await browser.newPage()
  const log = { consoleErrors: [], failedRequests: [], notes: [] }
  const inflight = new Map() // requestId -> { start, url }

  await Promise.all([
    page.send("Page.enable"),
    page.send("Network.enable"),
    page.send("Runtime.enable"),
  ])
  page.on("Network.requestWillBeSent", (p) => {
    if (p.type !== "EventSource" && p.type !== "WebSocket") inflight.set(p.requestId, { start: Date.now(), url: p.request.url })
  })
  page.on("Network.loadingFinished", (p) => inflight.delete(p.requestId))
  page.on("Network.loadingFailed", (p) => {
    inflight.delete(p.requestId)
    if (!p.canceled) log.failedRequests.push({ error: p.errorText, type: p.type })
  })
  page.on("Network.responseReceived", (p) => {
    if (p.type === "Document" && log.documentStatus === undefined) log.documentStatus = p.response.status
    if (p.response.status >= 400) log.failedRequests.push({ url: p.response.url, status: p.response.status })
  })
  page.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") log.consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300))
  })
  page.on("Runtime.exceptionThrown", (p) => {
    log.consoleErrors.push((p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300))
  })

  const mobile = vp.width < 768
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: vp.dpr,
    mobile,
  })
  if (mobile) {
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 })
    await page.send("Emulation.setUserAgentOverride", { userAgent: MOBILE_UA })
  }
  await page.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-motion", value: opts.reducedMotion ? "reduce" : "no-preference" },
      { name: "prefers-color-scheme", value: opts.colorScheme },
    ],
  })

  // Ready = DOM parsed, then the load event or network idle, whichever is
  // first. One slow asset should not stall the capture; it is reported.
  const domReady = page.once("Page.domContentEventFired", opts.timeoutMs)
  const loaded = page.once("Page.loadEventFired", opts.timeoutMs)
  let loadFired = false
  loaded.then(() => (loadFired = true), () => {})
  const nav = await page.send("Page.navigate", { url: opts.url })
  if (nav.errorText) throw new Error(`Navigation failed: ${nav.errorText}`)
  await domReady
  await Promise.race([loaded.catch(() => {}), waitForNetworkIdle(page, inflight, { idleMs: 800, timeoutMs: opts.timeoutMs })])
  if (!loadFired) {
    const stuck = [...inflight.values()].map((r) => r.url.slice(0, 120))
    log.notes.push(`load event had not fired when captured; still loading: ${stuck.slice(0, 4).join(", ") || "nothing on the network"}`)
  }
  // fonts.ready waits for the whole document in Chrome; cap it and report.
  const fonts = await page.eval(`Promise.race([document.fonts.ready.then(() => 'loaded'), new Promise((r) => setTimeout(() => r(document.fonts.status), 5000))])`)
  if (fonts !== "loaded") log.notes.push(`fonts still ${fonts} after 5s`)

  const css = [
    DEV_OVERLAYS.join(",") + "{display:none!important}",
    opts.hide.length ? opts.hide.join(",") + "{visibility:hidden!important}" : "",
    opts.css ?? "",
  ].join("\n")
  await page.eval(`(() => { const s = document.createElement('style'); s.dataset.loom = ''; s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); return true })()`)

  if (opts.waitFor) {
    await page.eval(`new Promise((res, rej) => { const t = Date.now(); (function poll(){ if (document.querySelector(${JSON.stringify(opts.waitFor)})) return res(true); if (Date.now() - t > ${opts.timeoutMs}) return rej(new Error('wait-for selector not found')); setTimeout(poll, 100) })() })`)
  }
  await sleep(opts.settleMs)
  await page.eval(SETTLE_ANIMATIONS)
  return { page, log, inflight }
}

// Wait for finite running animations (Web Animations API: CSS transitions and
// animations, Framer Motion, Motion One) to finish. Infinite loops are ignored.
const SETTLE_ANIMATIONS = `new Promise((resolve) => {
  const t0 = performance.now()
  const busy = () => document.getAnimations().some((a) => a.playState === 'running' && isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))
  ;(function poll() { if (!busy() || performance.now() - t0 > 4000) return resolve(true); requestAnimationFrame(poll) })()
})`

// A viewport that is almost entirely one colour usually means a JS-driven
// reveal (GSAP, rAF loops) hasn't finished: those don't show up in
// document.getAnimations(). Wait once and shoot again before trusting it.
async function settledShot(page, vp, waitMs = 2500) {
  let data = await screenshot(page)
  const band = uniformBand(decode(Buffer.from(data, "base64"))).longestUniformBand / vp.dpr
  if (band >= vp.height * 0.6) {
    progress("mostly blank frame; waiting for scripted reveals")
    await sleep(waitMs)
    data = await screenshot(page)
  }
  return data
}

async function screenshot(page) {
  const { data } = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })
  return data
}

async function scrollTo(page, y) {
  return page.eval(`(() => { window.scrollTo({ top: ${y}, left: 0, behavior: 'instant' }); return Math.round(window.scrollY) })()`)
}

async function captureFull(page, inflight, vp, opts) {
  const slices = []
  let height = await page.eval("Math.ceil(document.scrollingElement.scrollHeight)")
  let y = 0
  let first = true
  // Walk the page one viewport at a time; re-measure as lazy content grows.
  let last = -1
  let largeFixed = 0
  let chromeHidden = 0
  for (let guard = 0; guard < 400; guard++) {
    const actual = await scrollTo(page, y)
    if (actual <= last) {
      // Scrolling stopped short of scrollHeight (zoomed-out mobile layouts,
      // overflow:hidden roots). What can be scrolled to is the page.
      height = last + vp.height
      break
    }
    last = actual
    await sleep(opts.sliceSettleMs)
    await waitForNetworkIdle(page, inflight, { idleMs: 250, timeoutMs: 4000 })
    await page.eval(SETTLE_ANIMATIONS)
    largeFixed = Math.max(largeFixed, (await page.eval(scanFixed)).large)
    slices.push({ y: actual, data: await settledShot(page, vp) })
    progress(`slice ${slices.length} at ${actual}px`)
    if (first && !opts.keepFixed) {
      // From here on, fixed/sticky chrome would repeat on every slice.
      chromeHidden = (await page.eval(hideFixedChrome)).hidden
      first = false
    }
    height = Math.max(height, await page.eval("Math.ceil(document.scrollingElement.scrollHeight)"))
    if (actual + vp.height >= height) break
    y = Math.min(actual + vp.height, height - vp.height)
  }
  await scrollTo(page, 0)
  return { height, slices, scrollDriven: largeFixed > 0, chromeHidden }
}

// Stitch slices in Node: decode each slice and paste it at its real scroll
// offset (later slices win overlaps), split into parts under the PNG/canvas
// height most viewers handle.
function stitch(slices, vp, height) {
  const imgs = slices.map((s) => ({ y: s.y, img: decode(Buffer.from(s.data, "base64")) }))
  const w = imgs[0].img.width
  const totalPx = Math.round(height * vp.dpr)
  const parts = []
  for (let top = 0; top < totalPx; top += MAX_PART_PX) {
    const h = Math.min(MAX_PART_PX, totalPx - top)
    const pieces = imgs.map(({ y, img }) => ({ img, y: Math.round(y * vp.dpr) - top }))
    parts.push(stackAt(w, h, pieces))
  }
  return parts
}

function analyze(img, vp) {
  const b = uniformBand(img)
  return { width: img.width, height: img.height, longestUniformBand: Math.round(b.longestUniformBand / vp.dpr), bandColor: b.bandColor }
}

export async function capture(opts) {
  const outDir = opts.out
  mkdirSync(outDir, { recursive: true })
  const t0 = Date.now()
  progress = opts.quiet ? () => {} : (msg) => process.stderr.write(`  · ${((Date.now() - t0) / 1000).toFixed(1)}s ${msg}\n`)
  const browser = await launchChrome({ headless: !opts.headed, renderer: opts.renderer })
  // An interrupted run still closes Chrome and removes its temp profile.
  const abort = (sig) => browser.close().finally(() => process.exit(sig === "SIGINT" ? 130 : 143))
  process.once("SIGINT", abort)
  process.once("SIGTERM", abort)
  const manifest = {
    tool: "loom capture",
    version: "0.1.0",
    url: opts.url,
    capturedAt: new Date().toISOString(),
    motion: opts.motion,
    renderer: opts.renderer,
    viewports: [],
  }
  const prefix = opts.name ? `${opts.name}-` : ""

  try {
    for (const vp of opts.viewports) {
      const tag = `${prefix}${vp.name}-${vp.width}x${vp.height}${vp.dpr !== 1 ? `@${vp.dpr}` : ""}`
      const entry = { ...vp, files: {}, warnings: [], valid: true }

      progress(`${tag}: loading`)
      // Still record: reduced motion, every reveal at its final state.
      const still = await openViewport(browser, vp, { ...opts, reducedMotion: opts.motion !== "full" })
      progress(`${tag}: loaded`)
      entry.checks = await still.page.eval(`(${pageChecks})(${vp.width})`)
      entry.log = still.log

      if (opts.first) {
        const data = await settledShot(still.page, vp)
        const file = join(outDir, `${tag}-first.png`)
        writeFileSync(file, Buffer.from(data, "base64"))
        entry.files.first = file
        entry.firstAnalysis = analyze(decode(Buffer.from(data, "base64")), vp)
      }

      if (opts.full) {
        progress(`${tag}: full page`)
        const { height, slices, scrollDriven, chromeHidden } = await captureFull(still.page, still.inflight, vp, opts)
        entry.scrollDriven = scrollDriven
        entry.fixedChromeHidden = chromeHidden
        if (scrollDriven || opts.frames) {
          // Pinned or fixed scenes change in place as you scroll; a stitched
          // strip cannot show that, so keep every frame as well.
          const dir = join(outDir, `${tag}-frames`)
          mkdirSync(dir, { recursive: true })
          entry.files.frames = slices.map((sl, i) => {
            const file = join(dir, `${String(i + 1).padStart(2, "0")}-${sl.y}px.png`)
            writeFileSync(file, Buffer.from(sl.data, "base64"))
            return file
          })
        }
        progress(`${tag}: stitching ${slices.length} slices`)
        const parts = stitch(slices, vp, height)
        entry.pageHeight = height
        entry.slices = slices.length
        entry.files.full = parts.map((img, i) => {
          const file = join(outDir, `${tag}-full${parts.length > 1 ? `-${i + 1}` : ""}.png`)
          writeFileSync(file, encode(img))
          return file
        })
        entry.fullAnalysis = parts.map((img) => analyze(img, vp))
        progress(`${tag}: written`)
      }
      await still.page.close()

      // Motion record: the first viewport with motion on, after it settles.
      if (opts.motion === "both" && opts.first) {
        const live = await openViewport(browser, vp, { ...opts, reducedMotion: false, settleMs: opts.motionSettleMs })
        const data = await screenshot(live.page)
        const file = join(outDir, `${tag}-motion-first.png`)
        writeFileSync(file, Buffer.from(data, "base64"))
        entry.files.motionFirst = file
        await live.page.close()
      }

      judge(entry, vp)
      manifest.viewports.push(entry)
    }
  } finally {
    process.off("SIGINT", abort)
    process.off("SIGTERM", abort)
    await browser.close()
  }

  manifest.valid = manifest.viewports.every((v) => v.valid)
  const manifestFile = join(outDir, `${prefix}manifest.json`)
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2))
  manifest.file = manifestFile
  return manifest
}

// Two kinds of result: capture validity (is this evidence?) and page findings
// (is the page right?). Only the first makes a capture invalid.
function judge(entry, vp) {
  const w = entry.warnings
  const c = entry.checks
  if (entry.log.documentStatus >= 400) {
    entry.valid = false
    w.push(`capture: the page itself returned HTTP ${entry.log.documentStatus}; these images show an error page, not the design`)
  }
  const bands = [entry.firstAnalysis, ...(entry.fullAnalysis ?? [])].filter(Boolean)
  if (entry.firstAnalysis && entry.firstAnalysis.longestUniformBand >= vp.height * 0.9) {
    entry.valid = false
    w.push(`capture: the first screen is ${entry.firstAnalysis.longestUniformBand}px of one colour (${entry.firstAnalysis.bandColor}); content never appeared`)
  }
  for (const a of bands) {
    if (a.longestUniformBand >= vp.height && !entry.scrollDriven) {
      entry.valid = false
      w.push(`capture: a ${a.longestUniformBand}px band of one colour (${a.bandColor}), taller than the viewport; likely blank or unrendered`)
    } else if (a.longestUniformBand >= vp.height * 0.5) {
      w.push(`check: a ${a.longestUniformBand}px band of one colour (${a.bandColor}); confirm it is intended whitespace`)
    }
  }
  if (c.brokenImages.length) w.push(`page: ${c.brokenImages.length} image(s) failed to load: ${c.brokenImages.slice(0, 3).join(", ")}`)
  if (c.pendingImages.length) {
    entry.valid = false
    w.push(`capture: ${c.pendingImages.length} image(s) still loading when captured`)
  }
  if (c.fontsFailed.length) w.push(`page: font(s) failed: ${c.fontsFailed.join(", ")}`)
  if (c.overflowX) w.push(`page: horizontal overflow, content is ${c.scrollWidth}px wide at a ${vp.width}px viewport${c.zoomedOut ? " (the mobile browser zooms the page out to fit)" : ""}; widest: ${c.overflowers.join(" | ")}`)
  if (entry.log.consoleErrors.length) w.push(`page: ${entry.log.consoleErrors.length} console error(s); first: ${entry.log.consoleErrors[0]}`)
  for (const n of entry.log.notes) w.push(`capture: ${n}`)
  if (entry.scrollDriven) w.push(`check: page has large fixed or pinned scenes; the stitched full page cannot show scroll choreography, review the ${entry.files.frames?.length ?? 0} frames too`)
  if (entry.log.failedRequests.length) w.push(`page: ${entry.log.failedRequests.length} failed request(s)`)
  if (c.canvases && !c.webgl) w.push("capture: page has canvases but WebGL is unavailable in this browser; 3D may render as fallback")
}
