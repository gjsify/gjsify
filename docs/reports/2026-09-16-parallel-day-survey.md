# Parallel-day survey 2026-09-16 — what eleven merged PRs left behind

A step-back pass over one day of parallel agent work in `gjsify/gjsify`: **eleven** PRs merged
(`bc78d1b689..3e12aefe1a` — eleven commits, eleven distinct PR refs: #1682-#1691 and #1693) plus
a `ts-for-gir` v5.2.0 release. This file is the
*why + priority* record for the refactor that follows; the ADRs are the decisions and
`status/open-todos.md` tracks the work.

> **Every reading below is measured at `b87098a17f`**, and every `file:line` is relative to that
> one commit. Where something was *not* measured it says so on the spot and again in § 8.
> Line numbers are a convenience and not the claim: where a durable anchor existed
> the citation names the function, const or quoted string to ripgrep for instead. The reason is
> this document's own history — its first draft was measured at `3e12aefe1a`, and #1692, #1694
> and #1697 merged six minutes later, moving most of its line numbers and falsifying two of its
> claims. The day's range (`bc78d1b689..3e12aefe1a`) is unchanged, because that is the subject;
> the three PRs that merged after it are folded into the state readings.

**It contains no refactoring.** Its job is to decide what the next change does — specifically,
what may ride along with the ADR 0053 clause 5/7 flip and what must not.

## Verdict

The day's output is sound where it is code: no two PRs contradict each other in the tree, and
the guard family that grew fastest grew for a good reason. The damage is in the documents. Four
ADRs were written in parallel against a tree that other PRs were changing underneath them, and
**five separate passages now describe a state that a PR merging hours later removed** (§ 5.1).

Three findings change what the next change should be:

1. **Clause 5's condition is now met on `main`** (§ 1.1). #1692 merged and the divergence
   ledger is empty, so the sequencing constraint this survey opened with is discharged: the
   flip is no longer blocked, only unwritten.
2. **Flipping clause 5 is a package publication and a breaking change, not a status edit**
   (§ 1.2, § 1.4). The parser package is `private: true` and exports its test corpus rather than
   its parser; the plugin that must consume it is published tier-1 with a public `./resolve`
   subpath that clause 7 deletes. ADR 0053 anticipated neither.
3. **ADR 0060 proposes work that was already done before it merged** (§ 4.7). Its P2 — re-verify
   SRI on a cache hit — is implemented in `packages/infra/cli/src/utils/install-tarball-cache.ts`:
   both `getCachedTarball` (`:114`) and `getForeignCachedTarball` (`:220`) call `verifyIntegrity`.
   Left standing, it will be built twice — PR #1696 is the correction, in flight.

The one item that must not be deferred for tidiness: **two e2e suites skip themselves when
`blueprint-compiler` is absent** (§ 2.4). After the flip that is every host the flip exists to
serve, so the proof would go green by not running. It rides along or the flip proves nothing.

## How this was measured

Read-only, on a worktree at `origin/main` — **`b87098a17f`**, the base named at the top and the
base every citation in this file is relative to. `refs/` submodules and `node_modules` are absent
there, so anything that depends on them is marked *unmeasured* rather than guessed. Counts come
from `git ls-files`, `wc -l` and `grep -c` on tracked files. Two readings step outside that: the
`@girs` closure in § 6.1 calls `registry.npmjs.org`, and ADR 0062's assembly census in § 4.6 was
re-derived by implementing the method the ADR states at `0062:38-41`. Both say so where they are
made. § 8 lists what could not be measured at all.

## 1. The flip: what ADR 0053 clause 5 actually requires

Clause 5 says the in-repo parser runs in SHADOW until it is silent, and becomes authoritative
when it reports no divergence. Read as a status change, flipping it is one edit to one ADR.
Measured, it is a package publication, a breaking change to a published API, and a
re-pointing of four consumers.

### 1.1 The silence now exists on `main` — the block is discharged

**This finding was reversed by a merge.** As first measured at `3e12aefe1a`,
`packages/infra/blueprint/corpus/divergences.mjs` still held one entry —
`rules/29-enum-non-widget.blp`, `Gtk.SizeGroup { mode: horizontal; }` emitting the member name
where the oracle writes `1`, because `PROP_ENUMS` was keyed by the widget vocabulary and
`GtkSizeGroup` is not a widget — and `packages/infra/blueprint/package.json` pinned `@girs` at
5.1.0.

**#1692 merged.** `export const SHADOW_DIVERGENCES = []` (`divergences.mjs`, the last line of
the file), and the doc comment above it now states the reading as a measurement: *"There are
none: every corpus file the in-repo parser emits is byte-equal to the reference compiler's
golden."* `packages/infra/blueprint/package.json` pins `@girs/adw-1` and `@girs/gtk-4.0` at
**5.2.0** (`:14-15`), and 5.2.0 is the release carrying the widget/child-holder tag filter that
extends `PROP_ENUMS` past the widget vocabulary — the exact retirement condition the ledger entry
named.

**Consequence for sequencing: nothing about clause 5 is blocked any more.** The corpus is 35
rule files + 12 reality probes = **47**, and the ledger excuses none of them. What remains is
not a precondition but the work in § 1.2-§ 1.5, none of which #1692 touched.

### 1.2 The build does not import the parser, and cannot today — P1

`packages/infra/vite-plugin-blueprint/src/index.ts:50` shells out to `blueprint-compiler`
through `execa` — search `execa(resolved.file, [...resolved.prefixArgs, 'compile', id]`. The
in-repo parser is imported by exactly one thing —
`scripts/check-blueprint-corpus.mjs` (the `PARSER`/`EMITTER`/`PROJECTOR`/`RESOLVER` consts,
`:569-572`), which loads `src/parser.mjs`, `src/emit-xml.mjs`, `src/project.mjs` and
`src/resolve-ident.mjs` by path. Nothing else in the tree imports it, and
no `package.json` depends on `@gjsify/blueprint`.

That is not merely an unfinished wiring job, because of what the two packages are:

| | `@gjsify/blueprint` (the parser) | `@gjsify/vite-plugin-blueprint` (the build) |
|---|---|---|
| published? | **no** — `private: true` (`package.json:5`) | **yes**, tier 1, all three OSes |
| what it exports | the CORPUS only: `.` → `corpus/manifest.mjs`, plus two expectation subpaths (`package.json:8-12`) | `.`, `./resolve`, `./types` |
| the parser itself | **not exported at all** — `src/*.mjs` is outside the `exports` map | — |

So "the plugin calls the parser instead" requires, in order: un-privating `@gjsify/blueprint`,
adding `src/parser.mjs` + `src/emit-xml.mjs` + `src/resolve-ident.mjs` to its `exports`, and a
**first publish to npm of a new package name**. A published tier-1 package cannot depend on a
private one.

ADR 0053 § Implementation already says "the parser is a package of its own;
`@gjsify/vite-plugin-blueprint` becomes its consumer and keeps its public interface". What it
does not say is that the package it describes is private and exports its test corpus rather
than its parser. That gap is the real content of the flip.

### 1.3 The plugin gains `@girs` as a runtime dependency — P1, and it argues with ADR 0002

