// Rendered census: the design system as the browser actually paints it,
// independent of how the source spells it. Colours weighted by painted area,
// type as used on real text, radii, shadows, and text contrast against the
// resolved background.

import { launchChrome } from "../cdp.mjs"
import { openViewport } from "../capture.mjs"

const CENSUS = `(() => {
  // Any CSS colour (rgb, hex, lab, oklch, color-mix…) to sRGB by letting the
  // browser paint it: Tailwind v4 emits lab()/oklch(), which no regex covers.
  const probe = document.createElement('canvas'); probe.width = probe.height = 1
  const pctx = probe.getContext('2d', { willReadFrequently: true })
  const colorCache = new Map()
  const rgba = (s) => {
    if (!s || s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return [0, 0, 0, 0]
    if (colorCache.has(s)) return colorCache.get(s)
    pctx.clearRect(0, 0, 1, 1); pctx.fillStyle = '#000'; pctx.fillStyle = s; pctx.fillRect(0, 0, 1, 1)
    const d = pctx.getImageData(0, 0, 1, 1).data
    const v = [d[0], d[1], d[2], Math.round(d[3] / 255 * 100) / 100]
    colorCache.set(s, v)
    return v
  }
  const hex = ([r, g, b]) => '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1) }
  const pageBg = rgba(getComputedStyle(document.body).backgroundColor)?.[3] ? rgba(getComputedStyle(document.body).backgroundColor) : (rgba(getComputedStyle(document.documentElement).backgroundColor)?.[3] ? rgba(getComputedStyle(document.documentElement).backgroundColor) : [255, 255, 255, 1])

  // Solid background behind an element, compositing translucent layers.
  // Uncertain when an image, gradient or canvas sits between.
  const canvases = [...document.querySelectorAll('canvas')].map((c) => c.getBoundingClientRect()).filter((a) => a.width > 200 && a.height > 150)
  const bgOf = (el) => {
    const layers = []
    let uncertain = false
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage !== 'none') uncertain = true
      const c = rgba(cs.backgroundColor)
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.99) break }
    }
    let base = pageBg
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base)
    const b = el.getBoundingClientRect()
    const nearCanvas = canvases.some((a) => b.left < a.right && b.right > a.left && b.top < a.bottom && b.bottom > a.top)
    return { color: base, uncertain: uncertain || nearCanvas }
  }

  const area = new Map(), radii = new Map(), shadows = new Map(), borders = new Map()
  const type = new Map(), families = new Map(), sizes = new Map()
  const lowContrast = new Map()
  const docW = document.documentElement.clientWidth
  let textChars = 0

  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const bg = rgba(cs.backgroundColor)
    if (bg && bg[3] > 0.05) {
      const w = Math.max(0, Math.min(r.right, docW) - Math.max(r.left, 0))
      const k = hex(bg) + (bg[3] < 0.99 ? ' @' + bg[3].toFixed(2) : '')
      area.set(k, (area.get(k) ?? 0) + w * r.height)
    }
    if (cs.borderRadius !== '0px') { const k = cs.borderRadius.replace(/[\d.]+e\+\d+px|\b\d{5,}px/g, 'full'); radii.set(k, (radii.get(k) ?? 0) + 1) }
    if (cs.boxShadow !== 'none') shadows.set(cs.boxShadow.slice(0, 90), (shadows.get(cs.boxShadow.slice(0, 90)) ?? 0) + 1)
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') { const b = rgba(cs.borderTopColor); if (b) { const k = cs.borderTopStyle + ' ' + cs.borderTopWidth + ' ' + hex(b) + (b[3] < 1 ? ' @' + b[3].toFixed(2) : ''); borders.set(k, (borders.get(k) ?? 0) + 1) } }

    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\\s+/g, ' ').trim()
    if (!own) continue
    const chars = own.length
    textChars += chars
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim()
    const size = Math.round(parseFloat(cs.fontSize) * 10) / 10
    const weight = cs.fontWeight
    families.set(fam, (families.get(fam) ?? 0) + chars)
    sizes.set(size, (sizes.get(size) ?? 0) + chars)
    const tk = fam + ' ' + size + 'px/' + (cs.lineHeight === 'normal' ? 'normal' : Math.round(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) * 100) / 100) + ' w' + weight + (cs.letterSpacing !== 'normal' ? ' ls ' + cs.letterSpacing : '') + (cs.textTransform !== 'none' ? ' ' + cs.textTransform : '')
    const t = type.get(tk) ?? { chars: 0, sample: own.slice(0, 50) }
    t.chars += chars
    type.set(tk, t)

    const fg = rgba(cs.color)
    if (!fg) continue
    const { color: under, uncertain } = bgOf(el)
    const fgSolid = fg[3] < 1 ? over(fg, under) : fg
    const cr = ratio(fgSolid, under)
    const large = size >= 24 || (size >= 18.66 && +weight >= 700)
    const need = large ? 3 : 4.5
    if (cr < need) {
      const k = hex(fgSolid) + ' on ' + hex(under) + ' ' + size + 'px w' + weight
      const e = lowContrast.get(k) ?? { ratio: Math.round(cr * 100) / 100, need, chars: 0, sample: own.slice(0, 60), uncertain }
      e.chars += chars
      lowContrast.set(k, e)
    }
  }

  const topN = (m, n, f = (v) => v) => [...m.entries()].sort((a, b) => f(b[1]) - f(a[1])).slice(0, n)
  const totalArea = [...area.values()].reduce((a, b) => a + b, 0) || 1
  return {
    pageBackground: hex(pageBg),
    palette: topN(area, 16).map(([k, v]) => ({ color: k, share: Math.round(v / totalArea * 1000) / 10 })),
    families: topN(families, 6).map(([k, v]) => ({ family: k, share: Math.round(v / (textChars || 1) * 1000) / 10 })),
    sizeScale: [...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ px: +k, chars: v })),
    typeStyles: topN(type, 14, (v) => v.chars).map(([k, v]) => ({ style: k, chars: v.chars, sample: v.sample })),
    radii: topN(radii, 10).map(([k, v]) => k + ' ×' + v),
    shadows: topN(shadows, 8).map(([k, v]) => k + ' ×' + v),
    borders: topN(borders, 8).map(([k, v]) => k + ' ×' + v),
    lowContrast: topN(lowContrast, 12, (v) => v.chars).map(([k, v]) => ({ pair: k, ...v })),
    distinctBackgrounds: area.size,
    distinctTextStyles: type.size,
  }
})()`

export async function renderedCensus(url, { width = 1440, height = 900, renderer, timeoutMs = 30000 } = {}) {
  const browser = await launchChrome({ renderer })
  try {
    const vp = { width, height, dpr: 1, name: "desktop" }
    const { page, log } = await openViewport(browser, vp, {
      url,
      reducedMotion: true,
      colorScheme: "light",
      hide: [],
      settleMs: 1200,
      timeoutMs,
    })
    // Walk the page once so lazy content and scroll-triggered reveals exist.
    await page.eval(`(async () => { const h = document.scrollingElement.scrollHeight; for (let y = 0; y < h; y += innerHeight) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 150)) } scrollTo(0, 0); return h })()`)
    const census = await page.eval(CENSUS)
    census.notes = log.notes
    census.documentStatus = log.documentStatus
    await page.close()
    return census
  } finally {
    await browser.close()
  }
}
