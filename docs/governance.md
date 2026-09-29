# Governance — the long form

> The root [AGENTS.md](../AGENTS.md) § Governance carries these rules in short form and
> stays authoritative. This file keeps the reasoning each one was written from — in
> particular WHY the required-check set is exactly three, and why every `gjsify.*`
> declaration needs a registered conformance rule.

## Governance — non-negotiable

|doc: update AGENTS.md immediately on any architectural decision (package boundaries, API patterns, build, deps, cross-cutting) — never leave drift between sessions
|adr: decisions that span multiple pillars/repos, change a published contract (versioning, tiering, artifact strategy), or scope a whole track get an ADR under `docs/adr/` (numbered, MADR-style) BEFORE implementation; follow-up work tracked under `status/open-todos/` (one file per area — see its README for which one); AGENTS.md still gets its update when the change lands
|tier: every published pkg declares `package.json#gjsify.tier` — 1 core (stability promise) / 2 product (best effort) / 3 experimental (no promise; new axes start here) per ADR 0003; deps+optionalDeps must point to same-or-lower tier (devDeps/optional peers are the seams; `@gjsify/node-gi` hard-deps forbidden per ADR 0005); enforced by `scripts/audit-runtimes.mjs --check` in CI; membership derived from the manifests (`npm run status:generate`)
|required checks: `main` is branch-protected and exactly THREE checks block a merge — **`CI gate (GJS)`** (`main.yml`), **`Detect runtime-triplet drift`** (`audit-runtimes.yml`), **`Lint commit messages`** (`commitlint.yml`). That set is not a preference: a required check that does not RUN on a PR blocks it forever ("Expected — waiting for status"), so only the three workflows with NO `paths:` filter on their `pull_request` trigger are eligible. Everything path-filtered (`node-gi`, `napi`, `prebuilds`, `deploy-docs`, `cli-cross-platform`) stays ADVISORY — read it before merging; it cannot be required without first moving its `paths:` from the trigger down to the jobs. Requiring a matrix leg by name is equally out: its check name carries the unexpanded `${{ matrix… }}` when skipped. **`CI gate (GJS)` is the only job in `main.yml` whose exit code is a verdict** — `ci-summary` reports and never gates (it was GREEN next to a red `Build Fedora 44` on #910, so requiring it buys a false green). The gate treats `skipped` as pass (selective CI working) and `cancelled` as fail (a superseded run demonstrated nothing), and its first step re-derives the job list from `main.yml` and fails if its own hand-written `needs:` misses one — a job outside the gate is a job that cannot block a merge. WHY AT ALL: with an empty required set `gh pr merge --auto` does not wait, it merges instantly; that is how #910 landed with 12 checks still running |merge queue: all three workflows also trigger on `merge_group`, so the ruleset can turn a queue on without a required check waiting forever on the queue commit. Whether to is § Concurrent PRs' question; its "~25 min per pass" predates the build/verify/examples split, so re-measure the gate's wall time first.
|declarations: `gjsify.runtimes` (runtime axis), `gjsify.platforms` (OS axis), `gjsify.headless` (intra-GJS layering) and `gjsify.prebuilds` are per-package declarations, each MACHINE-CHECKED — full model + every invariant in § Runtime & platform model, which is authoritative. No declaration without a check; no promised prebuild target without a real, loadable artifact (or an explicit reasoned `platformsUncommitted` entry) behind it
|manifest-conformance: every "does this DECLARATION match reality" check is a RULE in ONE registry — `@gjsify/manifest-conformance` (`packages/infra/manifest-conformance/`, plain committed `lib/*.mjs`, NO build, the `@gjsify/resolve-npm` shape). Each rule declares the manifest `fields` it governs; the `field-coverage` rule DERIVES the set of `gjsify.*` keys declared across the tree and FAILS on any key no rule claims — a new declaration kind cannot be added without a check, which is the failure every rule here was written in reaction to. Honest escape: `scripts/manifest-conformance/unchecked-fields.mjs`, a key → REASON ledger (reason mandatory, printed every run, FAILURE the moment a rule claims the key or the field stops being declared). SCOPE decides where a rule lives: `portable` (manifest + files + binaries only — `package-outputs`, `prebuild-artifacts`, `headless`, `field-coverage`, `portable-scripts`, `prebuild-libc`, `storybook`) lives in the package and is correct in any consumer tree; `repo` (`runtimes-drift`, `runtimes-reachability`, `curated-alias-routing`, `tier`, `platforms-ci`, `refs-pin`) knows THIS repo's layout and stays in `scripts/`. REGISTRATION ≠ SELECTION: `package-outputs` + `refs-pin` register (so coverage sees their fields) but are not selected by `audit-runtimes --check` (post-condition on a built tree / needs initialised submodules). **The CI gate stays a plain Node SCRIPT, never a CLI command**: `audit-runtimes.yml` runs `--check --strict` on EVERY `pull_request` with no `paths` filter, with NO install and NO build — routing it through the committed `dist/cli.gjs.mjs` would reintroduce exactly the staleness circularity `verify-committed-bundles.mjs` exists to break (a rule added in source but not rebuilt into the bundle would silently not run). `node scripts/audit-runtimes.mjs --rules` lists the registry
|status: the project status snapshot is AUTHORED DATA in `status/` (per-package status prose in `status.json`, suite notes, open TODOs under `status/open-todos/` — one file per area — upstream patch candidates, section fragments, the ordered `status/priorities/` list — one file per item) — ADR 0016 + amendment. Everything derivable (package lists, tiers, runtime slots, platforms, GNOME-lib usage, every count) is derived from the manifests + tree by `npm run status:generate`, which renders a GITIGNORED `STATUS.md` view; the render is NEVER committed and carries NO freshness check (it derives from every manifest, so a tracked copy would stale on any merge, and its counts read the disk rather than git). The `status-data` conformance rule (in `audit-runtimes --check`, every PR) validates the DATA: coverage both directions, no restated derivables, suite-heading↔dir bijection, no resolved-TODO corpses. Open TODOs and priorities are split one-file-per-topic/-item rather than one growing file, because either used to be edited by nearly every PR — see "Project status & CHANGELOG.md Maintenance". Still NOT a log: per-change narrative → the commit message + CHANGELOG.md.
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
whose purpose is to protect one generated file — and `status/open-todos/`
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

**This example is no longer hypothetical — it was executed** (ADR 0002, second
amendment). Both bundles are untracked and the stack above went with them:
`post-rewrite` and its e2e, the two per-job version checks, the
`rebuilt-bundles` recovery apparatus, and most of `pre-commit`. Roughly 2,000
lines deleted, nothing added. Two pieces stayed, and the reason is the useful
half of the lesson: `affected.gjs.mjs` is still committed because the `changes`
job boots it before any install, so the shrunken hook and the rebuild-and-compare
still have a subject — and the cache excludes stayed because the build-cache key
cannot see one of the bundle's inputs, which was never about the artifact being
committed. **Removing a mechanism removes its guards; it does not remove the
guards that were only standing nearby.**

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

## Concurrent PRs and checks that score a shared number

> Root [AGENTS.md](../AGENTS.md) § Writing agent context files carries the rule this
> section is the reasoning for. Issue #1157 is the thread.

A required check reads exactly one tree: `main` plus **one** branch's diff. It never sees
the other open branches, and `main`'s ruleset sets
`strict_required_status_checks_policy: false`, so a branch is not required to be up to
date before merging and nothing re-measures at merge time. For a check that asserts a
FACT about a diff — this declaration matches that file, this workflow block is valid
shell — that is harmless: the fact stays true however the merge orders.

For a check that scores a **shared number**, it is not. Any slack the number carries can
be spent in full by two branches at once, and the second merge lands a state neither CI
run measured. Both PRs are green, the merge is clean, and `main` is red for a reason that
appears in neither diff. Per the incident in #906, every open PR then fails on `main`'s
reason while looking like its own diff is broken.

**Two checks in `Detect runtime-triplet drift` carried such a number. Nothing else does**
— audited script by script; every other check in that job fails per item, on a fact, and
is immune by construction. They were resolved differently, on purpose.

### `check-comment-budget` — de-gated (#1166)

A comment-to-code ratio over a whole tree is the worst case: ~500 unrelated files feed one
counter, so any two PRs touching the same pillar contend. Probe-merged in #1157: `main` at
5014/8678 = 0.578, `main` + #1152 + #1156 at 5060/8671 = 0.584, over a 0.583 ceiling. Two
further facts came out of that probe and neither was guessable from the PRs' own deltas —
#1156 lost 27 lines of headroom by **deleting ~10 code lines** and adding no comment at
all (it is a ratio, so removing code raises it), and a third open PR removed comment lines
net, so the set that overflowed was not the set that landed.

The fix was not to give the counter slack. It was to notice that the check scores a
**proxy** rather than a fact — moving a full-line comment to the end of a code line drops
the comment count and leaves the code count untouched, and ~1670 trailing comments are
already invisible to it — and that blocking power over unrelated work is more than a proxy
earns. CI runs `--warn`: the table plus one annotation per over-ceiling tree, exit 0. The
ledger's own integrity still fails, because a stale or missing ceiling is a fact.

Adding a margin to the ceilings was considered and rejected: it weakens the ratchet by
exactly its own size, and it is a second, weaker fix for a problem de-gating already
closed.

### `check-agent-context-size` — from an exact ledger to a base-relative check

This one stays a gate: it asserts a fact with a real cost behind it (past 32 KiB Codex
truncates the tail with no warning), so de-gating was not on offer. Per-file byte ceilings
first looked immune — different files never contend — but the shape was the same as
`check-comment-budget`'s, and it was reproduced rather than argued: ceiling 955, a cleanup
takes the file to 907 and does not re-baseline, two PRs then add 35 bytes each in different
paragraphs. Both green, merge clean, `main` at 979 over 955.

**The original fix (2026, retired below): have no slack.** A committed ledger
(`status/agent-context-budget.json`) held one line per file, and a file BELOW its ceiling
failed too, with `--update` named in the message. At zero slack every size change had to
edit that path's line, so two concurrent changes to the SAME file collided there and git
refused the merge — the ledger was the interlock, and the check never had to see a branch
it was not run on. Measured both ways: +35 B and +41 B conflicted in the ledger and were
blocked.

**What that fix cost.** The ledger is a single aggregated file, and per-file exactness did
not change that *any* touch to *any* context file meant an edit to *that one JSON file* — two
PRs shrinking two DIFFERENT context files still collide there, on the file itself, not on a
shared byte count. 77 of the commits touching an AGENTS.md since 2026-09-01 edited nothing
else: the ledger line, following a file that had usually only SHRUNK.

**The current fix: compare to the PR's own base instead of a shared ledger.**
`git show $BASE:<path>` gives each file's size where the branch forked (or, on a push to
`main`, at the immediately preceding commit); growing past `GROWTH_TOLERANCE` (512 B — large
enough that a typo fix never trips it, small enough that a new paragraph does) fails unless a
commit in range carries `Context-Budget: grow <path>`. A shrink needs no companion edit
(there is no ledger line to update), so the 77-commit class is gone by construction. Two
branches each growing the SAME file past tolerance still each fail on THEIR OWN diff — no
shared state to collide over, so nothing here is a repeat of `check-comment-budget`'s
whole-tree-aggregate mistake: the number scored is per file per branch, never summed across
branches.