`packages/infra/blueprint/src/resolve-ident.mjs:110-131` imports `@girs/adw-1/vocabulary` and
`@girs/gtk-4.0/vocabulary`. Those are the emitter's enum/ARIA lookups — Amendment 1 chose them
over a typelib precisely so the shadow run needs no GNOME on the host, and that reasoning is
sound. But it moves the dependency rather than removing it: today the plugin needs a *binary on
PATH*, after the flip it needs *two pinned `@girs` packages in `node_modules`*.

For this repo that is free (`gjsify install` has run). For a **cold bootstrap from the published
CLI** — ADR 0002, which ADR 0053 lists in its own Related line — it is not obviously free, and
this survey could not measure it: `node_modules` is absent in a read-only worktree, so the
installed weight of `@girs/gtk-4.0` + `@girs/adw-1` and whether a bootstrap already resolves
them is **unmeasured**. It must be measured before the flip, not after.

### 1.4 Deleting `resolve-compiler.ts` is a breaking change with four consumers — P1

Clause 7 calls this a deletion of 505 lines that "exist only to find a binary". It is also a
published entry point, `@gjsify/vite-plugin-blueprint/resolve`
(`packages/infra/vite-plugin-blueprint/package.json:14-17`), with four callers:

| consumer | where — the anchor to search for | what breaks |
|---|---|---|
| the plugin itself | `src/index.ts:9,24` — two `from './resolve-compiler.js'` re-export blocks | re-exports 6 symbols from its root |
| `gjsify system-check` | `check-system-deps.ts:21` `import { resolveBlueprintCompiler } from '@gjsify/vite-plugin-blueprint/resolve'`, and `checkBlueprintCompiler()` at `:544-575` | the blueprint probe |
| e2e `library-blueprint` | `run.mjs:46-48`, the `const SKIP =` chain | its SKIP condition |
| e2e `create-app` | `run.mjs:98-100`, `function hasBlueprintCompiler()` | skips three templates |

`BlueprintCompileError`, `BlueprintCompilerNotFoundError`, `currentBlueprintHost`,
`formatMissingBlueprintCompiler`, `ResolvedBlueprintCompiler` and `resolveBlueprintCompiler`
are all public today. Removing the subpath is a semver-major event for a tier-1 package, which
is a governance question (`docs/governance.md:12`) and not a cleanup.

### 1.5 The subset is proven over first-party files only — P2, the honest risk

Byte-equality covers 47 files: 35 corpus rules (`corpus/rules/*.blp`) and the 12 real `.blp` in
the tree. Every one of the 47 is first-party. The plugin, however, is published, and clause 3
makes an unrecognised construct a **hard error**. `corpus/refused/` names 15 constructs the
parser deliberately refuses today — among them `inline-menu.blp`, `internal-child.blp`,
`translation-domain.blp`, `binding-lookup-chain.blp`, `response-flags.blp` and
`closure-value.blp`. (`extern-type.blp` was in that list when this was first measured; **#1694
merged and moved it out**, into four new rule files `32-`…`35-extern-*.blp` — so the set is
still 15, with a different member.)

So the flip converts "works, needs a binary" into "refuses, no binary needed" for any external
consumer whose `.blp` uses one of those. That trade is defensible — it is clause 3's whole
design — but it is a downstream-visible behaviour change that the corpus cannot speak to,
because the corpus contains no third-party file by construction (clause 6 forbids it).

**`status/open-todos.md` already states this as the open decision** — the paragraph beginning
"The flip is the part with a decision in it" (`:6247-6252`), which says "the flip has to say what
a build does when a real file trips one" — and it remains unanswered. It is the one
question in the flip that no measurement settles.

### 1.6 Honest cost and risk

| | |
|---|---|
| **Cost** | un-private + export the parser; one npm first-publish; re-point 4 consumers; delete 505 lines + a published subpath; re-measure the bootstrap weight; a semver-major on a tier-1 package |
| **Risk, contained** | in-repo builds — all 12 real `.blp` are inside the proven 47 |
| **Risk, real** | external `.blp` using a refused construct now fails the build; `@girs` weight in a cold bootstrap is unmeasured |
| **Blocked on** | **nothing** — #1692 delivered the silence and #1694 moved `extern-type` from refused to accepted; both merged after this survey's first draft |
| **Not a blocker** | the oracle: `blueprint-compiler` stays for stage B and for typelib validation (ADR 0028 § 6, clause 4) — nothing about the flip deletes the binary |

### 1.7 A first-publish caveat worth naming

A brand-new `@gjsify/*` name cannot be created by Trusted Publishing/OIDC alone; the first
version needs a manual bootstrap publish before automation can own it. That is a known
operational step for this org and it belongs in the flip PR's checklist rather than being
discovered on release day. **Unmeasured here** — no registry call was made from this worktree.

## 2. Is clause 7's deletion list still accurate?

Clause 7 makes "done" a deletion list rather than a feature list, which is a good design — it
is falsifiable. Verified item by item against `main`:

| # | clause 7 item | state | accurate? |
|---|---|---|---|
| 1 | `resolve-compiler.ts` + spec, "505 lines" | 268 + 237 = **505**, both present | **yes**, and the count is exact |
| 2 | the line-level `oxlint-disable` in `loading-stack.ts` | present — `// oxlint-disable-next-line gjsify/prefer-blueprint-template` (`:41`) | **yes** — deliberately still open |
| 3 | "the MSYS2 branch of `gjsify system-check`" | see below | **no — misdescribed** |
| 4 | `check-doc-fences.mjs` skip becomes two-stage | still a single skip — `blueprintAvailable()` returns `'blueprint-compiler is not on PATH'` (`:367-369`) | **yes** — not started |

