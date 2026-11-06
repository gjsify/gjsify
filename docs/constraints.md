# Constraints

Target environment and invariants that hold across the repo.

## Runtime and build target

- **GJS 1.86.0** / **SpiderMonkey 140** (ES2024)
- **Rolldown** target `firefox140`
- **ESM-only**
- **GNOME libs + standard JS only**
- Tests pass on **Node + GJS**
- Do **not** modify `refs/`

SM128 (GJS 1.84) is no longer supported. SM128-era polyfills still load (idempotent no-ops) and are retired package by package as native SM140 paths are validated.

What SM140 gives beyond ES2024: [`engine-baseline.md`](engine-baseline.md).

## TypeScript version invariant

Root and **every** workspace declares `typescript: "^6.0.3"` — no 5.x carve-out, enforced by the CI `gjsify upgrade --check` step. Bumping it touches every `package.json` including `templates/*` and the integration tests, in one PR.

Do **not** reintroduce a 5.x pin plus root `overrides` scoping — the reasoning and the two CI breaks behind it are in [`governance.md`](governance.md).