**Residual, stated because it is real — narrower than before, not gone.** Two branches that
each grow the SAME file by the same amount, both within tolerance, land a combined jump
neither PR's own run measured — the base-relative shape of #1157 one level down. The
push-to-main run is what still catches it: on `push`, BASE is the immediately preceding
`main` commit, so the very next commit to touch that file is compared against the state the
first merge actually left, not against the fork point either PR branched from. That trades a
possible red `main` for removing the ledger PRs were colliding over on every ordinary edit —
the same trade-off `check-comment-budget` made by de-gating entirely, applied here by moving
the collision point later rather than removing it. Closing it fully still needs
`strict_required_status_checks_policy: true` or a merge queue — both were weighed and both
lose to the arithmetic in § PR size above: a full pass is ~25 minutes, and every merge into
`main` would force a re-run of every open PR.

**The cost, stated because it is paid by everyone.** Ordinary edits — a typo, a reworded
sentence, a link, most single-paragraph rewrites — pay nothing: no ledger to touch, no
`--update` to run. Only real growth past 512 bytes pays, with a one-line trailer rather than
a JSON commit.

### An anchor grep over workflow comments — DECLINED, never built

Recorded so the next person to propose it finds the measurement instead of re-deriving it.
A real defect prompted it: `macos-suites.yml`'s SIP note claimed "Measured on the
darwin-x64 VM" with no date, no image and no run, and was contradicted on 2026-09-19 by the
repository's own probe without anything changing. The obvious gate is a rule that any
measurement verb in a workflow comment must carry an anchor — a date, a run id, a `#NNN`, a
SHA or a version.

