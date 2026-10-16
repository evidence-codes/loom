// Colour parsing and comparison for token census.

export function toHex(str) {
  str = str.trim().toLowerCase()
  let m = str.match(/^#([0-9a-f]{3,8})$/)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("")
    if (h.length === 8 && h.endsWith("ff")) h = h.slice(0, 6)
    if (h.length !== 6 && h.length !== 8) return null
    return "#" + h
  }
  m = str.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/)
  if (m) return rgbToHex(+m[1], +m[2], +m[3], alpha(m[4]))
  m = str.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/)
  if (m) {
    const [r, g, b] = hslToRgb(+m[1], +m[2] / 100, +m[3] / 100)
    return rgbToHex(r, g, b, alpha(m[4]))
  }
  // shadcn-style bare channels: "222 47% 11%"
  m = str.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/)
  if (m) {
    const [r, g, b] = hslToRgb(+m[1], +m[2] / 100, +m[3] / 100)
    return rgbToHex(r, g, b, 1)
  }
  return null
}

function alpha(a) {
  if (a === undefined) return 1
  return a.endsWith("%") ? parseFloat(a) / 100 : +a
}

function rgbToHex(r, g, b, a = 1) {
  const h = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0")
  return "#" + h(r) + h(g) + h(b) + (a < 1 ? h(a * 255) : "")
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

export function hexToRgb(hex) {
  const h = hex.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function lin(c) {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

// CIE76 delta-E on Lab: good enough to spot near-duplicate literals.
function toLab(hex) {
  const [r, g, b] = hexToRgb(hex).map(lin)
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  x = f(x)
  y = f(y)
  z = f(z)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

export function deltaE(a, b) {
  const [l1, a1, b1] = toLab(a)
  const [l2, a2, b2] = toLab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

// Group colours that are visually near-identical (likely the same intent).
export function nearDuplicates(colors, threshold = 4) {
  const solid = colors.filter((c) => c.hex.length === 7)
  const groups = []
  const used = new Set()
  for (let i = 0; i < solid.length; i++) {
    if (used.has(i)) continue
    const group = [solid[i]]
    for (let j = i + 1; j < solid.length; j++) {
      if (!used.has(j) && deltaE(solid[i].hex, solid[j].hex) < threshold) {
        group.push(solid[j])
        used.add(j)
      }
    }
    if (group.length > 1) groups.push(group)
  }
  return groups
}
