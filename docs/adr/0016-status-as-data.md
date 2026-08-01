# ADR 0016 — Status as data: authored status data + derived facts

- **Status:** Accepted (2026-07-31), **amended same day** — see [Amendment](#amendment-2026-07-31--the-rendered-statusmd-is-not-committed). The split (authored data vs derived facts) stands; the rendered `STATUS.md` is no longer a tracked artifact.
- **Scope:** `STATUS.md` (now a generated artifact), the authored data set `status/` (`status.json` + `status.schema.json`, `integration-coverage.md`, `open-todos.md`, `upstream-patch-candidates.md`, `sections/*.md`), the generator `scripts/generate-status.mjs`, and the `status-data` rule in the manifest-conformance registry (selected by `audit-runtimes --check`).
- **Complements** ADR 0003 (`gjsify.tier`), ADR 0014/0015 (declared runtime/headless contracts) and the manifest-conformance registry — the declarations those contracts hold are exactly what the status generator derives from instead of restating.

## Context

STATUS.md grew to ~1600 lines / 384 KB of hand-maintained prose. Its mandate —
"a CURRENT SNAPSHOT, edited in place" — could not be validated, and the file
demonstrated the consequence: hand-copied restatements of facts that are
already true in the repo had drifted (21 vs 22 infra packages, 59 vs 93 `refs/`
submodules, "12" vs 52 browser-tested packages, a whole framework sub-pillar —
the devtools cluster — absent from every table), completed TODOs and
`### Completed (Phase …)` done-logs accumulated against the file's own rules,
and nobody read the result end to end. The same failure class had already been
solved elsewhere in this repo by deriving checks from declarations
(`@gjsify/manifest-conformance`, `verify-package-outputs`, `audit-runtimes`);
status was the last large document still maintained by retyping reality.

## Decision

1. **Split derivable from authored.** Anything already true in the repo is
   DERIVED at generation time and can never be typed by hand again: package
   lists (scan of `packages/**`), tiers (`gjsify.tier`), runtime quadruplets
   (`gjsify.runtimes`), platform targets (`gjsify.platforms`), prebuild
   presence, GNOME-namespace usage (`gi://` + `@girs/*` value imports in
   `src/`), static spec-file/`it()` counts, browser-test presence
   (`src/test.browser.mts`), suite/e2e/showcase/example/refs counts, the
   Summary table, tier membership, and the Metrics section. What genuinely
   needs a human is AUTHORED in `status/`: the per-package status claim
   (`full|partial|stub|meta|native|poc`) with its prose (`note`, and
   `working`/`missing` for partials), per-integration-suite notes, Open TODOs,
   the upstream patch-candidate table, and a fixed set of free-form sections.
2. **The authored file cannot contradict a manifest.** `status/status.json`
   entries allow exactly four keys; an authored `tier`, `runtimes` or test
   count is a validation failure, so a second source of truth structurally
   cannot exist. The one semantic bridge is checked directly: an authored
   `native` status requires a `gjsify.prebuilds` declaration.
3. **Generation + validation are one dependency-free script.**
   `scripts/generate-status.mjs` (plain Node, no install, no build — the
   audit-job constraint) validates the authored data, renders STATUS.md
   deterministically, and offers `--check` (regenerate + byte-compare, the
   `verify-committed-bundles` posture).
4. **The gate lives in the conformance registry.** `status-data`
   (`scripts/manifest-conformance/rules/status-data.mjs`, scope `repo`,
   `fields: []` like `curated-alias-routing`) is registered and selected by
   `audit-runtimes --check`, so every PR validates: entry coverage in both
   directions, schema, the suite-heading ↔ `tests/integration/*` bijection,
   the fixed `sections/` set (an unknown file would silently never render),
   the delete-on-resolve TODO rule (headings must not be struck-through /
   ✓ / "Completed" — previously only remembered, now machine-checked), and
   STATUS.md freshness.
5. **Downstream formats stay.** `website/scripts/generate-coverage.mjs`
   continues to parse the generated Summary table (same header shape), so the
   website's coverage bars now sit two derivation steps from the manifests
   with no hand-typed number in between.

## Consequences

- STATUS.md carries a generated-file header naming the regenerate command;
  hand-edits fail CI with that command in the message.
- Adding a package without an authored status entry is a red PR (and deleting
  a package leaves an orphan entry that is equally red) — the coverage failure
  every hand-maintained table silently lacked.
- Resolved TODOs and solved upstream-patch rows must be deleted, not struck
  through; the done-log cannot regrow.
- Runtime pass/fail totals are deliberately NOT in STATUS.md: static `it()`
  call-site counts are labelled as such, and CI remains the gate for runtime
  results. Numbers inside authored prose (suite baselines like "185/185")
  remain authored narrative, updated when the fact changes.
- The affected classifier does not yet classify `status/**` /
  `scripts/manifest-conformance/**` (conservative full run; tracked in
  `status/open-todos.md` § Manifest-conformance follow-ups, to be batched with
  the next CLI-src touch since classifier changes rebuild the committed
  `dist/affected.gjs.mjs`).

## Amendment (2026-07-31) — the rendered STATUS.md is NOT committed

Decision points 3–5 and the first Consequence above are superseded. The
authored/derived split, the four-key schema, both-direction coverage, the
suite-heading bijection, the fixed section set and the delete-on-resolve TODO
rule all stand exactly as decided and stay hard-gated by `status-data`. What
changes is the STATUS OF THE RENDERED FILE.

**`STATUS.md` is gitignored and generated on demand** (`npm run
status:generate`). `generate-status.mjs` no longer offers `--check`; the
`status-data` rule no longer byte-compares anything; `audit-runtimes --check`
validates only the authored data.

Two reasons, the second decisive:

1. **A committed copy serialises unrelated PRs.** STATUS.md derives from EVERY
   package manifest, so any merge invalidates every open PR's copy: PR A
   touches package X, PR B touches package Y, each regenerated correctly
   against its own base — A merges and B is stale through no fault of its own,
   with the red landing on whoever pushes next. This is the same shape as the
   committed GJS bundles, but the bundles earn that cost (a ~20-minute rebuild
   a human must decide to run) and fire only when an *inlined* source changes;
   a one-second render that stales on *any* manifest edit does not.
2. **The derived numbers are not reproducible across correct checkouts.** They
   are read off the DISK — directory listings under `examples/`, `showcases/`,
   `tests/` — not off git. The commit that introduced the generator baked `68`
   examples from a working tree carrying untracked scratch directories against
   the `63` a clean checkout counts, and the freshness check went red on its
   own introducing PR for a reason no author could have avoided. A
   reproducibility contract over an input set that includes untracked files is
   not enforceable; making it enforceable would mean deriving from `git
   ls-files` and giving up the ability to render a work-in-progress tree.

Removing the artifact removes the whole failure class rather than managing it.
It costs nothing that was being paid for: the readers of the snapshot are
agents and maintainers who can render it in a second, the authored data is
better read as data, and the one machine consumer was rewired to the numbers
(`website/scripts/generate-coverage.mjs` now calls the generator's exported
`statusSummary()` instead of parsing the Markdown table — no file needed, and
no lossy `33 (80%)` → `33` round trip).

**Do not reintroduce a freshness comparison** against a file that is not in
git, and do not re-commit the render "just so it is readable on GitHub":
readability was the only argument for tracking it, and it is answered by the
authored data plus one command.
