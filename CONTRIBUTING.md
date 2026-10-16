# Contributing

loom has no dependencies on purpose: Node ≥ 22 (built-in `fetch` and `WebSocket`) and a local Chrome. Please keep it that way.

```sh
git clone https://github.com/evidence-codes/loom && cd loom
sh install.sh      # links `loom` into ~/.local/bin and seeds the house rules
npm test           # capture, adopt, learn and adapter self-tests (needs Chrome)
```

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org): `feat(capture): …`, `fix(adopt): …`, `docs: …`, `test: …`, `chore: …`.
- **Every check needs proof.** A new check, adopt finding or learned lesson must ship with a test fixture showing it fires on the real bug and stays quiet on the fix (see `test/learn.mjs`).
- **Never commit literal malware markers**, even in tests: assemble them at runtime. Security hooks scan source files for them.
- **Plugin changes:** validate with `claude plugin validate . --strict`.
