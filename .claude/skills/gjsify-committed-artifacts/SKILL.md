---
name: gjsify-committed-artifacts
description: Read BEFORE editing packages/infra/cli/src, resolve-npm/lib, rolldown-plugin-gjsify/src or packages/infra/tsc — anything whose output is baked into a GJS bundle. Also read when a change appears to have no effect, when a build "succeeded" but nothing changed, or when CI reports bundle staleness. Triggers: "stale bundle", "cli.gjs.mjs", "affected.gjs.mjs", "verify-committed-bundles", "my change has no effect", "rebuild the bundle", "git hook".
---

# gjsify — GJS bundles and what a green build proves

**In this repo the code you edited is very often not the code that runs.** That is still
true after ADR 0002 untracked `cli.gjs.mjs` and `tsc.gjs.mjs` — the reason changed, and the
new one is quieter.

## 1. A stale LOCAL build output shadows your source edit, and nothing in CI sees it

`node_modules/.bin/gjsify` dispatches to `packages/infra/cli/dist/cli.gjs.mjs` whenever
`gjs` is on PATH and that file exists, and only falls back to `packages/infra/cli/lib/index.js`.
Both are build outputs. So after you edit `src/`, the shim keeps running the last bundle you
built until you rebuild it — and since the file is no longer committed, **CI cannot tell you**:
it builds its own from your source.

Fix: `gjsify run build` (or `gjsify workspace @gjsify/cli build` for just the CLI). If a change
seems to do nothing, check the bundle's mtime before you debug the change.

## 2. `affected.gjs.mjs` is the one artifact still committed, and its staleness FAILS OPEN

`packages/infra/cli/dist/affected.gjs.mjs` is the Soup-free CI classifier. The `changes` job
boots it on a plain ubuntu+gjs host **before any install**, and it gates every other job. A
stale copy does not error — it classifies today's PR with an older commit's tables, and the
run looks green while having skipped work.

- Rebuild: `gjsify workspace @gjsify/cli build && gjsify workspace @gjsify/cli build:affected-bundle`
- CI byte-compares it against `git show HEAD:` in `scripts/verify-committed-bundles.mjs`.
- `.githooks/pre-commit` rebuilds + re-stages it when `packages/infra/cli/{src,package.json}`,
  `resolve-npm/lib/` or `rolldown-plugin-gjsify/src/` is staged.

## 3. The hook is BEST-EFFORT — never read a green pre-commit as "the bundle is fresh"

Its trigger list is four paths; the bundle inlines the whole workspace-dep closure. Measured
2026-08-06: a commit touching `packages/web/dom-events` + `packages/web/abort-controller` —
neither of which looks like CLI infrastructure — staled all three artifacts by +18 B each and
the hook stayed silent, correctly, because no trigger path matched. It also warns-and-skips
with no reachable CLI or no `node_modules` (a bare worktree, the #821 case). The exhaustive
check is CI's rebuild-and-compare. `post-rewrite` no longer exists — see
`docs/build-artifacts.md`.

Never bypass with `--no-verify` / `SKIP_GJSIFY_HOOKS=1` to get a commit through — fix the cause.

## 4. Two rules that outlive any particular artifact

1. **Verify freshness against the SOURCE, not the version string.** A matching `--version`
   proves nothing about whether the bundle was rebuilt. This is why the two per-job version
   checks were removed rather than kept: #821 merged fully green with both bundles stale.
2. **An exit code is not evidence that anything was WRITTEN.** Check that the output file's
   mtime and content actually changed; a build can succeed and emit nothing (`tsc` with a
   `.tsbuildinfo` that outlived its output tree — #67).

Detail, with the incidents: [docs/build-artifacts.md](../../../docs/build-artifacts.md).
Why the artifacts left git: [docs/adr/0002-bootstrap-bundle-minimization.md](../../../docs/adr/0002-bootstrap-bundle-minimization.md).
