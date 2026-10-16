# Security

loom runs other people's projects, so it is careful about it:

- **Scans happen before running.** `loom adopt` reads files as text and never executes them. `loom preview` scans config files, and every installed package file, for the loader markers of the Sep 2026 npm worm before starting anything. Any finding stops the run.
- **Nothing is installed without consent.** `loom preview` installs packages only with `--install`, and then only with `npm ci --ignore-scripts` from the lockfile.
- **Dependencies are pinned.** `loom setup` installs impeccable from a fixed, reviewed commit. It verifies the commit and the manifest version before installing.
- **No telemetry.** loom itself sends nothing anywhere. impeccable, which loom installs, contacts impeccable.style unless `IMPECCABLE_NO_TELEMETRY=1` is set; `loom setup` says so before installing.

To report a vulnerability, open a private security advisory at https://github.com/evidence-codes/loom/security/advisories/new rather than a public issue.
