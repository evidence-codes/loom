// Scripts that run inside the page or the stitching tab. Kept as source
// strings because they execute in the browser, not in Node.

// Facts about the page as rendered at this viewport.
// expectedWidth: the emulated device width. Mobile browsers zoom out to fit
// overflowing content, which makes innerWidth grow and hides the overflow.
export const pageChecks = `(expectedWidth) => {
  const vw = Math.min(window.innerWidth, expectedWidth || Infinity)
  const doc = document.documentElement
  const label = (el) => {
    const id = el.id ? '#' + el.id : ''
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''
    return el.tagName.toLowerCase() + id + cls
  }
  const overflowers = []
  if (doc.scrollWidth > vw + 1) {
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width && r.right > vw + 1) overflowers.push({ el: label(el), right: Math.round(r.right) })
    }
    overflowers.sort((a, b) => b.right - a.right)
  }
  const imgs = [...document.images]
  const probe = document.createElement('canvas')
  const webgl = !!(probe.getContext('webgl2') || probe.getContext('webgl'))
  const fontsFailed = []
  document.fonts.forEach((f) => { if (f.status === 'error') fontsFailed.push(f.family) })
  return {
    title: document.title,
    zoomedOut: window.innerWidth > vw + 1,
    scrollWidth: doc.scrollWidth,
    overflowX: doc.scrollWidth > vw + 1,
    overflowers: overflowers.slice(0, 5).map((o) => o.el + ' → ' + o.right + 'px'),
    brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc).map((i) => i.currentSrc.slice(0, 120)),
    pendingImages: imgs.filter((i) => !i.complete && i.loading !== 'lazy').map((i) => i.currentSrc.slice(0, 120)),
    fontsStatus: document.fonts.status,
    fontsFailed: [...new Set(fontsFailed)],
    canvases: document.querySelectorAll('canvas').length,
    webgl,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
}`

// Fixed/sticky elements in view. Small ones are chrome (nav bars, badges,
// cookie bars) that would repeat on every slice; large ones are content
// (a fixed WebGL stage, a pinned scroll scene) and must stay.
const FIXED_SCAN = `
  const small = [], large = []
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    ;(r.height < innerHeight * 0.4 ? small : large).push(el)
  }
`

export const scanFixed = `(() => {${FIXED_SCAN}
  return { small: small.length, large: large.length }
})()`

// After the first slice: hide fixed/sticky chrome so it appears once.
export const hideFixedChrome = `(() => {${FIXED_SCAN}
  for (const el of small) {
    el.style.setProperty('visibility', 'hidden', 'important')
    el.dataset.loomHidden = ''
  }
  return { hidden: small.length, kept: large.length }
})()`
