---
name: learn
description: Keep and apply house design rules learned from reviews and corrections. Use at the start of any design build (read the rules), before sending work to a finish review (run the mechanical checks), and whenever a reviewer returns findings or the user corrects design work (record the lesson). Triggers include "remember this for next time", "we keep making this mistake", a finish-review verdict of fix, or starting any impeccable/loom design task.
---

# loom learn

Every project should start stricter than the last. The ledger (`~/.loom/ledger.jsonl`) holds what reviews and corrections taught. `~/.loom/house-rules.md` is the compiled view, and the mechanical lessons run as checks.

CLI: `loom learn <action>` (run `learn --help` for the full list).

## At the start of a build

Run `loom learn rules`, then read `~/.loom/house-rules.md` before writing UI code.
- **Standing rules** (seen in two or more projects, or set by the user) apply by default.
- **Provisional rules** apply too. When one turns out wrong for this project, say so in your report instead of silently ignoring it.

## Before the finish review

Run `loom learn check <project-dir>` and fix every hit before capturing.
- Exit 4 means a checked lesson was violated.
- Pass any hit you deliberately keep to the reviewer, with the reason.

## When a review or the user teaches something

Record it once the fix is confirmed, not while it is still a guess:

```sh
loom learn add --rule "<imperative sentence>" --why "<what went wrong, concretely>" \
  --category <craft|copy|motion|responsive|a11y|stack|process> \
  --source <review|user|adopt|self> --project <name> --note "<where it showed up>"
```

- **The rule is general, the why is specific.** For example, "No eyebrow labels above headings" with the why "category tags above project titles in the portfolio".
- **Same lesson in a new project:** pass the existing `--id` so it gains a sighting instead of becoming a duplicate. The second project promotes it to standing.
- **The user's own corrections use `--source user`.** They become standing immediately.
- **A lesson that can be detected in code should get a check.** Add an entry with a `check` (`{ ext, all, none, scope, message }`, regexes) to the ledger or `lib/learn/seed.json`. Prove it fires on the real bug and stays quiet on the fix (see `test/learn.mjs`).
- **A lesson that proved wrong** gets `loom learn retire <id> --why "…"`.

Do not record taste disagreements, one-off content facts or project-specific copy. Those belong in that project's PRODUCT.md or DESIGN.md.
