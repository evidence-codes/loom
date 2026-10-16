// Minimal Chrome DevTools Protocol driver: launch headless Chrome, open a
// browser-level WebSocket, and talk to page targets through flat sessions.
// Zero dependencies: Node's built-in WebSocket and child_process only.

import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CHROME_PATHS = [
  process.env.LOOM_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean)

export function findChrome() {
  const path = CHROME_PATHS.find((p) => existsSync(p))
  if (!path) throw new Error("Chrome not found. Set LOOM_CHROME to the browser binary.")
  return path
}

// gpu: the machine's GPU through ANGLE/Metal (fast, needs a real GPU).
// software: SwiftShader (works anywhere, e.g. CI; slow on heavy canvas work).
const RENDERER_FLAGS = {
  gpu: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  software: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
}

export async function launchChrome({ headless = true, renderer = "gpu" } = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), "loom-chrome-"))
  const args = [
    headless ? "--headless=new" : null,
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--mute-audio",
    ...(RENDERER_FLAGS[renderer] ?? RENDERER_FLAGS.software),
    "--window-size=1440,900",
    "about:blank",
  ].filter(Boolean)

  const proc = spawn(findChrome(), args, { stdio: ["ignore", "ignore", "pipe"] })
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = ""
    const timer = setTimeout(() => reject(new Error("Chrome did not start within 20s")), 20000)
    proc.stderr.on("data", (d) => {
      buf += d.toString()
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    })
    proc.on("exit", (code) => reject(new Error(`Chrome exited early (code ${code})`)))
  })

  const browser = await Browser.connect(wsUrl)
  browser.close = async () => {
    try {
      await browser.send("Browser.close")
    } catch {}
    browser.ws.close()
    await new Promise((r) => {
      if (proc.exitCode !== null) return r()
      proc.once("exit", r)
      setTimeout(() => {
        proc.kill("SIGKILL")
        r()
      }, 3000)
    })
    rmSync(userDataDir, { recursive: true, force: true })
  }
  return browser
}

class Browser {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.onopen = () => resolve(new Browser(ws))
      ws.onerror = (e) => reject(new Error(`CDP connection failed: ${e.message ?? e}`))
    })
  }

  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map() // key `${sessionId}:${method}` -> Set<fn>
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`))
        else resolve(msg.result)
        return
      }
      if (msg.method) {
        const key = `${msg.sessionId ?? ""}:${msg.method}`
        for (const fn of this.listeners.get(key) ?? []) fn(msg.params)
      }
    }
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify(payload))
    })
  }

  on(sessionId, method, fn) {
    const key = `${sessionId ?? ""}:${method}`
    if (!this.listeners.has(key)) this.listeners.set(key, new Set())
    this.listeners.get(key).add(fn)
    return () => this.listeners.get(key)?.delete(fn)
  }

  async newPage() {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" })
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true })
    return new Page(this, targetId, sessionId)
  }
}

export class Page {
  constructor(browser, targetId, sessionId) {
    this.browser = browser
    this.targetId = targetId
    this.sessionId = sessionId
  }

  send(method, params) {
    return this.browser.send(method, params, this.sessionId)
  }

  on(method, fn) {
    return this.browser.on(this.sessionId, method, fn)
  }

  once(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (p) => {
        off()
        clearTimeout(t)
        resolve(p)
      })
      const t = setTimeout(() => {
        off()
        reject(new Error(`Timed out waiting for ${method}`))
      }, timeoutMs)
    })
  }

  // Evaluate an expression (or async IIFE) in the page and return its value.
  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (res.exceptionDetails) {
      const d = res.exceptionDetails
      throw new Error(`Page script failed: ${d.exception?.description ?? d.text}`)
    }
    return res.result.value
  }

  async close() {
    try {
      await this.browser.send("Target.closeTarget", { targetId: this.targetId })
    } catch {}
  }
}