**Nothing has been ticked off by accident.** Item 2 is the one that was at risk: #1690 removed
those disables as a side effect of un-ignoring `**/templates` in `.oxlintrc.json`, and a
reviewer restored them. The restoration also strengthened them —
`packages/framework/adwaita-app/src/loading-stack.ts:36-40` now carries the reason the
suppression must stay line-level and here ("ADR 0053 § 7 names its deletion as one of the
signals that the in-repo parser is done"). That is the right outcome: the marker survived the
change that would have retired it for an unrelated reason.

### 2.1 Item 3 names a file that has never contained it — P2

`packages/infra/cli/src/commands/system-check.ts` contains neither `blueprint` nor `msys2`, and
`git log -S` on both terms over that file returns **no commits**: it has never contained either.

The MSYS2 branch is real, but it lives in two places clause 7 does not name:
`packages/infra/vite-plugin-blueprint/src/resolve-compiler.ts:67-130` (the probe itself) and
`packages/infra/cli/src/utils/check-system-deps.ts:544-575` (the CLI's blueprint check, which
*delegates* to it — `:546` says so explicitly).

So item 3 is not a third deletion. It is **item 1's content, counted twice under a wrong
address**, plus one genuine consumer update in `check-system-deps.ts` that clause 7 never lists.
`status/open-todos.md:6268` repeats the same wrong address, having inherited it — the sentence
"and the MSYS2 branch of `gjsify system-check`".

Correcting this matters beyond tidiness: a deletion list is a completion test, and an item
naming a file that cannot contain it can never be checked off honestly.

### 2.2 The deletion list understates its own blast radius — P2

Clause 7 reads as four independent items. Items 1 and 3 are one deletion with four consumers
(§ 1.4), and `check-system-deps.ts:584-592` carries a comment explaining why
`blueprint-compiler` is deliberately excluded from the generic toolchain list ("NO
blueprint-compiler here: it is checked by `checkBlueprintCompiler()`…") — which becomes dead prose
the moment the build stops needing the binary.

### 2.3 `status/open-todos.md` disagrees with the ADR about the storybook window — P3

`status/open-todos.md:6266` lists "the programmatic storybook window" **inside** the
deletion list (the paragraph beginning "Done is a deletion list, not a feature list"). ADR 0053
clause 7 says the opposite in as many words: it "is a DIFFERENT item … what it needs is a scoping
decision and not a deletion". The todo entry turns a scoping question
into a deletion target. One of the two is wrong and the ADR is the authority.

### 2.4 Two e2e suites will skip on exactly the hosts the flip exists to fix — P1, rides along

`tests/e2e/library-blueprint/run.mjs:46-48` (the `const SKIP =` chain) and
`tests/e2e/create-app/run.mjs:98-100` (`function hasBlueprintCompiler()`) gate themselves on
`resolveBlueprintCompiler()` returning non-null. Today that is correct: no
compiler, no `.blp` build, nothing to test.

After the flip it inverts. The entire point is that macOS and Windows runners — which have no
`blueprint-compiler` — can build `.blp`. Left as they are, both suites would report green by
skipping on precisely the hosts where the new code path is the only thing running. That is the
failure class § 3 is about, arriving as a leftover rather than as a new guard, and it is the
sharpest example in this survey of a gate whose premise a change removes.

**These two skips must be removed in the same PR as the flip.** They are not separable: between
the flip landing and the skips going, the proof is green and empty.

## 3. Duplication among the guards

Several PRs independently added a mechanism for one failure class: **a step that cannot read its
input must not report an answer.** Counted across the tree (not only today's diffs, because the
pre-existing ones decide the duplication question): **15 named mechanisms — 5 in § 3.1, 6 in
§ 3.2, 4 in § 3.3 — plus roughly 20 further "this would pass vacuously" asserts.** *Named* here
means **cited below with a `file:line`**; § 3.3's four other spellings are described rather than
addressed and fall in the "roughly 20". The arithmetic is spelled out, and so is the reading,
because the first draft said 16 against an enumeration of 15 and nothing in the sentence could
catch that.

They do not all share a shape, and that turns out to be the right answer rather than a defect.

### 3.1 Group A — genuinely the same mechanism, five times

The `--require-<tool>` family. Each probes a tool, reads a flag, counts what went unread, and
composes a message:

| flag | file:line | tool |
|---|---|---|
| `--require-oracle` | `scripts/check-blueprint-corpus.mjs:430`, `if (!havecompiler && requireOracle)` | `blueprint-compiler` |
| `--require-pwsh` | `scripts/check-workflow-run-syntax.mjs:468` | `pwsh` |
| `--require-actionlint` | `scripts/check-scaffolded-workflow.mjs:317` | `actionlint` |
| `--require-pass` | `scripts/node-gi-consumer-harness.mjs:626,700` | per-package verdicts |
| `--require-gl` | `packages/node-gi/gtk-runtime-win32-x64/scripts/build-gtk-runtime.mjs:125` | GL implementation |

The duplication is author-acknowledged: `check-scaffolded-workflow.mjs:318` cites
`--require-pwsh` as "the same shape". This is the one place a helper is warranted.

### 3.2 Group B — same class, different layer: healthy, leave alone

`showcase-smoke.mjs:152` (interpreter absent), `publish-readback.ts:326,375` (registry lag),
`hang-watchdog.ts:1-26` (a wedged child), `.github/actions/checkout-ref-submodule/action.yml:150`
(a restored cache tree vs its pin), `install-extraneous.ts:121` (`--immutable`),
`install-tarball-cache.ts:109` (SRI on read).

These rhyme at slogan level and nowhere else. Two of them deliberately do **not** refuse:
`publish-readback` returns a third verdict `unknown` rather than "published", and the tarball
cache returns `null` (a miss) rather than throwing — because a four-minute registry lag and a
cache miss are both legitimate. Collapsing these into one refusal helper would be a regression,
not a cleanup. **No shared abstraction here.**

### 3.3 Group C — same intent, gratuitously different spelling — P2

The "my subject set is empty, so I would pass vacuously" assert is written at least five
different ways across ~20 scripts: `failures.push('…would pass vacuously')`, `fail('…nothing to
check reports green')`, `console.error` + `exit(2)`, a bare `throw`, and a counted positive-fact
rule (`scripts/verify-published-closure.mjs:68-88`).

The more useful finding is underneath the spelling. Two scripts added today —
`scripts/check-lint-visibility.mjs` (exit 2 at `:77,145,173,200,235,249`, exit 1 at `:295`) and
`scripts/check-source-visibility.mjs` (exit 2 at `:150,171,184,317,491`, exit 1 at `:598`) —
distinguish **exit 2 = "could not measure"** from **exit 1 = "measured, found findings"**. That
distinction is exactly what makes this failure class machine-readable, and it is applied
systematically by 2 scripts out of ~20 and documented nowhere. (The `SELF-TEST FAILED` block
near the top of `check-source-visibility.mjs` is *not* one of them: a broken self-test is a
measurement that failed, and it exits **1**. The convention is finer than a glance at the file
suggests, which is another argument for writing it down.)

A third script reached the same rule independently. `scripts/check-foreign-platform-paths.mjs:91`
exits 2 when `--root` is given with no directory after it, and its comment says why in the
convention's own terms — *"Falling back to the real repo root would answer a question about
ANOTHER tree, in green."* Three scripts converging on one unwritten rule is the case for writing
it down, not against it.

### 3.4 Verdict: one narrow helper, one convention — and no grand abstraction

**A general "refusal helper" is not warranted.** The refusal itself is one line; the value is in
the prose naming the specific tool, the specific incident and what went unread. A helper taking
all of that as parameters is a formatting shim over arguments that are already the whole content.

Two things are worth doing:

1. **`requireTool({ tool, probe, flag, unreadCount, subject })`** for group A's five call sites
   (§ 3.1). It must express the probe command, the flag's own name, fatal-vs-announced-skip, and
   the **count of what went unmeasured** — the part each currently reimplements and the only part
   that makes the message actionable. *Cost: small; five mechanical call-site changes.*
2. **Write the exit-code convention down and gate it** — 2 = could not measure, 1 = measured and
   failed — in the script conventions, enforced over `scripts/*.mjs`. Higher value than the
   helper, because it is what makes "I could not run" readable by a machine instead of only by a
   human reading the prose. *Cost: the convention is cheap; retrofitting ~18 scripts is not, and
   should be incremental.*

Neither rides along with the flip. Both are separate work (§ 7).

## 4. Drift among the new ADRs

### 4.1 The 705 denominator: corrected in one ADR, left standing in two — P2

`ts-for-gir` v5.2.0 ships **718** `.gir` files. 705 is a stale figure that entered ADR 0029
from #474's commit message rather than a measurement, and propagated.

PR #1693 amended ADR 0029 today with a full recount
(`docs/adr/0029-girs-widget-vocabulary.md:855-870`) and went further: at `:874-877` it names
ADR 0062's number explicitly — *"Its denominator 705 is this ADR's stale one … the corpus at
the v5.2.0 tag is 718 `.gir` files."*

**And then did not fix ADR 0062.** `docs/adr/0062-…:226` still reads "142 of 705 GIRs before and
after". The correction lives in a different document from the error, which is the worst of the
three possible states: a reader of 0062 alone gets the stale number with no signal, and a reader
of 0029 is told the fix was applied somewhere it was not.

A third site was missed entirely: **`docs/adr/0034-widget-vocabulary-convergence.md:823`** —
"Across a full pool it is **705 `.gir` files**" — which #1693's amendment does not mention at
all.

The numerator is fine: 142 is independently confirmed at 5.0.0, 5.1.0 and 5.2.0, and the
recount's other four figures (475 → 483 namespaces, 102 → 108 vocabularies, 703 → 715 packages,
138 → 142 subpaths) are measured and sound.

*Cost of fixing: two one-line edits (0062:226, 0034:823). Do it in the docs sweep, not the flip.*

### 4.2 ADR 0029's body still says 705 in five places — P3

`:309`, `:340`, `:349`, `:362`, `:855`. The amendment habit in this repo is to append rather
than rewrite history, which is right — but `:349` reads "Measured on the landed generator: 705
`.gir` files" with nothing marking it superseded 500 lines later. A one-line forward pointer at
the first occurrence would cost nothing and is the difference between an amended ADR and a
self-contradicting one.

### 4.3 ADR 0053's own census went stale today — P2, rides along

ADR 0053's measured census is headed **"What the eleven `.blp` files actually use"** (`:24`),
with `:68` ("Eleven `.blp` exist in the tree") and `:134` ("the eleven real files") repeating it.

PR #1690 added `templates/gtk-minimal/src/main-window.blp` today. **There are now twelve.**
Verified: 11 at `2b388f3eea`, 12 at `HEAD`.

To #1690's credit it did the corresponding work —
`packages/infra/blueprint/corpus/real-expectations.mjs:909` carries the new file and the entry
count is 12, so the corpus did not go stale, only the ADR's prose did. The per-construct counts
in the census table (`22 using Adw 1;`, `81 Adw.HeaderBar`, `197 title:` …) were all measured
across eleven files and are now understated by one file's worth.

This is the number the flip PR will cite when it says the corpus is silent, so it should be
corrected **in the flip PR**, not before — except that it is already in flight as **#1698**,
which touches exactly `0053`, the parser README, `manifest.mjs` and `open-todos.md`. If #1698
lands first, the flip inherits the corrected census and this row drops out of § 7.1.

### 4.4 `status/open-todos.md` carries a corpus count that is stale in both halves — P3

`status/open-todos.md:6234-6235` reads "**45 of the 46** corpus files are byte-equal and
`corpus/divergences.mjs` holds one entry on one line". Both halves are wrong on `main`, and for
two different reasons:

- **the denominator.** 35 rule files + 12 reality probes = **47**. The 46 is #1694's own arithmetic
  (35 rules + the eleven real files it still counted), written on a branch that did not yet have
  #1690's twelfth.
- **the numerator.** `SHADOW_DIVERGENCES` is `[]` (§ 1.1), so no entry is excused. The reading is
  **47 of 47**.

Also in flight in #1698. Recorded here because the two errors have different causes and a
one-number fix would leave one of them standing.

### 4.5 Two ADR header formats were invented on the same day — P3

The four new ADRs do not agree on their own metadata block:

| ADR | shape |
|---|---|
| 0053 and every earlier ADR | `- Status: **Accepted**` / `- Date:` / `- Deciders:` / `- Related:` |
| **0061, 0062** | same as above — consistent |
| **0059, 0060** | `- **Status:** Proposed (2026-09-15)` / `- **Deciders:**` / `- **Scope:**` / `- **Related:**` |

0059 and 0060 bold the *label* instead of the value, fold `Date` into `Status`, and introduce a
`Scope:` field no other ADR has — 0059's `Scope` additionally carries relations in prose
(`:5-12`), which is a second place to look for something one line below it already lists.

**Both do carry `Related:`** — `0059:13-19` and `0060:9-16`. The first draft of this section said
they did not, which was the whole weight of the finding, and it was simply wrong. What is left is
smaller but real: two header shapes on one day, and a field (`Scope:`) that overlaps `Related:`
without saying which is authoritative. *Cost: two small header edits. Separate work — a docs
sweep, not the flip.*

### 4.6 ADR 0062 was written against a tree that moved under it the same day — P2

0062 merged as #1689; #1690 landed after it and converted `templates/gtk-minimal`, which is one
of 0062's own worked examples. Almost every count in it is now off by that one file:

| 0062 says | file:line | measured at `main` |
|---|---|---|
| "142 of 705 GIRs" | `:226` | denominator **718**; and 142 is *packages carrying the subpath*, while the namespace gate it is attached to is **108** (`0029:864`) |
| tracked `.ui` 42, 11 reality-probe goldens | `:70` | **47 / 12** (35 rule goldens after #1694) |
| tracked `.blp` 57, 11 shipped | `:71` | **62 / 12** — 35 rules, 15 refused, 12 shipped; the table at `:76-83` omits `templates/gtk-minimal/src` |
| assembly census 127 / 613 / 442 | `:103` | **126 / 609 / 439** at `b87098a17f`. The ADR states its filter at `:38-41` (tracked `.ts`/`.mts`/`.mjs`/`.js` outside `refs/`, specs and tests; `new (Gtk\|Adw).X(` **and** one of the 24 `PARENTING_METHODS`), so it re-runs deterministically: implemented from that paragraph it returns 127 / 613 / 442 at the ADR's own commit `ab261c073e` and 126 / 609 / 439 at both `3e12aefe1a` and `b87098a17f`. The **file** delta is one file, `templates/gtk-minimal/src/index.ts`, leaving via #1690; the construction delta is two contributions — −5 with that file, and **+1 from a comment**. #1690 added a line to `prefer-blueprint-template.ts` reading ``// `new Adw.Application(…)` is not the construction half of a module-scope finding`` (`:131`), and the census's `new (Gtk\|Adw).X(` is a regex over text, so it counts prose about a construction as a construction. It does not move the file count and did not move it here; it is worth knowing before the next re-run, because a census that reads comments can be changed by a comment |
| "42 corpus files", "41 byte-equal", "0 of 11 shipped" | `:35,187,202` | corpus **47**, none excused (§ 1.1); shipped denominator **12** |
| `prefer-blueprint-template.ts:243` returns `{ClassDeclaration, ClassExpression}` | `:113` | now `:386`, returns `{ClassDeclaration, ClassExpression, Program}` |
| "the only one of the four GTK scaffolds with no `.blp`" | `:123-126` | **false** since #1690 |

The loss census — the 13-row table at `:166-181`, whose `| **total** | **144** |` row is `:181`
(`:144-145` in the first draft was the *blocker* table, a different table two sections up) — is
**unmeasured** here, because it needs a parser run. It is no longer structurally consistent
either: `corpus/expectations.mjs` now declares **15** loss kinds, not 14 — `extern` arrived with
#1694, which is in this document's own base — and the census was re-derived over 42 corpus files
where there are now 47 (§ 1.1). So the table is stale by construction, not merely by a number.

*This is the largest single cluster in the survey, and it is cheap: one re-measurement pass over
one ADR.*

### 4.7 ADR 0060 describes three problems that were already fixed when it merged — P1

0060 merged as #1687. #1686 (`ab53678d65`) landed **before** it and had already closed three of
the things 0060 proposes:

| 0060 claims | file:line | state on `main` |
|---|---|---|
| "SRI is **not** re-verified on a cache HIT … two unverified readers" | `:47`, P2 at `:223,285-313` | **false** — in `packages/infra/cli/src/utils/install-tarball-cache.ts`, `getCachedTarball` (`:114`) verifies and unlinks on mismatch, `getForeignCachedTarball` (`:220`) verifies and returns a miss |
| `restore-keys` fallback → `node-modules-v1-` | `:43` | **gone** — `.github/actions/gjsify-setup/action.yml:118` now reads "EXACT KEY ONLY — no `restore-keys` fallback, deliberately" |
| "CI never persists `.gjsify-cache` at all" | `:288` | **false** — it does: the step "Save the tarball store", `actions/cache/save@v6` at `gjsify-setup/action.yml:291-296`. (The first draft cited `:180-192`, which is the *Restore* step — the claim was right, the citation could not carry it.) |

So **0060's P2 is already implemented** and the ADR proposes it as future work. Two more counts
are wrong in the other direction: `:45` "204 manifests declare `@girs/*`" is **146** tracked
`package.json` (the ADR's `grep -r` counted `node_modules`), and `:48`/`:262` "134
platform-gated entries" is **211**. `:38`/`:360-369` says `GJSIFY_INSTALL_FORCE_EXTRACT` has
"2 hits, both on one line of one file" and has "no mention in any workflow or doc" — it is **5
hits in 2 files**, and `tests/e2e/install-incremental-extract/run.mjs` exercises it.

**This matters more than a number fix: an ADR whose P2 is already done will send someone to
implement it twice.** The correction is now open as **#1696**.

### 4.8 ADR 0059's first step shipped one commit after it merged — P3

0059's guards G2 (`:129-134`) and G3 (`:136-142`) are **retired**. #1685 (`3c07b817b9`) landed
one commit later: the `/usr/local/share:/usr/share` default is in the *Linux prefix* launcher
(`launcher.ts:146` inside `renderPrefixLauncher`), not the `.app` — `renderAppBundleLauncher`
(`:240`) already emits no host default at `:280`; and `systemLocaleDir()`
(`locale-dir.ts:46-48`) already returns `undefined` on darwin/win32 via `NO_SYSTEM_LOCALE_DIR`.
0059's Steps row 1 (`:288`) is done and its Status is still "Proposed".

### 4.9 Five cross-references point at the wrong clause — P2

Every ADR link *target* resolves; these are description mismatches, and each one sends a reader
to a section that says something else:

| citing | claims the target says | the target actually says |
|---|---|---|
| `0060:14` | ADR 0029 "§ Risks 1 — the `@girs` subpath hazard" | `0029:389` § Risks 1 is **Release coupling** (caret-vs-exact-pin). The subpath argument is § Risks **3** (`0029:402-409`, "the surface is a **separate subpath**"), which is plausibly what was meant — so the mis-aim is the number, not the reference |
| `0062:274` | "ADR 0030 § 5 asks this of any parser change" (an oracle held against on every run) | `0030:102` § 5 is **"An exemption is DATA, never a code path"**; the oracle property is 0030 clause **1** (`:80`) |
| `0062:320` | "ADR 0058 § 7's last alternative" | `0058:398` § 7 is "This is Proposed, and it supersedes nothing"; the quoted reasoning is § **Alternatives rejected**, last bullet (`:446-448`) |
| `0062:158` | "ADR 0058 § 6 keeps all three as refusals, and § 3 decides `slot` by a GIR lookup" | **self-contradictory** — `0058:390-396` § 6 lists ten kinds and **not** `slot`; § 3 makes `slot` a lookup. Should read "keeps two of the three" |
| `0062:310` | "ADR 0053's § Context says JSX / Vue SFCs / Solid are on Blueprint's level" | `0053:19-22` says *Blueprint and `SharedNode`* are on one level; it says nothing about JSX/Vue/Solid |

Cited correctly and needing no change: 0062 → 0053 clauses 5/6/7, 0051 Decision 1, 0058 § 3/§ 6
at `:145`; all of 0059's references to 0018/0023/0024/0038/0055/0056/0057.

### 4.10 Two new ADRs contradict each other about whether `@girs` 5.2.0 is published — P1

`0062:238-240` says `@girs` 5.2.0 "is half-published; `gtk-4.0` and `adw-1` still end at 5.1.0".
`0029:884-886`, amended the same day, says "**all 715** carry a 5.2.0 on npm" and names
`@girs/clutter-7` and `@girs/meta-8` as published on 2026-09-15. Same date, opposite state.

0029 is the later measurement and is right. This **retires 0062's Decision 4 rationale**
(`:276-280`), its Implementation bullet (`:340-342`) and its rejected alternative "Bump `@girs`
to 5.2.0 in this PR. It is not published." (`:316`) — the stated reason for not bumping did not
hold.

**And the bump has since happened.** #1692 merged: every tracked manifest now pins 5.2.0
(`packages/infra/blueprint/package.json:14-15` among them, which is where § 1.1 read 5.1.0 in
this survey's first draft). So 0062 is left asserting, in three places, a registry state that two
merges have now contradicted — the correction is no longer a plan item waiting on a PR, it is
overdue.

### 4.11 ADR 0062 claims an edit to 0058 that was never made — P2

`0062:286-291` clause 5 says 0058's census "is corrected where it stands". No edit was made:
`docs/adr/0058-translatable-marking-gets-a-spelling.md:1` still reads "the other **twelve**
losses stay refusals", `docs/adr/README.md:81` repeats twelve, and 0062 says thirteen. A
correction asserted in one document and not performed in the other is the same defect as § 4.1,
in the opposite direction.

## 5. What is now dead

### 5.1 Dead already — premises today's own work removed

These are false or unreachable on `main` right now, not after some future change:

| what | file:line | killed by |
|---|---|---|
| ADR 0060's P2 (re-verify SRI on cache hit; drop `restore-keys`; persist the cache) | `0060:47,223,285-313,288` | #1686 — **implemented before the ADR proposing it merged** (§ 4.7) |
| ADR 0059's guards G2 and G3, and its Steps row 1 | `0059:129-142,288` | #1685, one commit later (§ 4.8) |
| ADR 0062's "`@girs` 5.2.0 is half-published" and the three passages resting on it | `0062:238-240,276-280,316,340-342` | the 5.2.0 publish completing on 2026-09-15 (§ 4.10) |
| ADR 0062's "the only one of the four GTK scaffolds with no `.blp`" | `0062:123-126` | #1690 (§ 4.6) |
| `prefer-blueprint-template` "returns `{ClassDeclaration, ClassExpression}`" | `0062:113` | #1690 widened it to include `Program` (§ 4.6) |
| ~~the one `SHADOW_DIVERGENCES` entry~~ | `corpus/divergences.mjs` | **gone** — #1692 merged and `SHADOW_DIVERGENCES` is `[]` (§ 1.1) |
| "gtk-minimal has no `.blp`" in two more places | `packages/infra/create-gjsify/README.md:60`, `website/src/content/docs/cli-reference.md:75` | #1690 |
| "the eleven real files" in the parser package itself | `packages/infra/blueprint/README.md:25,28` ("the 11 …"), `corpus/manifest.mjs:39,41,48` ("WHAT THE ELEVEN REAL FILES DO NOT REACH") | #1690 — twelve now. No longer blocked: #1694 merged, and **#1698** is the PR fixing it |
| `bindtextdomain(domain, … ?? '/usr/share/locale')` | `docs/adr/0024-ship-installable-artifacts.md:991` | #1685 — off Linux the app now binds nothing. ADR 0059:223-224 *announces* this amendment; 0024 never received it |

The pattern is worth naming: **five of these were killed by a PR that merged within hours of the
document asserting them**, in one direction or the other. That is the characteristic damage of a
parallel day — not conflicting code, but documents describing trees that no longer exist. This
survey then demonstrated the class on itself: the row above about `SHADOW_DIVERGENCES` was
written six minutes before the merge that emptied it.

### 5.2 Dead on the flip — belongs in that PR

ADR 0053 § Implementation is explicit that "no AGENTS.md change lands with this ADR … the rule
changes belong to the PR that earns them". The flip is that PR. What it must carry:

| what | file:line | why it dies |
|---|---|---|
| "`.blp` → XML string via `blueprint-compiler`" | `packages/infra/rolldown-plugin-gjsify/AGENTS.md:25` | states the build dependency the flip removes |
| the `blueprint-compiler is checked ONCE` paragraph | `packages/infra/cli/AGENTS.md:163` | describes a probe whose subject the build no longer needs |
| the comment "NO blueprint-compiler here: it is checked by `checkBlueprintCompiler()`…" | `packages/infra/cli/src/utils/check-system-deps.ts:584-592` | a comment explaining an exclusion that stops mattering |
| the two e2e SKIP conditions | `library-blueprint/run.mjs:46-48` (`const SKIP =`), `create-app/run.mjs:98-100` (`hasBlueprintCompiler`) | § 2.4 — they would hide the flip's own proof |
| "eleven `.blp`" | `docs/adr/0053-…:24,68,134` | twelve since #1690 (§ 4.3) |
| "45 of the 46 corpus files" | `status/open-todos.md:6234-6235` | 47 files, and none excused (§ 4.4) |
| the wrong address for the MSYS2 branch | `docs/adr/0053-…` clause 7, `status/open-todos.md:6268` | § 2.1 |

None of these is dead *today*. Every one becomes dead the moment the flip lands, which is why
they belong in that PR and not in a tidy-up before it.

## 6. Orphans and homeless things

### 6.1 The `@girs` closure oracle has no home — P2

`scripts/verify-published-closure.mjs` states its own scope in the header comment (`:87-88`):
*"THE ONE LEGITIMATE DROP is a target that is not a package of this repository — an external
dependency is the registry's problem."* That is a correct rule for what the script is: a check
that **this repository's own release** is internally closed, run `--phase pre-release` on every
PR and `--phase post-release` at the end of `release.yml`.

During today's `ts-for-gir` v5.2.0 release a *transitive* `@girs` closure checker was written ad
hoc, in a scratch directory and never committed. It is 40 lines: seed a queue with every `@girs`
name a tracked manifest depends on, fetch `registry.npmjs.org/<name>/<pinned version>` for each,
enqueue every `@girs` key of its `dependencies`, and report any name that 404s at its pinned
version. The question is whether the repo should own one.

**The argument against** is the one the script already makes, and it is not weak. `@girs` is
published from a different repository (`gjsify/types`), on its own release cadence. A gjsify PR
cannot fix a half-published `@girs`, and a gate that fails for a reason the PR author cannot
act on is a gate that gets ignored or disabled.

**The argument for is stronger than it first looks, and it is measured.** **20** `@girs` names sit
in the **`dependencies`** — not devDependencies — of *published* packages
(`packages/web/fetch`, `packages/web/websocket`, `packages/node/zlib`, …). A half-published set
therefore breaks `npm i @gjsify/fetch` for a stranger, which is this repo's problem by any
reading.

*(The first draft of this section said 25. That is the deps **plus** devDeps figure — § 6.2's
number, and correct there. A devDependency of a published package is not on a stranger's install
path, so it does not carry this argument. Measured over every tracked `package.json` with
`private !== true`: **20** in `dependencies`, 16 in `devDependencies`, **26** in the union. The
conclusion is unchanged; the number was doing work it could not do.)*

The existing script cannot see it three times over: `@girs` are not workspace members, so every
`@girs` edge dies at the `if (!target) continue` drop (`:398-401`); it walks only repo manifests,
so a transitive `@girs`→`@girs` edge is never constructed; and it reads direct edges only.

**The repo has already accepted this exact argument once.**
`.github/workflows/audit-runtimes.yml:288-299` justifies `scripts/check-shipped-runtime-packages.mjs`
with "The registry is a different question, and until now nothing asked it" — for names the
closure script "structurally cannot see". That is the same sentence one family over.

**And it is cheap.** From those 20 roots the transitive closure is **27 packages in ~1.6 s** —
not 700. (Re-measured against the live registry at `b87098a17f`, each root at the version its
manifest pins; `missing=0`, so nothing is broken today. This is a guard against the next
publication window, not a repair.) A host already exists:
`tests/e2e/published-closure/run.mjs` stands up a fake registry.

**Recommendation: yes, and trigger it on the PR that bumps the pin plus the `pre-release`
phase (`audit-runtimes.yml:321`, "Check every publishable npm name is bootstrapped") — not on
`release.yml`'s post-release call.** That puts the red in front of the person who can clear it
(the bumper) and keeps it off every unrelated PR. *Cost: small.* Two traps the ad-hoc version hit,
worth carrying into a real one: mark a name seen when it is **enqueued**, not when it is fetched,
or a name two parents reach is fetched twice and the totals disagree with each other; and read
each root's version from the manifest rather than assuming the release version — two tracked
names (`@girs/gwebgl-0.1`, `@girs/gjsifywebrtc-0.1`) are on `0.1.0-4.0.0-rc.5`, and asking the
registry for them at 5.2.0 produces two false 404s. **Separate work; it must not ride along with
the flip.**

### 6.2 A synthetic manifest pins seven `@girs` on the pre-ADR-0019 scheme — P2

`tests/e2e/storybook-on-node/run.mjs:104-110` writes a package manifest containing:

```text
@girs/gjs 4.0.4 · @girs/glib-2.0 2.88.0-4.0.4 · @girs/gobject-2.0 2.88.0-4.0.4
@girs/gio-2.0 2.88.0-4.0.4 · @girs/gdk-4.0 4.0.0-4.0.4 · @girs/gtk-4.0 4.23.0-4.0.4
@girs/adw-1 1.10.0-4.0.4
```

That is the old compound `<library-version>-<generator-version>` spelling, and it is the exact
form **ADR 0019 forbids by name**: `docs/adr/0019-ts-for-gir-as-library.md:211` — "Do not
reintroduce a padded `libraryVersion`." The current scheme is a bare `5.2.0` on **24 of the 26**
tracked `@girs` names — the two exceptions, `@girs/gwebgl-0.1` and `@girs/gjsifywebrtc-0.1`, are
published by this org rather than by `ts-for-gir` and carry their own `0.1.0-4.0.0-rc.5`. So
every one of the seven names in this fixture has a bare pin in the tree and a padded pin in the
fixture.

**Why the gate cannot see it.** `scripts/check-girs-exact-pins.mjs` (CI at
`.github/workflows/main.yml:495`) walks `package.json` **files** (`:48-62`), and its `SKIP_DIRS`
(`:37-47`) does *not* skip `tests/`. So the gate would catch this — if the manifest were a file.
It is a JS object literal materialised into a tmpdir at runtime, so the walker never meets it,
escaping both the exactness arm (`:99-103`) and the uniformity arm (`:121-136`), which would
otherwise fail the tree on 5.2.0-vs-4.0.4.

**Compounding: the suite installs these live from npm.** `tests/e2e/helpers.mjs:153-160` rewrites
only names present in the tarball map, and `@girs` are not — so this is the suite's only
live-network dependency. All seven versions still resolve, so it is green today.

**What is actually broken:** the `@girs/<ns>/vocabulary` subpath that #1683 built on **does not
exist at 4.0.4**, so the only storybook-on-node e2e structurally cannot cover today's ARIA path
and stays green while it rots. That is the cheapest kind of green-that-proves-nothing.

*Cost: seven one-token edits. Better — lift the block into a tracked
`tests/e2e/storybook-on-node/fixture/package.json` (~10 lines, **no gate change needed**, the
walker already reaches there) so it can never drift invisibly again. The real risk is the suite
failing to compile at 5.2.0, which is precisely the signal you want.* **Separate work**, and
still not part of the flip PR — but no longer blocked: #1692 merged, so the `@girs` version
declarations are nobody's open territory.

### 6.3 Three pre-existing Blueprint parser gaps, recorded on #1694 — P2, now unblocked

Located read-only; `packages/infra/blueprint/**` was not edited. All three were re-verified after
#1694 merged and all three survive it. Each row names the function to search for, because these
are the citations that moved most when #1694 landed.

| gap | where | current behaviour | fix cost |
|---|---|---|---|
| (a) undeclared loss kinds for `condition`/`setters` outside a breakpoint | in `walkBody`, `for (const extension of body.extensions)` pushes `kind: extension.name` (`src/project.mjs:178`); the declared union is the `LossKind` typedef (`corpus/expectations.mjs:88-90`) and its hand-kept mirror `const LOSS_KINDS` (`scripts/check-blueprint-corpus.mjs:125-141`) — neither lists `condition` or `setters` | inside a breakpoint the child is dropped whole (the `isBreakpoint(child.object)` branch, `:180-185`), so only the outside case reaches that push, reported as an **unnamed** loss | ~4 lines in 2 files + one rule pair + one expectation |
| (b) a refusal that blames the wrong cause | `parseMenuItem` in `src/parser.mjs` (`:843-848`) | guards `this.peek().type === 'ident'` across all three menu kinds and blames "`MenuItem` in `ast.d.mts` has no `id` field", while its own comment two lines above states the real scope (only `section`/`submenu` take an id). For `item foo {` the true cause is a missing `{`/`(` | 1-2 lines + one unit test — gate on `kind !== 'item'` and let the following `this.expect('{', …)` speak |
| (c) no property-type checking for object values | the `value.kind === 'object'` branch of `emitProperty` (`src/emit-xml.mjs:347-353`) never reads `ownerType`, while the scalar tail below it routes through `scalarText`→`identText`→`resolveIdent` (`src/resolve-ident.mjs:249`) and throws on a bad member | `label: Gtk.Box { }` emits **silently**; the same asymmetry sits in the projection, `projectBody`'s object branch vs `scalarOf`'s `value.kind === 'ident'` return | ~60-120 lines plus a `@girs`-derived table and a `corpus/refused/` entry |

(c) is the one that matters for the flip's premise: it is a hole in clause 3's "an unrecognised
construct is a hard error, never silent wrong output" — the *asymmetry* is that the emitter
refuses what it must READ and copies what it need not, which ADR 0053's Amendment 2 closing
paragraph already names. It does not block the flip (the compiler remains the validator per
clause 4), but it should be recorded against clause 3 rather than discovered later.

**Recommendation: none rides along with the flip**, and none is blocked any more. (b) is free and
uncoupled and can go at any time. (a) and (c) are the package #1694 left behind.

### 6.4 Leftovers from parallel work itself — P2/P3

| what | file:line | why |
|---|---|---|
| **a half-swept cache-buster class** | `scripts/check-shipped-runtime-packages.mjs:344-349`, the `'cache-control': 'no-cache'` fetch header and the comment above it | #1682 measured **today** that `no-cache`/`max-age=0`/`no-store`/`pragma` all still return `cf-cache-status: HIT`, and added a `__gjsify_readback=<nonce>` query buster to `publish-readback.ts:265` and `verify-published-closure.mjs:434`. The third registry reader was not updated and still carries the comment #1682 disproved. Near-identical `probe()` in both scripts; both read `status/pending-npm-bootstrap.json`. **P2** |
| three hand-rolled submodule checkouts the new action does not cover | `.github/workflows/prebuilds.yml:717,755,1279` | #1688's composite action covers all six gitlab.gnome.org steps; these three still `git submodule update --init --recursive refs/{oxc,rolldown}` with no cache and no mirror. ADR 0061 scopes itself to the six (`:61`, "used by all six steps") and never says why these are out. **P3** — say why, or cover them |
| ~~a fourth checkout~~ — **counted here in error** | `.github/workflows/prebuilds.yml:1310` | it is `--init --depth 1 refs/rolldown`, not `--recursive`, and the two comment lines directly above it give the reason: "rolldown's own submodules are test fixtures the Cargo path-dep never reaches, and the shallow fetch still lands the pinned commit that `refs-pin` verifies". It shares the no-cache/no-mirror gap, but "never says why" is false of this one |
| **91 byte-identical lines — ten whole steps — in two jobs** | `.github/workflows/audit-runtimes.yml:332-422` ↔ `:1139-1229`, a fixed offset of 807. Measured by taking a pair of lines known to match and extending the range one line at a time in both directions until `diff` stops being empty: one line wider in either direction fails. The run is bounded by a blank line at each end, so 89 lines of content | jobs `check` and `check-windows` duplicate ten consecutive gates — `check-workflow-inline-scripts`, `check-probe-outcomes-read`, `check-workflow-script-checkout`, `check-workflow-registry-installs`, `check-workflow-release-globs`, `check-ship-format-vocabulary`, `check-foreign-platform-paths`, `check-e2e-suite-coverage`, `check-e2e-harness-duplication`, `check-adr-index` — every one of which only reads tracked files, so the Windows copy re-runs ten OS-independent gates. **P3** |
| *how the same number was got wrong twice* | first draft: "a 9-line block at `:391-399` / `:1197-1206`". First correction: "an 8-line block at `:391-398` / `:1198-1205`" | Both of those ranges really are identical — and so is every range between them, because all of them sit inside the 91. **A range that is identical is not a range that is maximally identical**, and reporting a sub-range as though it were the measurement is how both numbers happened; the second time it was reported as the exact one. The rule this earns, and it is the cheap half of § 3.3's: for a duplication claim, extend until it breaks and say where it broke |

**For the record, what is clean:** every file added today is referenced (the heartbeat watchdog,
`install-extraneous`, `check-foreign-platform-paths.mjs` at `audit-runtimes.yml:398`), all four
new ADRs are indexed at `docs/adr/README.md:82-85`, and there are no duplicate exported function
names among today's changed `.ts`. The parallel day did not produce orphaned code — it produced
orphaned *claims*.

## 7. The decision: what rides along with the flip, and what does not

The rule used here: an item rides along **only if leaving it out would make the flip PR's own
claim false or unprovable**. Everything else is separate, however cheap it looks — a flip PR
that also sweeps four ADRs is a PR nobody can review as one thing.

### 7.1 Rides along — the flip PR carries these

| § | item | why it cannot be separated |
|---|---|---|
| 1.2 | un-private `@gjsify/blueprint`, export the parser, first publish | the flip *is* this |
| 1.4 | delete `resolve-compiler.ts` + spec; re-point 4 consumers | clause 7 item 1; the published `./resolve` subpath goes with it |
| 2.4 | **remove both e2e SKIP conditions** | otherwise the flip's only cross-platform proof reports green by not running |
| 2.1 | correct clause 7's MSYS2 address (ADR + `open-todos:6268`) | the deletion list is the completion test; a wrong address cannot be checked off |
| 4.3 | ADR 0053 "eleven `.blp`" → twelve (`:24,68,134`) | the flip PR cites this census as its evidence — **#1698 may land it first** |
| 4.4 | `open-todos:6234-6235` 45/46 → 47/47 | same sentence, same claim — **#1698 may land it first** |
| 5 | `rolldown-plugin-gjsify/AGENTS.md:25`, `cli/AGENTS.md:163`, `check-system-deps.ts:584-592` | ADR 0053 § Implementation says the rule changes belong to the PR that earns them |
| 2.3 | `open-todos:6266` storybook-window item → scoping, not deletion | one line, same paragraph as the MSYS2 address |

One precondition is left, and it is a measurement rather than an edit: the bootstrap weight of
`@girs/gtk-4.0` + `@girs/adw-1` (§ 1.3). The other — "#1692 must merge first" — was discharged
while this survey was in review.

### 7.2 Does not ride along

| § | item | priority | why separate |
|---|---|---|---|
| 4.7 | ADR 0060's P2 is already implemented | **P1** | `install`, not Blueprint; and it is urgent on its own — someone will build it twice |
| 4.10 | 0062 vs 0029 on `@girs` 5.2.0 publication | **P1** | #1692 merged and disproved 0062's claim in the tree; the ADR edit is now simply overdue |
| 4.1 | 705 → 718 in `0062:226` and `0034:823` | P2 | docs sweep |
| 4.6 | ADR 0062's whole count set re-measured | P2 | a re-measurement pass over one ADR; large enough to be its own PR |
| 4.9 | five mis-aimed cross-references | P2 | docs sweep, same PR as 4.1/4.6 |
| 4.11 | 0058 "twelve" vs 0062 "thirteen" | P2 | docs sweep |
| 3.1 | `requireTool()` for the five `--require-<tool>` sites | P2 | a refactor; nothing about the flip needs it |
| 3.3 | write down + gate the exit-code convention (2 = could not measure) | P2 | the higher-value half of § 3, and independent |
| 6.1 | a `@girs` transitive closure oracle in `scripts/` | P2 | release tooling |
| 6.2 | the storybook-on-node synthetic manifest | P2 | **unblocked** — #1692 merged; the fixture is now 4.0.4 against a 5.2.0 tree |
| 6.3 | three parser gaps from #1694's review | P2 | **unblocked** — #1694 merged; all three survive it |
| 6.4 | `check-shipped-runtime-packages.mjs:344-349` still header-only cache-bust | P2 | #1682 disproved its comment today; finish the sweep it started |
| 5.1 | ADR 0024:991 never received the `bindtextdomain` amendment 0059 announces | P2 | shipping, not Blueprint |
| 5.1 | "gtk-minimal has no `.blp`" in `create-gjsify/README.md:60`, `cli-reference.md:75` | P3 | docs sweep |
| 5.1 | the eleven-real-files counts inside `packages/infra/blueprint/` | P3 | **unblocked** — #1694 merged; **#1698** is the PR doing it |
| 4.2 | forward pointer at 0029's first stale 705 | P3 | docs sweep |
| 4.5 | two ADR header formats | P3 | docs sweep |
| 6.4 | the three `prebuilds.yml` submodule steps outside #1688's action | P3 | cover them, or say in ADR 0061 why not |
| 6.4 | the 91 duplicated `audit-runtimes.yml` lines — ten OS-independent gates re-run on Windows | P3 | CI tidy-up |
| 4.8 | ADR 0059's Status vs its shipped step | P3 | one-line amendment |

### 7.3 Suggested order

1. ~~**#1692 merges**~~ — **done**, and it unblocked §§ 1.1, 4.10 and 6.2.
2. ~~**#1694 merges**~~ — **done**; § 6.3 is unblocked and `extern-type` is now accepted (§ 1.5).
3. **ADR 0060 correction** (§ 4.7) — independent and P1; **open as #1696**.
4. **Measure the bootstrap weight** (§ 1.3). If it is bad, the flip changes shape before it is
   written. This is now the only precondition left, and nothing has claimed it.
5. **The flip PR** — § 7.1 as one atomic change.
6. **Docs sweep** — §§ 4.1, 4.2, 4.5, 4.6, 4.8, 4.9, 4.11 in one PR.
7. **Guard work** — § 3.3 then § 3.1.
8. **Release tooling** — § 6.1, § 6.2.

Steps 1 and 2 were struck through by merges that landed six minutes after this survey opened as a
PR. They are kept rather than deleted, because the shape of the plan — everything sequenced behind
two PRs — is what the survey measured, and a reader who only sees the answer cannot tell whether
the sequencing was ever real.

### 7.4 Does the flip need an ADR of its own?

**Yes, and ADR 0063 is free** — 0059-0062 are taken on `main`, and no open PR claims a new
number. Re-checked at `b87098a17f` against an open set that is almost entirely different from the
one the first draft checked: #1677 (amends 0038), #1696 (amends 0060), #1698 (amends 0053), #1699
(a report, no ADR). #1692 and #1694 have merged and added no ADR.

ADR 0053 already decided *that* the parser becomes authoritative, so the flip needs no new
decision about Blueprint. What it needs a decision for is what § 1.2 and § 1.4 surfaced and 0053
did not anticipate: **publishing `@gjsify/blueprint` as a new public package, and removing a
published subpath from a tier-1 one.** `docs/governance.md:11` puts exactly that class — "change
a published contract (versioning, tiering, artifact strategy)" — under an ADR *before*
implementation.

That ADR should be drafted **with** the flip PR, not before it, because its content is the
answer to § 1.3 (bootstrap weight) and § 1.5 (what a build does when a real `.blp` leaves the
subset) — and neither is measured yet. Drafting it now would be asserting the two facts the
flip most needs to establish.

## 8. What could not be measured

- **The installed weight of `@girs/gtk-4.0` + `@girs/adw-1`**, and whether a cold bootstrap
  (ADR 0002) already resolves them. `node_modules` is absent in a read-only worktree. This is
  the one open question that could still change the flip's shape (§ 1.3).
- **Anything behind `refs/`** — the submodules are unpopulated gitlinks here. This covers
  ADR 0061's `style-classes.md` byte count, its "53 documented classes" and its 503 probes, and
  every Yarn 4.9.2 figure in ADR 0060.
- **ADR 0062's loss census (144/145)** — needs a parser run. Structurally consistent with
  `corpus/expectations.mjs`, not independently confirmed.
- **Whether a brand-new `@gjsify/*` name can be created by OIDC alone** (§ 1.7). This is an org
  and registry *policy* question, not a packument read: the `@girs` closure measurement in § 6.1
  did call `registry.npmjs.org`, but nothing here probes the first-publish path.
- **Whether external consumers use a refused construct** (§ 1.5). Unknowable from this repo;
  it is a judgement, not a measurement, and § 7.4 is where it gets made.
