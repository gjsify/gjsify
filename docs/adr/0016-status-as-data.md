# ADR 0016 — STATUS.md as generated output: authored status data + derived facts

- **Status:** Accepted (2026-07-31)
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