**Enumerated before proposing, and the arithmetic killed it.** Over `macos-suites.yml` and
`windows-suites.yml` the pattern flags **14 paragraphs; 12 are false positives**, in three
kinds — claims the stating step RE-PROVES every run (the brew-formula rows, the
elevated-runner note, the two steps whose whole job is printing the host), claims that CITE
an anchored record elsewhere (`status/open-todos/`, an adjacent dated paragraph), and
prose that is rationale rather than measurement. Two were real: the SIP note, and a
`windows-suites.yml` motivation that needed an event anchor, both fixed by hand.

A check wrong 12 times in 14 is worse than no check: it is the shape this section already
de-gated `check-comment-budget` for, one step further along — people learn to skip it, and
the next real finding lands on a check nobody reads. **And the false-positive rate is
itself the finding.** The set is two rather than fourteen BECAUSE the habit is already
right here: a claim that can rot gets a probe, and the comment names the probe. That is a
convention to state once, which `docs/code-anti-patterns.md` § *A rule whose premise died
and whose conclusion did not* now does, not a grep to run forever.

Revisit only if the real instances stop being countable on one hand.

### The rule this generalises to

Before putting a number behind a required check, ask whether two branches can each spend
its slack in full. If they can, either the check should not gate, or its ledger must be
exact enough that concurrent spenders collide in git first. A whole-tree or whole-repo
aggregate is structurally blind to concurrent PRs; only per-item exactness gives the merge
something to trip over.

