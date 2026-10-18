# Changelog

## 0.5.0

- **feat(agents)**: loom works in Cursor, Codex and Antigravity as well as Claude Code. `loom agents install` adds its skills as `loom-workflow`, `loom-adopt`, `loom-capture` and `loom-learn` to each agent's skills folder, or to a repo's with `--project`; `loom agents` shows what is installed where.
- **feat(setup)**: `loom setup` installs the pinned impeccable into every agent on the machine, using the build impeccable ships for each one (with its reviewer and documenter agents in Cursor and Codex). `--agents` picks which.
- **feat(installer)**: `install.sh` offers the other agents it finds, and gains `--no-agents` and `--no-impeccable`.
- **feat(plugin)**: the skills no longer assume Claude Code: reviewer names per agent, a disclosed fallback where impeccable ships no reviewer agent, and a note on sandboxed shells.
- **doctor** reports each agent's loom skills and impeccable.
- **fix(capture)**: reveals driven by GSAP or other scripted animation are waited out instead of captured half-faded, and a first screen that is 90% one colour is now flagged invalid.

## 0.4.1

- **fix(installer)**: `install.sh` was published empty in 0.4.0, so the one-line install did nothing. It is restored, and a new installer self-test runs the real script against a throwaway home.

## 0.4.0 — first public release

- **capture**: review-grade screenshots at true device widths, full pages stitched from viewport slices, a reduced-motion still record, waiting for animations to finish, GPU WebGL, and validity checks.
- **adopt**: an evidence report for an existing project. It covers stack, routes, tokens and drift, Tailwind v4 dead config, undefined colour utilities, unapplied fonts, a rendered census with contrast, and a supply-chain scan.
- **learn**: a lesson ledger, compiled house rules, and mechanical checks proven against real bugs.
- **preview / adapt**: run Next.js, Vite, Expo web and static projects safely and get a link; plain-language stack briefs.
- **report**: one readable page of the evidence, for people who don't use a terminal.
- **setup**: installs impeccable as its official Claude Code plugin, pinned to a reviewed commit.
- **Claude Code plugin**: skills `/loom:workflow`, `/loom:adopt`, `/loom:capture`, `/loom:learn`.
- **Installer**: a one-line install that checks prerequisites in plain English, plus a guided `loom` menu.
