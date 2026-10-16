---
name: adopt
description: Take over the design of an existing app or site. Scans it into an evidence report (stack, routes, product facts, the design system in source and as rendered, drift, supply-chain safety), interviews the user briefly, then writes PRODUCT.md and a DESIGN.md of the current system. Use when the user wants an existing project brought into the design workflow, documented, audited for design consistency, or prepared for a redesign, e.g. "adopt this app", "document the current design", "what is this project's design system", "get this repo ready for a redesign".
---

# loom adopt

This skill brings an existing project into the design workflow without throwing its current design away. The tool gathers the facts and you make the judgment calls. Never invent a design system the evidence doesn't show.

The `loom` command is on the PATH while this plugin is enabled (and in the terminal after running `install.sh`). It needs Node 22 or later and Chrome, and installs no dependencies.

## 1. Gather evidence

```sh
loom adopt <project-dir> [--url <running-instance>]
```

- **The scan never executes the project.** Do not start the project's dev server just to get a URL, especially for a repo you have not reviewed. Running a project executes its config files. Pass `--url` only when an instance is already running. If the user wants one started, use `loom preview <dir>` once the safety check is clean: it scans the installed packages, refuses to install without `--install`, and prints the URL.
- **Exit code 3 means supply-chain markers were found in config files.** Stop. Tell the user what was found and where (the report's Findings section), and do nothing else in that project until they have reviewed it.
- **The output is `<project>/.design/adopt/adopt.md`.** It is the readable report, and `adopt.json` holds the full data. With `--url` the report also includes captures under `captures/`.
- **If the local app fails to render, measure the deployed site instead.** loom marks HTTP error pages invalid and discards their census, so an error page never gets documented. Look for the deployed URL in the code, metadata or git remote, and pass it as `--url`; loading a public page is read-only. Say in PRODUCT.md which source the census came from. Repairing the local install (`npm install`) changes the project, so ask first.
- **A monorepo is reported as several apps.** Ask which app this adoption covers, then rerun on that app's directory.

Read `adopt.md` in full before going further. If captures exist, look at the first-viewport images.

## 2. Interview (one round)

Use the structured question tool. Start from the report's "Questions for the interview", and keep it to 3–4 questions. Drop any question whose answer the evidence already gives with confidence; for those, ask the user to confirm instead.

Always settle three things:
- **Who it is for and what it is for.** Skip this if PRODUCT.md exists and is current.
- **Which parts of the current look are deliberate.** Name the dominant colours and faces the census found, and ask whether each is brand or accident.
- **The goal.** Document and tighten, or replace.

## 3. Write PRODUCT.md

- Follow impeccable's product schema (`reference/init.md` in the impeccable skill, Step 4), including the schema comment.
- If PRODUCT.md exists, update it: add missing facts and never overwrite confirmed ones.
- Under Evidence on Hand, list what really exists: live routes, screenshots, metadata copy. State what does not exist, such as testimonials or metrics, so later work does not invent it.
- Mark every fact that came from the scan and was not confirmed in the interview as inferred.

## 4. Record the current design

**If the goal is to replace the design,** do not write DESIGN.md: impeccable's new-work flow writes it after the redesign, and a DESIGN.md of the old look would be defended instead of replaced. Write `.design/adopt/current-design.md` instead, in three parts:
- **Keep:** the confirmed brand.
- **As rendered:** a short factual record.
- **Do not carry forward:** drift, defects and category-default patterns.

New-work reads this as evidence and anti-reference.

**If DESIGN.md does not exist (and the goal is to document or tighten),** document the system as built. Use impeccable's document flow (`reference/document.md`), and spawn its documenter where subagents are available. Pass the documenter `adopt.md`, `adopt.json`, the captures and the user's answers as evidence. Then:
- Take token values from the rendered census first and the source second. The browser is the truth; unused stylesheets are not.
- Record the findings as a **Drift** section, not as rules. For example, "7 body sizes in use (14–20px)" is drift; it does not make 7 body sizes part of the system.
- Elements the user called accidents go in Drift. Elements they called brand become rules.
- Write `.impeccable/design.json` alongside DESIGN.md.

**If DESIGN.md exists,** do not rewrite it. Compare it against the evidence and report:
- what still matches;
- what the build does that the document does not say;
- what the document claims that the build no longer does.

Offer to update it only with the user's approval.

## 5. Hand off

Tell the user:
- where PRODUCT.md and DESIGN.md are;
- the top drift items, in the report's own wording, with the stop and fix items first;
- the recommended next step for their stated goal:
  - **Tighten:** the impeccable commands that address the drift, such as `typeset` for a loose type scale, `colorize` or `extract` for an untokenised palette, and `audit` for contrast.
  - **Replace:** impeccable's new-work flow. PRODUCT.md is now in place, so it can start at the direction round.

Do not fix drift as part of adoption unless the user asks. Adoption documents and recommends; changes come in the next step.