**A third option, taken by `check-agent-context-size`'s later revision: give the check no
shared state to collide over at all.** Compare each branch's diff to ITS OWN base rather than
to a committed number, and two branches cannot collide on a ledger that does not exist —
every PR is scored against a snapshot only it ever changes. The price is the mirror of an
exact ledger's guarantee: a combined-but-individually-tolerable overshoot is not blocked at
PR time, only caught one generation later, on the push that lands it over. That trade is
worth it exactly when the shared ledger's OWN upkeep — not its slack — is the thing
generating the most PR churn, which per-item exactness does not fix (§ `check-agent-context-
size`, "what that fix cost").

## Agent context budget

The root AGENTS.md reached **277 KB** before it was split, one defensible paragraph at a time.
That is the whole argument for a ceiling: no single addition was wrong, and the sum was
unreadable.

`scripts/check-agent-context-size.mjs --check` holds a 32 KiB hard cap — `project_doc_max_bytes`,
where Codex silently truncates the tail with no warning — plus a growth check: no file may grow
more than 512 bytes past its size at the PR base (`git show $BASE:<path>`; `HEAD^` on a push to
`main`) without a `Context-Budget: grow <path>` commit trailer. Full mechanism, and why it
replaced a committed per-file ledger: § Concurrent PRs → `check-agent-context-size`.

**Base-relative, not an upper bound, and that is deliberate.** A file that shrank needs no
companion commit — there is no ledger line to fall out of date — so the check only ever
fires on REGROWTH, never on someone else's cleanup landing first.

**No list of over-target files belongs in a context file.** Several are over the 20 KB target,
the check PRINTS which on every run, and a list written down goes stale as OTHER files grow —
so the gate catches regrowth instead of claiming the target is met.

**Growth still needs a reviewed trailer, not a bigger number.** `Context-Budget: grow <path>`
is the one-line acknowledgment that used to be a ledger commit — small enough to write inline
with the change that needs the room, unlike a JSON file nothing else in the diff explains.
