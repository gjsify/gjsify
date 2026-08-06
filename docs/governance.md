# Governance — the long form

> The root [AGENTS.md](../AGENTS.md) § Governance carries these rules in short form and
> stays authoritative. This file keeps the reasoning each one was written from — in
> particular WHY the required-check set is exactly three, and why every `gjsify.*`
> declaration needs a registered conformance rule.

## Governance — non-negotiable

|doc: update AGENTS.md immediately on any architectural decision (package boundaries, API patterns, build, deps, cross-cutting) — never leave drift between sessions
|adr: decisions that span multiple pillars/repos, change a published contract (versioning, tiering, artifact strategy), or scope a whole track get an ADR under `docs/adr/` (numbered, MADR-style) BEFORE implementation; follow-up work tracked in `status/open-todos.md`; AGENTS.md still gets its update when the change lands
|tier: every published pkg declares `package.json#gjsify.tier` — 1 core (stability promise) / 2 product (best effort) / 3 experimental (no promise; new axes start here) per ADR 0003; deps+optionalDeps must point to same-or-lower tier (devDeps/optional peers are the seams; `@gjsify/node-gi` hard-deps forbidden per ADR 0005); enforced by `scripts/audit-runtimes.mjs --check` in CI; membership derived from the manifests (`npm run status:generate`)
|required checks: `main` is branch-protected and exactly THREE checks block a merge — **`CI gate (GJS)`** (`main.yml`), **`Detect runtime-triplet drift`** (`audit-runtimes.yml`), **`Lint commit messages`** (`commitlint.yml`). That set is not a preference: a required check that does not RUN on a PR blocks it forever ("Expected — waiting for status"), so only the three workflows with NO `paths:` filter on their `pull_request` trigger are eligible. Everything path-filtered (`node-gi`, `napi`, `prebuilds`, `deploy-docs`, `cli-cross-platform`) stays ADVISORY — read it before merging; it cannot be required without first moving its `paths:` from the trigger down to the jobs. Requiring a matrix leg by name is equally out: its check name carries the unexpanded `${{ matrix… }}` when skipped. **`CI gate (GJS)` is the only job in `main.yml` whose exit code is a verdict** — `ci-summary` reports and never gates (it was GREEN next to a red `Build Fedora 44` on #910, so requiring it buys a false green). The gate treats `skipped` as pass (selective CI working) and `cancelled` as fail (a superseded run demonstrated nothing), and its first step re-derives the job list from `main.yml` and fails if its own hand-written `needs:` misses one — a job outside the gate is a job that cannot block a merge. WHY AT ALL: with an empty required set `gh pr merge --auto` does not wait, it merges instantly; that is how #910 landed with 12 checks still running
|declarations: `gjsify.runtimes` (runtime axis), `gjsify.platforms` (OS axis), `gjsify.headless` (intra-GJS layering) and `gjsify.prebuilds` are per-package declarations, each MACHINE-CHECKED — full model + every invariant in § Runtime & platform model, which is authoritative. No declaration without a check; no promised prebuild target without a real, loadable artifact (or an explicit reasoned `platformsUncommitted` entry) behind it
|manifest-conformance: every "does this DECLARATION match reality" check is a RULE in ONE registry — `@gjsify/manifest-conformance` (`packages/infra/manifest-conformance/`, plain committed `lib/*.mjs`, NO build, the `@gjsify/resolve-npm` shape). Each rule declares the manifest `fields` it governs; the `field-coverage` rule DERIVES the set of `gjsify.*` keys declared across the tree and FAILS on any key no rule claims — a new declaration kind cannot be added without a check, which is the failure every rule here was written in reaction to. Honest escape: `scripts/manifest-conformance/unchecked-fields.mjs`, a key → REASON ledger (reason mandatory, printed every run, FAILURE the moment a rule claims the key or the field stops being declared). SCOPE decides where a rule lives: `portable` (manifest + files + binaries only — `package-outputs`, `prebuild-artifacts`, `headless`, `field-coverage`, `portable-scripts`, `prebuild-libc`, `storybook`) lives in the package and is correct in any consumer tree; `repo` (`runtimes-drift`, `runtimes-reachability`, `curated-alias-routing`, `tier`, `platforms-ci`, `refs-pin`) knows THIS repo's layout and stays in `scripts/`. REGISTRATION ≠ SELECTION: `package-outputs` + `refs-pin` register (so coverage sees their fields) but are not selected by `audit-runtimes --check` (post-condition on a built tree / needs initialised submodules). **The CI gate stays a plain Node SCRIPT, never a CLI command**: `audit-runtimes.yml` runs `--check --strict` on EVERY `pull_request` with no `paths` filter, with NO install and NO build — routing it through the committed `dist/cli.gjs.mjs` would reintroduce exactly the staleness circularity `verify-committed-bundles.mjs` exists to break (a rule added in source but not rebuilt into the bundle would silently not run). `node scripts/audit-runtimes.mjs --rules` lists the registry
|status: the project status snapshot is AUTHORED DATA in `status/` (per-package status prose in `status.json`, suite notes, open TODOs, upstream patch candidates, section fragments) — ADR 0016 + amendment. Everything derivable (package lists, tiers, runtime slots, platforms, GNOME-lib usage, every count) is derived from the manifests + tree by `npm run status:generate`, which renders a GITIGNORED `STATUS.md` view; the render is NEVER committed and carries NO freshness check (it derives from every manifest, so a tracked copy would stale on any merge, and its counts read the disk rather than git). The `status-data` conformance rule (in `audit-runtimes --check`, every PR) validates the DATA: coverage both directions, no restated derivables, suite-heading↔dir bijection, no resolved-TODO corpses. Still NOT a log: per-change narrative → the commit message + CHANGELOG.md. See "Project status & CHANGELOG.md Maintenance"
|simplicity: every guard in this repo was justified ALONE, and what a contributor pays is the SUM. Before adding a check, step or artifact, ask what it lets you DELETE; periodically ask whether the whole arrangement has a simpler SHAPE. A guard whose job is watching another mechanism is the smell — removing the mechanism removes both. Long form + the worked example below
|polyfills: browser-compat patches belong in packages, not examples — add to `@gjsify/dom-elements` or the right pkg
|root-cause: fix bugs in the core package in the SAME PR that exposed them — no "known limitation" notes, no skip-guards, no TODO-for-later (workarounds ossify); examples/tests/CI exist to surface impl gaps
|scope: expanding PR scope is the *expected* cost, not a reason to defer — goal is `@gjsify/*` running arbitrary npm packages unmodified on GJS
|exceptions (narrow, documented per case): (a) non-standard Node-internal hack (`process.binding`, V8-only monkey-patching, C++ addons) → wrap/skip at consumer with explanatory comment; (b) upstream GJS/SpiderMonkey gap → track in `status/upstream-patch-candidates.md`; (c) cross-cutting rewrite → Plan + user confirm + split PRs, but still land a minimal root fix in the feature PR

**TypeScript version invariant.** Root + EVERY workspace (incl. all integration tests) declares `typescript: "^6.0.3"` — no 5.x carve-out; enforced by the CI `gjsify upgrade --check --exclude-workspace '@gjsify/integration-*'` step (the glob remains only for intentionally-drifted NON-typescript pins — `undici`'s `ws`, `mcp-typescript-sdk`'s `zod`). The 5 formerly-5.x-pinned integration tests were empirically retested green on TS 6 (both node and gjs), moved back to `workspace:^` deps and re-included as full workspace members — they exercise LOCAL workspace code again, not a published snapshot. Only remaining exclusion: `!tests/integration/nativescript` (heavy NS toolchain). `gjsify install` hoists ONE `typescript` per name to the root, so uniform declarations hoist cleanly. Do NOT reintroduce a 5.x pin + root `overrides` scoping — that triggers a per-workspace `gjsify-lock.json` requirement under `--immutable` that no integration test commits (the failure that red-lined the original v0.7.2 carve-out attempt). `@gjsify/tsc`'s `TYPESCRIPT_VERSION` MUST track this range; when bumping workspace-wide, update every `package.json` (incl. `templates/*` + integration tests) AND verify lockfile + `gjsify run check` in the same PR — declaration-vs-resolution drift produced the v0.7.2 PR #385 CI break. (Deepkit note: `@deepkit/type-compiler@^1.0.19` instruments `typeOf<T>()` correctly against TS 6 — the "invalid `function extends()`" warning concerns the reflection emitter on user code, § Build Deepkit.)

## Keeping CI simple — the standing question

CI here is deliberately broad, and every piece of it was added for a reason that
was good **at the time and on its own**: a Fedora build, byte-reproducibility,
four test shards, four e2e shards, browser, cross-runtime, macOS and Windows
legs, plus the guards around each. Nobody ever added complexity on purpose.
That is exactly why it accretes — the cost of any single addition is small, and
the cost a contributor actually pays is the **sum**.

So the rule is not "add fewer checks". Checks are how this repo knows anything;
the ones that hold a real invariant stay, and § Governance's "no declaration
without a check" is not weakened by this section. The rule is that **two
questions get asked, and the second one gets asked periodically rather than
never**:

1. *What does this let me delete?* A new check that only adds is a net cost.
2. *Does the whole arrangement have a simpler shape?* This is the one that never
   gets asked, because every individual piece looks justified when you examine
   it individually.

### The tell: a guard whose job is watching another mechanism

When a mechanism needs guards, and those guards need guards, the guards are not
the problem — the mechanism is. Removing it removes the whole stack at once,
which is the only kind of simplification that actually compounds.

### The worked example — ADR 0002, the committed CLI bundle

`packages/infra/cli/dist/cli.gjs.mjs` was committed for one genuine reason: a
fresh clone must run `gjsify install` before anything is built, and a committed
GJS bundle was the only thing in git that could do it. Correct, and it stayed
correct for a long time.

What it accumulated around itself, each piece justified on its own:

- a `pre-commit` hook that rebuilds and auto-stages it, on a four-path heuristic
  that is documented as BEST-EFFORT because the bundle inlines the whole
  workspace-dep closure;
- a `post-rewrite` hook for the two rewrites `pre-commit` structurally cannot
  see (`rebase` stages nothing; `--amend` presents an empty staged set);
- two e2e suites, ~1000 lines, testing those hooks — one of which fork-bombed a
  developer machine into a global OOM while being written;
- a byte-for-byte rebuild-and-compare step in CI, with an artifact upload and a
  documented recovery procedure for when it disagrees;
- two "does the bundle boot and report the right version" steps in every job;
- three build-output cache exclusions, plus a "re-assert committed sources over
  the build cache" step added after a `restore-keys` fallback served a stale
  copy to every job;
- and `docs/build-artifacts.md`, most of which exists to explain the above.

Each of those is a reasonable answer to a real failure. The sum is a subsystem
whose purpose is to protect one generated file — and `status/open-todos.md`
still records four distinct ways it went stale anyway, including a release cut
restaling every open PR by a single byte, and a rebase silently text-merging two
minified bodies with no conflict and no size anomaly.

Asking question 2 produces a different answer than any amount of asking question
1: **do not commit the artifact**. A fresh clone bootstraps with a pinned
published release — which is what a developer with only GJS on their machine
already does — and the entire stack above goes away with the file it was
protecting. Not one guard improved: the whole class retired.

That is the shape to look for. It is rarer than an incremental fix and it is
worth stopping to look for, because the incremental fix is always available and
always locally correct.

### What this does NOT license

- Deleting a check because it is inconvenient, or because it has never failed.
  A check that has never failed on a real defect is a candidate for scrutiny,
  not for deletion; a check that has caught something is evidence, not overhead.
- Weakening a check so it passes. § Testing: never weaken a test to make it
  pass — and a check whose input set is DERIVED must fail when that set is
  empty, or it "passes" while checking nothing.
- Removing the INCIDENT that justifies a rule. Compressing away the reason is
  how a rule gets simplified back into the bug it prevents; move it one hop into
  `docs/`, never delete it.

## PR size — the measurement behind "prefer few large ones"

> Root [AGENTS.md](../AGENTS.md) § PR size carries the rule.

CI here is deliberately broad — Fedora build + `verify-committed-bundles` + four
test shards + four e2e shards + browser + cross-runtime + macOS/Windows legs —
so a full pass is ~25 minutes. That cost is per PR, not per commit.

**Measured on the Windows-port work:** four stacked PRs cost three main-merge
rounds and two bundle rebuilds before anything landed. Every merge into `main`
in between forces the next PR in the stack to re-merge, and — while
`packages/infra/cli/dist/*.gjs.mjs` are tracked — a PR touching
`packages/infra/cli/src/` must also rebuild and re-verify the committed bundle.

That second cost is what ADR 0002 removes: with the bundle untracked, a CLI PR
becomes a source-only diff and re-merging is a normal text merge rather than a
20-minute rebuild. The "prefer few large PRs" conclusion survives on the
25-minutes-per-pass arithmetic alone.
