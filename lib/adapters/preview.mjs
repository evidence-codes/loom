// loom preview: run a project locally the safe way and hand back a URL.
// Safety scan first, nothing installed without consent, the user never needs
// to know the stack, the port or the dev command.

import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { detect } from "./index.mjs"
import { serveStatic } from "./static-server.mjs"
import { scanConfigs, scanNodeModules } from "../safety.mjs"
import { capture } from "../capture.mjs"

const say = (m) => process.stderr.write(`  · ${m}\n`)

async function freePort(start) {
  for (let p = start; p < start + 200; p++) {
    const ok = await new Promise((r) => {
      const s = createServer().once("error", () => r(false)).once("listening", () => s.close(() => r(true)))
      s.listen(p, "127.0.0.1")
    })
    if (ok) return p
  }
  throw new Error("No free port found")
}

async function waitForHttp(url, child, logs, timeoutMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (child && child.exitCode !== null) throw new Error(`the dev server stopped (exit ${child.exitCode}).\n${logs.slice(-25).join("")}`)
    try {
      const r = await fetch(url, { redirect: "manual" })
      return r.status
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`the site didn't respond within ${Math.round(timeoutMs / 1000)}s.\n${logs.slice(-25).join("")}`)
}

export class PreviewError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

export async function preview(dir, opts = {}) {
  const root = resolve(dir)
  const { adapter, pkg } = detect(root)
  if (!adapter) throw new PreviewError("loom doesn't recognise this project yet (no Next.js, Vite, Expo, Flutter or index.html found).", 5)
  say(`${adapter.name} project`)
  const unsupported = adapter.unsupported?.(root, pkg)
  if (unsupported) throw new PreviewError(unsupported, 5)

  say("checking config files for supply-chain markers")
  const cfg = scanConfigs(root)
  if (cfg.length) throw new PreviewError(`Stopped: ${cfg.length} suspicious finding(s) in config files (${cfg.map((f) => `${f.file}:${f.line}`).slice(0, 3).join(", ")}). Running this project would execute them. Review before going further.`, 3)

  if (adapter.needsInstall) {
    if (!existsSync(join(root, "node_modules"))) {
      if (!opts.install) {
        throw new PreviewError("This project's packages aren't installed yet. Run again with --install to install them exactly as the lockfile lists them (with install scripts turned off), or install them yourself.", 6)
      }
      const lock = ["package-lock.json", "npm-shrinkwrap.json"].find((f) => existsSync(join(root, f)))
      if (!lock) throw new PreviewError("No package-lock.json to install from, so loom won't guess versions. Install the packages yourself.", 6)
      say("installing packages from the lockfile (scripts off)")
      const r = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit" })
      if (r.status !== 0) throw new PreviewError("Installing packages failed; see the output above.", 1)
    }
    say("scanning installed packages for the worm's markers")
    const nm = scanNodeModules(root)
    if (nm.hits.length) throw new PreviewError(`Stopped: worm markers in ${nm.hits.length} installed file(s), e.g. ${nm.hits[0]}. Don't run this project until those files are reviewed.`, 3)
    say(`${nm.files} package files clean`)
  }

  const port = opts.port ?? (await freePort(3300))
  const url = `http://127.0.0.1:${port}/`
  const logs = []
  let child = null
  let server = null
  const plan = adapter.dev(root, pkg, port)
  if (plan?.builtin === "static") {
    server = await serveStatic(root, port)
  } else {
    if (!existsSync(plan.cmd)) throw new PreviewError(`Can't find ${plan.cmd}. The packages may be incomplete; reinstall them (loom preview --install after removing node_modules).`, 6)
    say("starting the site")
    child = spawn(plan.cmd, plan.args, { cwd: root, env: { ...process.env, ...(plan.env ?? {}) }, stdio: ["ignore", "pipe", "pipe"], detached: true })
    child.stdout.on("data", (d) => logs.push(d.toString()))
    child.stderr.on("data", (d) => logs.push(d.toString()))
  }

  const stop = () => {
    if (child && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM")
      } catch {}
    }
    server?.close()
  }

  try {
    const status = await waitForHttp(url, child, logs, opts.timeoutMs ?? 120000)
    if (status >= 500) throw new PreviewError(`The site started but the page fails with HTTP ${status}.\n${logs.slice(-25).join("")}`, 7)
  } catch (e) {
    stop()
    throw e instanceof PreviewError ? e : new PreviewError(`The site didn't start: ${e.message}`, 7)
  }

  return { url, adapter, stop, logs }
}

export async function previewAndCapture(dir, opts) {
  const p = await preview(dir, opts)
  let caps = null
  if (opts.capture) {
    say("capturing")
    caps = await capture({
      url: p.url,
      out: resolve(opts.out ?? join(resolve(dir), ".design/preview")),
      viewports: opts.viewports,
      full: true,
      first: true,
      motion: "both",
      settleMs: 1500,
      motionSettleMs: 3500,
      sliceSettleMs: 500,
      hide: [],
      keepFixed: false,
      colorScheme: "light",
      timeoutMs: 30000,
      renderer: opts.renderer,
      quiet: true,
    })
  }
  return { ...p, caps }
}
