// A tiny static file server for plain HTML projects, so previewing them needs
// nothing installed and runs nothing from the project.

import { createServer } from "node:http"
import { createReadStream, existsSync, statSync } from "node:fs"
import { join, normalize, extname, resolve } from "node:path"

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
  ".ttf": "font/ttf", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".mp4": "video/mp4", ".txt": "text/plain",
}

export function serveStatic(root, port) {
  const base = resolve(root)
  const server = createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? "/").split("?")[0])
    let file = normalize(join(base, p))
    if (!file.startsWith(base)) {
      res.writeHead(403).end()
      return
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html")
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found")
      return
    }
    res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" })
    createReadStream(file).pipe(res)
  })
  return new Promise((ok, fail) => {
    server.once("error", fail)
    server.listen(port, "127.0.0.1", () => ok(server))
  })
}
