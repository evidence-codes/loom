# Contributing

loom has no dependencies on purpose: Node ≥ 22 (built-in `fetch` and `WebSocket`) and a local Chrome. Please keep it that way.

```sh
git clone https://github.com/evidence-codes/loom && cd loom
sh install.sh      # links `loom` into ~/.local/bin and seeds the house rules
npm test           # capture, adopt, learn, adapter, agent and installer self-tests (needs Chrome)
```

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org): `feat(capture): …`, `fix(adopt): …`, `docs: …`, `test: …`, `chore: …`.
- **Every check needs proof.** A new check, adopt finding or learned lesson must ship with a test fixture showing it fires on the real bug and stays quiet on the fix (see `test/learn.mjs`).
- **Never commit literal malware markers**, even in tests: assemble them at runtime. Security hooks scan source files for them.
- **Plugin changes:** validate with `claude plugin validate . --strict`.
- **Skills are shared by every agent.** Write `skills/*/SKILL.md` without assuming Claude Code; `loom agents install` renames them (`adopt` becomes `loom-adopt`, `loom:adopt` references follow) for the others.

## Releasing

`main` only takes pull requests that pass the `test` check, merged by rebase. A rebase merge gives every commit a new hash, so **tag after merging, never before**.

1. **Fix or feature on a branch**, with a test as above. If the bug left bad state on users' machines (a stale file, a missing install), also make `loom doctor` detect it, and plan an upgrade note for the changelog.
2. **Release commit last**: `chore(release): X.Y.Z` bumps `package.json` and `.claude-plugin/plugin.json` and adds a `## X.Y.Z` section to `CHANGELOG.md`, with any one-off upgrade step. Patch for fixes, minor for features.
3. **Open a PR**, let `test` pass, then rebase-merge it and delete the branch.
4. **Tag the merged release commit**, after syncing and checking the tree matches what you tested:
   ```sh
   git switch main && git fetch origin && git reset --hard origin/main
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
5. **Publish the release page**, titled `loom X.Y.Z`: a one-line summary, the changes in user terms, any upgrade step, then the install command and "Already installed? Run the same command again to update."
   ```sh
   gh release create vX.Y.Z --title "loom X.Y.Z" --latest --verify-tag --notes-file notes.md
   ```
6. **Announce** on X, linking the release page, and only once the page is live. Say plainly what was wrong, including bugs, and what users should do.
7. **Check**: `gh release list` shows the new version as Latest, and `loom --version` reports it.
