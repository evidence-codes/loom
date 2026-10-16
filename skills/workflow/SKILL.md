---
name: workflow
description: The full loom design workflow from first look to documented ship — adopt or init, house rules, impeccable direction round, build, mechanical checks, capture, independent finish review, documenter, and recording lessons. Use when the user asks to design, redesign, revamp or take over a site or app end to end, or asks "what's the process", "run the whole workflow", or "do it properly".
---

# The loom workflow

loom layers on [impeccable](https://github.com/pbakaus/impeccable) (Apache-2.0). impeccable owns direction, craft and review, and loom adds the evidence and memory around them. Run the stages in order and don't skip one silently. If a stage can't run, say so.

0. **Dependencies.** If impeccable isn't available, run `loom setup` (it installs the reviewed, pinned version as a Claude Code plugin after showing the user what it does).
1. **Safety first.** Before running any project, scan its configs and `node_modules` for the worm markers; `loom adopt` does the config part. Ask before installing anything; reinstall with `npm ci --ignore-scripts`.
2. **Know the project.** `loom adapt <dir>` says what the stack is, how loom runs it, and which house rules apply.
   - Existing app: use the `loom:adopt` skill. It produces evidence, a short interview, PRODUCT.md, and DESIGN.md or `current-design.md`.
   - Greenfield: impeccable `init`.
3. **Read the house rules.** Run `loom learn rules` and read `~/.loom/house-rules.md`. Standing rules apply by default.
4. **Direction.** impeccable's new-work flow:
   - `concept-seed`, then the decision page;
   - the user picks a direction;
   - write the direction contract to the surface brief.
5. **Build** to the contract and impeccable's craft floor.
6. **Self-check before review.** Run the site with `loom preview <dir> --capture`, which does the safety scan, start-up and screenshots in one step; never start dev servers by hand.
   - `loom learn check <dir>`, and fix every hit;
   - `impeccable detect` on the running page;
   - `loom capture <url> --motion both --out .impeccable/review` for the review set, and fix anything you can see first.
7. **Independent finish review.** Run impeccable's finish reviewer as a fresh agent, never in-thread. The agent is `impeccable:impeccable-finish-reviewer` when impeccable came from `loom setup`, or `impeccable-finish-reviewer` when it was installed by hand:
   - Give it the request, the confirmed answers, the contract, the captures with their notes, and the detector output.
   - Act on its disposition: ship, fix, rebuild or recapture.
   - Two fix rounds is the default budget. After that, the user decides.
8. **Document.** impeccable's documenter writes DESIGN.md and `.impeccable/design.json` from the built result. Report its drift and coined names to the user.
9. **Learn.** For every confirmed fix that would recur elsewhere, run `loom learn add …` with `--source review`, or `--source user` for the user's own corrections. Give a mechanical lesson a check, and prove the check on the real bug.
10. **Hand off.** Save the reviewer's final report to `<project>/.design/review.md`, run `loom report <dir>`, and publish `.design/report/index.html` with its `img/` files as a shareable page for anyone who won't read a terminal.
    - Commit on a branch. Push or open a PR only when asked.
    - Report the verdict at its real scope, what is open, and what the user must supply (links, keys, content).
