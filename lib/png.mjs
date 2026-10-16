// Just enough PNG for screenshots: decode 8-bit RGB/RGBA (non-interlaced, as
// Chrome writes them) to RGBA, and encode RGBA. Node's zlib does the heavy part.

import { inflateSync, deflateSync } from "node:zlib"

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export function decode(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error("Not a PNG")
  let off = 8
  let width, height, bitDepth, colorType, interlace
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString("latin1", off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === "IDAT") idat.push(data)
    else if (type === "IEND") break
    off += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG (depth ${bitDepth}, colour type ${colorType}, interlace ${interlace})`)
  }
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[x] = v & 255
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      out[o] = line[x * bpp]
      out[o + 1] = line[x * bpp + 1]
      out[o + 2] = line[x * bpp + 2]
      out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255
    }
    prev = line
  }
  return { width, height, data: out }
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, "latin1"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

export function encode({ width, height, data }) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  // Filter "up" per row: cheap and compresses screenshots well.
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 2
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const up = y ? data[row - stride + x] : 0
      raw[y * (stride + 1) + 1 + x] = (data[row + x] - up) & 255
    }
  }
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))])
}

// Paste images at vertical offsets into one RGBA canvas; later images win overlaps.
export function stackAt(width, height, pieces) {
  const data = Buffer.alloc(width * height * 4)
  for (const { img, y } of pieces) {
    const w = Math.min(width, img.width)
    for (let row = 0; row < img.height; row++) {
      const ty = y + row
      if (ty < 0 || ty >= height) continue
      img.data.copy(data, ty * width * 4, row * img.width * 4, row * img.width * 4 + w * 4)
    }
  }
  return { width, height, data }
}

// Longest run of single-colour rows (sampled), in image pixels.
export function uniformBand(img) {
  const { width, height, data } = img
  const step = Math.max(1, Math.floor(width / 64))
  let best = 0, run = 0, prev = null, bestColor = null, runColor = null
  for (let y = 0; y < height; y++) {
    const o = y * width * 4
    const r0 = data[o], g0 = data[o + 1], b0 = data[o + 2]
    let uniform = true
    for (let x = 0; x < width; x += step) {
      const i = o + x * 4
      if (Math.abs(data[i] - r0) > 6 || Math.abs(data[i + 1] - g0) > 6 || Math.abs(data[i + 2] - b0) > 6) {
        uniform = false
        break
      }
    }
    const key = uniform ? `${r0 >> 3},${g0 >> 3},${b0 >> 3}` : null
    if (uniform && key === prev) run++
    else {
      run = uniform ? 1 : 0
      runColor = uniform ? `rgb(${r0},${g0},${b0})` : null
    }
    prev = key
    if (run > best) {
      best = run
      bestColor = runColor
    }
  }
  return { longestUniformBand: best, bandColor: bestColor }
}
