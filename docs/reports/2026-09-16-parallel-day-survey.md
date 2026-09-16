# Parallel-day survey 2026-09-16 — what twelve merged PRs left behind

A step-back pass over one day of parallel agent work in `gjsify/gjsify`: twelve PRs merged
(`bc78d1b689..3e12aefe1a`, eleven commits) plus a `ts-for-gir` v5.2.0 release, with #1692
and #1694 still open. This file is the *why + priority* record for the refactor that follows;
the ADRs are the decisions and `status/open-todos.md` tracks the work.

**It contains no refactoring.** Its job is to decide what the next change does — specifically,
what may ride along with the ADR 0053 clause 5/7 flip and what must not.

## Verdict

The day's output is sound where it is code: no two PRs contradict each other in the tree, and
the guard family that grew fastest grew for a good reason. The damage is in the documents. Four
ADRs were written in parallel against a tree that other PRs were changing underneath them, and
**five separate passages now describe a state that a PR merging hours later removed** (§ 5.1).

Three findings change what the next change should be:

1. **Clause 5's condition is not met on `main`** (§ 1.1). The corpus is silent only on the
   still-open #1692. Every part of the flip is sequenced behind that PR.
2. **Flipping clause 5 is a package publication and a breaking change, not a status edit**
   (§ 1.2, § 1.4). The parser package is `private: true` and exports its test corpus rather than
   its parser; the plugin that must consume it is published tier-1 with a public `./resolve`
   subpath that clause 7 deletes. ADR 0053 anticipated neither.
3. **ADR 0060 proposes work that was already done before it merged** (§ 4.7). Its P2 — re-verify
   SRI on a cache hit — is implemented at `install-tarball-cache.ts:114,219`. Left standing, it
   will be built twice.

The one item that must not be deferred for tidiness: **two e2e suites skip themselves when
`blueprint-compiler` is absent** (§ 2.4). After the flip that is every host the flip exists to
serve, so the proof would go green by not running. It rides along or the flip proves nothing.

## How this was measured

Read-only, on a worktree at `origin/main` (`3e12aefe1a`). `refs/` submodules and `node_modules`
are absent there, so anything that depends on them is marked *unmeasured* rather than guessed.
Counts come from `git ls-files`, `wc -l` and `grep -c` on tracked files.

## 1. The flip: what ADR 0053 clause 5 actually requires

Clause 5 says the in-repo parser runs in SHADOW until it is silent, and becomes authoritative
when it reports no divergence. Read as a status change, flipping it is one edit to one ADR.
Measured, it is a package publication, a breaking change to a published API, and a
re-pointing of four consumers — and it cannot happen on `main` today at all.

### 1.1 The silence does not exist on `main` — P1, blocking

`packages/infra/blueprint/corpus/divergences.mjs:106-127` still holds one entry:
`rules/29-enum-non-widget.blp`, `Gtk.SizeGroup { mode: horizontal; }` emitting the member name
where the oracle writes `1`, because `PROP_ENUMS` is keyed by the widget vocabulary and
`GtkSizeGroup` is not a widget. `packages/infra/blueprint/package.json:17-18` pins `@girs` at
5.1.0.

`SHADOW_DIVERGENCES` becomes `[]` only in **#1692**, which carries `@girs` 5.2.0 repo-wide and
the widget/child-holder tag filter that extends `PROP_ENUMS` past the widget vocabulary — the
exact retirement condition the ledger entry names at `divergences.mjs:126`. So the "43/43
byte-equal, nothing ledgered" state is a property of #1692's branch, not of `main`.

**Consequence for sequencing: the flip PR is blocked on #1692 merging, and cannot be written
against `main` without inheriting a divergence that contradicts its own premise.** Any
clause 5 edit that lands first would be asserting a silence the tree does not have.

### 1.2 The build does not import the parser, and cannot today — P1

`packages/infra/vite-plugin-blueprint/src/index.ts:50` shells out to `blueprint-compiler`
through `execa`. The in-repo parser is imported by exactly one thing —
`scripts/check-blueprint-corpus.mjs:568-571`, which loads `src/parser.mjs`, `src/emit-xml.mjs`,
`src/project.mjs` and `src/resolve-ident.mjs` by path. Nothing else in the tree imports it, and
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

| consumer | file:line | what breaks |
|---|---|---|
| the plugin itself | `src/index.ts:9,24` | re-exports 6 symbols from its root |
| `gjsify system-check` | `packages/infra/cli/src/utils/check-system-deps.ts:21,544-575` | the blueprint probe |
| e2e `library-blueprint` | `tests/e2e/library-blueprint/run.mjs:40,46-48` | its SKIP condition |
| e2e `create-app` | `tests/e2e/create-app/run.mjs:16,99` | skips three templates |

`BlueprintCompileError`, `BlueprintCompilerNotFoundError`, `currentBlueprintHost`,
`formatMissingBlueprintCompiler`, `ResolvedBlueprintCompiler` and `resolveBlueprintCompiler`
are all public today. Removing the subpath is a semver-major event for a tier-1 package, which
is a governance question (`docs/governance.md:12`) and not a cleanup.

### 1.5 The subset is proven over first-party files only — P2, the honest risk

Byte-equality covers 43 files: 31 corpus rules (`corpus/rules/*.blp`) and the 12 real `.blp` in
the tree. Every one of the 43 is first-party. The plugin, however, is published, and clause 3
makes an unrecognised construct a **hard error**. `corpus/refused/` names 15 constructs the
parser deliberately refuses today — among them `inline-menu.blp`, `internal-child.blp`,
`translation-domain.blp`, `binding-lookup-chain.blp`, `response-flags.blp` and `extern-type.blp`
(the last of which #1694 is in flight to accept).

So the flip converts "works, needs a binary" into "refuses, no binary needed" for any external
consumer whose `.blp` uses one of those. That trade is defensible — it is clause 3's whole
design — but it is a downstream-visible behaviour change that the corpus cannot speak to,
because the corpus contains no third-party file by construction (clause 6 forbids it).

**`status/open-todos.md:6238-6243` already states this as the open decision** ("the flip has to
say what a build does when a real file trips one") and it remains unanswered. It is the one
question in the flip that no measurement settles.

### 1.6 Honest cost and risk

| | |
|---|---|
| **Cost** | un-private + export the parser; one npm first-publish; re-point 4 consumers; delete 505 lines + a published subpath; re-measure the bootstrap weight; a semver-major on a tier-1 package |
| **Risk, contained** | in-repo builds — all 12 real `.blp` are inside the proven 43 |
| **Risk, real** | external `.blp` using a refused construct now fails the build; `@girs` weight in a cold bootstrap is unmeasured |
| **Blocked on** | #1692 (the silence), and #1694 decides whether `extern-type` is still refused at flip time |
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
| 2 | the line-level `oxlint-disable` in `loading-stack.ts` | present, `:41` | **yes** — deliberately still open |
| 3 | "the MSYS2 branch of `gjsify system-check`" | see below | **no — misdescribed** |
| 4 | `check-doc-fences.mjs` skip becomes two-stage | still a single skip, `:368-369` | **yes** — not started |

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
`status/open-todos.md:6258-6260` repeats the same wrong address, having inherited it.

Correcting this matters beyond tidiness: a deletion list is a completion test, and an item
naming a file that cannot contain it can never be checked off honestly.

### 2.2 The deletion list understates its own blast radius — P2

Clause 7 reads as four independent items. Items 1 and 3 are one deletion with four consumers
(§ 1.4), and `check-system-deps.ts:584-592` carries a comment explaining why
`blueprint-compiler` is deliberately excluded from the generic toolchain list — which becomes
dead prose the moment the build stops needing the binary.

### 2.3 `status/open-todos.md` disagrees with the ADR about the storybook window — P3

`status/open-todos.md:6257-6258` lists "the programmatic storybook window" **inside** the
deletion list. ADR 0053 clause 7 says the opposite in as many words: it "is a DIFFERENT item …
what it needs is a scoping decision and not a deletion". The todo entry turns a scoping question
into a deletion target. One of the two is wrong and the ADR is the authority.

### 2.4 Two e2e suites will skip on exactly the hosts the flip exists to fix — P1, rides along

`tests/e2e/library-blueprint/run.mjs:46-48` and `tests/e2e/create-app/run.mjs:99` gate
themselves on `resolveBlueprintCompiler()` returning non-null. Today that is correct: no
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
pre-existing ones decide the duplication question): **16 named mechanisms, plus roughly 20
further "this would pass vacuously" asserts.**

They do not all share a shape, and that turns out to be the right answer rather than a defect.

### 3.1 Group A — genuinely the same mechanism, five times

The `--require-<tool>` family. Each probes a tool, reads a flag, counts what went unread, and
composes a message:

| flag | file:line | tool |
|---|---|---|
| `--require-oracle` | `scripts/check-blueprint-corpus.mjs:429` | `blueprint-compiler` |
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

The more useful finding is underneath the spelling. Two scripts added today
(`scripts/check-lint-visibility.mjs:145,173,200,235,249` and
`scripts/check-source-visibility.mjs:77-85`) distinguish **exit 2 = "could not measure"** from
**exit 1 = "measured, found findings"**. That distinction is exactly what makes this failure
class machine-readable, and it exists in 2 scripts out of ~20 and is documented nowhere.
`scripts/check-foreign-platform-paths.mjs:91` spends exit 2 on a usage error instead, so the
convention is already being contradicted as it is being invented.

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
corrected **in the flip PR**, not before.

### 4.4 `status/open-todos.md` carries the pre-#1690 corpus count — P3, rides along

`status/open-todos.md:6234-6235`: "41 of the 42 corpus files are byte-equal". With 31 rules +
12 real files the denominator is **43**, and on `main` today the reading is 42 of 43 (one
ledger entry, § 1.1). After #1692 it is 43 of 43. Same fix, same PR.

### 4.5 Two ADR header formats were invented on the same day — P3

The four new ADRs do not agree on their own metadata block:

| ADR | shape |
|---|---|
| 0053 and every earlier ADR | `- Status: **Accepted**` / `- Date:` / `- Deciders:` / `- Related:` |
| **0061, 0062** | same as above — consistent |
| **0059, 0060** | `- **Status:** Proposed (2026-09-15)` / `- **Deciders:**` / `- **Scope:**` |

0059 and 0060 bold the *label* instead of the value, fold `Date` into `Status`, introduce a
`Scope:` field no other ADR has, and carry no `Related:` line — 0059 folds its relations into
`Scope` prose instead (`:7-8`).

Neither shape is wrong; having both is. `Related:` is the line the cross-reference audit reads,
so dropping it makes the next audit more expensive. *Cost: two small header edits. Separate
work — a docs sweep, not the flip.*

### 4.6 ADR 0062 was written against a tree that moved under it the same day — P2

0062 merged as #1689; #1690 landed after it and converted `templates/gtk-minimal`, which is one
of 0062's own worked examples. Almost every count in it is now off by that one file:

| 0062 says | file:line | measured at `main` |
|---|---|---|
| "142 of 705 GIRs" | `:226` | denominator **718**; and 142 is *packages carrying the subpath*, while the namespace gate it is attached to is **108** (`0029:864`) |
| tracked `.ui` 42, 11 reality-probe goldens | `:70` | **43 / 12** |
| tracked `.blp` 57, 11 shipped | `:71` | **58 / 12**; the table at `:76-83` omits `templates/gtk-minimal/src` |
| assembly census 127 / 613 / 442 | `:103` | **126 / 609 / 439** by the ADR's own method |
| "42 corpus files", "41 byte-equal", "0 of 11 shipped" | `:35,187,202` | corpus **43**; shipped denominator **12** |
| `prefer-blueprint-template.ts:243` returns `{ClassDeclaration, ClassExpression}` | `:113` | now `:386`, returns `{ClassDeclaration, ClassExpression, Program}` |
| "the only one of the four GTK scaffolds with no `.blp`" | `:123-126` | **false** since #1690 |

The loss census at `:144-145` is **unmeasured** here (it needs a parser run) but is structurally
consistent: `corpus/expectations.mjs` declares 14 kinds and the 13-row table sums to 144.

*This is the largest single cluster in the survey, and it is cheap: one re-measurement pass over
one ADR.*

### 4.7 ADR 0060 describes three problems that were already fixed when it merged — P1

0060 merged as #1687. #1686 (`ab53678d65`) landed **before** it and had already closed three of
the things 0060 proposes:

| 0060 claims | file:line | state on `main` |
|---|---|---|
| "SRI is **not** re-verified on a cache HIT … two unverified readers" | `:47`, P2 at `:223,285-313` | **false** — `install-tarball-cache.ts:114` and `:219` both call `verifyIntegrity` and unlink on mismatch |
| `restore-keys` fallback → `node-modules-v1-` | `:43` | **gone** — `.github/actions/gjsify-setup/action.yml:118` now reads "EXACT KEY ONLY — no `restore-keys` fallback, deliberately" |
| "CI never persists `.gjsify-cache` at all" | `:288` | **false** — it does, `action.yml:180-192` |

So **0060's P2 is already implemented** and the ADR proposes it as future work. Two more counts
are wrong in the other direction: `:45` "204 manifests declare `@girs/*`" is **146** tracked
`package.json` (the ADR's `grep -r` counted `node_modules`), and `:48`/`:263` "134
platform-gated entries" is **211**. `:38`/`:360-369` says `GJSIFY_INSTALL_FORCE_EXTRACT` has
"2 hits, both on one line of one file" and has "no mention in any workflow or doc" — it is **5
hits in 2 files**, and `tests/e2e/install-incremental-extract/run.mjs` exercises it.

**This matters more than a number fix: an ADR whose P2 is already done will send someone to
implement it twice.**

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
| `0060:14` | ADR 0029 "§ Risks 1 — the `@girs` subpath hazard" | `0029:389` § Risks 1 is **Release coupling** (caret-vs-exact-pin); 0029 has 3 Risks, none about a subpath |
| `0062:274` | "ADR 0030 § 5 asks this of any parser change" (an oracle held against on every run) | `0030:102` § 5 is **"An exemption is DATA, never a code path"**; the oracle property is 0030 clause **1** (`:80`) |
| `0062:321` | "ADR 0058 § 7's last alternative" | `0058:398` § 7 is "This is Proposed, and it supersedes nothing"; the quoted reasoning is § **Alternatives rejected**, last bullet (`:446-448`) |
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
to 5.2.0 in this PR. It is not published." (`:316`) — the stated reason for not bumping no
longer holds, which is exactly what #1692 is doing. The pin itself is genuinely still undone
(`packages/infra/blueprint/package.json:14-15` reads 5.1.0).

**This is the finding that most changes the plan**, because it converts "0062 explains why we
cannot bump yet" into "#1692 is unblocked and 0062 should stop saying otherwise".

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
| the one `SHADOW_DIVERGENCES` entry | `corpus/divergences.mjs:106-127` | retires the moment #1692 merges (§ 1.1) |
| "gtk-minimal has no `.blp`" in two more places | `packages/infra/create-gjsify/README.md:60`, `website/src/content/docs/cli-reference.md:75` | #1690 |
| "the eleven real files" in the parser package itself | `packages/infra/blueprint/README.md:25,28`, `corpus/manifest.mjs:40,41,48` | #1690 — twelve now (**#1694's territory; do not edit**) |
| `bindtextdomain(domain, … ?? '/usr/share/locale')` | `docs/adr/0024-ship-installable-artifacts.md:991` | #1685 — off Linux the app now binds nothing. ADR 0059:223-224 *announces* this amendment; 0024 never received it |

The pattern is worth naming: **five of the six were killed by a PR that merged within hours of
the document asserting them**, in one direction or the other. That is the characteristic damage
of a parallel day — not conflicting code, but documents describing trees that no longer exist.

### 5.2 Dead on the flip — belongs in that PR

ADR 0053 § Implementation is explicit that "no AGENTS.md change lands with this ADR … the rule
changes belong to the PR that earns them". The flip is that PR. What it must carry:

| what | file:line | why it dies |
|---|---|---|
| "`.blp` → XML string via `blueprint-compiler`" | `packages/infra/rolldown-plugin-gjsify/AGENTS.md:25` | states the build dependency the flip removes |
| the `blueprint-compiler is checked ONCE` paragraph | `packages/infra/cli/AGENTS.md:163` | describes a probe whose subject the build no longer needs |
| "NO blueprint-compiler here: it is checked by …" | `packages/infra/cli/src/utils/check-system-deps.ts:584-592` | a comment explaining an exclusion that stops mattering |
| the two e2e SKIP conditions | `tests/e2e/library-blueprint/run.mjs:46-48`, `tests/e2e/create-app/run.mjs:99` | § 2.4 — they would hide the flip's own proof |
| "eleven `.blp`" | `docs/adr/0053-…:24,68,134` | twelve since #1690 (§ 4.3) |
| "41 of the 42 corpus files" | `status/open-todos.md:6234-6235` | 43 files since #1690 (§ 4.4) |
| the wrong address for the MSYS2 branch | `docs/adr/0053-…` clause 7, `status/open-todos.md:6258-6260` | § 2.1 |

None of these is dead *today*. Every one becomes dead the moment the flip lands, which is why
they belong in that PR and not in a tidy-up before it.

## 6. Orphans and homeless things

### 6.1 The `@girs` closure oracle has no home — P2

`scripts/verify-published-closure.mjs` states its own scope at `:87-88`: *"THE ONE LEGITIMATE
DROP is a target that is not a package of this repository — an external dependency is the
registry's problem."* That is a correct rule for what the script is: a check that **this
repository's own release** is internally closed, run `--phase pre-release` on every PR and
`--phase post-release` at the end of `release.yml`.

During today's `ts-for-gir` v5.2.0 release a *transitive* `@girs` closure checker was written
ad hoc and left outside the repo at `/tmp/claude-1000/girs-closure.mjs`. The question is whether
the repo should own one.

**The argument against** is the one the script already makes, and it is not weak. `@girs` is
published from a different repository (`gjsify/types`), on its own release cadence. A gjsify PR
cannot fix a half-published `@girs`, and a gate that fails for a reason the PR author cannot
act on is a gate that gets ignored or disabled.

**The argument for is stronger than it first looks, and it is measured.** 25 `@girs` names sit
in the **`dependencies`** — not devDependencies — of *published* packages
(`packages/web/fetch`, `packages/web/websocket`, `packages/node/zlib`, …). A half-published set
therefore breaks `npm i @gjsify/fetch` for a stranger, which is this repo's problem by any
reading. The existing script cannot see it three times over: `@girs` are not workspace members,
so every `@girs` edge dies at `:398-401`; it walks only repo manifests, so a transitive
`@girs`→`@girs` edge is never constructed; and it reads direct edges only.

**The repo has already accepted this exact argument once.**
`.github/workflows/audit-runtimes.yml:288-299` justifies `scripts/check-shipped-runtime-packages.mjs`
with "The registry is a different question, and until now nothing asked it" — for names the
closure script "structurally cannot see". That is the same sentence one family over.

**And it is cheap.** From the 25 roots the transitive closure is **33 packages, ~3 s** — not
700. A host already exists: `tests/e2e/published-closure/run.mjs` stands up a fake registry.
Measured at both 5.1.0 and 5.2.0 the closure is complete (`missing=0`), so nothing is broken
today; this is a guard against the next window, not a repair.

**Recommendation: yes, and trigger it on the PR that bumps the pin plus the `pre-release`
phase (`audit-runtimes.yml:321`) — not on `release.yml`'s post-release call.** That puts the red
in front of the person who can clear it (the bumper) and keeps it off every unrelated PR.
*Cost: small.* One caveat if the ad-hoc script is adopted as a starting point:
`/tmp/claude-1000/girs-closure.mjs:40` checks `seen` but not the queue, so a name enqueued by
two parents is fetched twice — which is why it prints `present=33` against `reachable=30`.
**Separate work; it must not ride along with the flip.**

### 6.2 A synthetic manifest pins seven `@girs` on the pre-ADR-0019 scheme — P2

`tests/e2e/storybook-on-node/run.mjs:104-110` writes a package manifest containing:

```text
@girs/gjs 4.0.4 · @girs/glib-2.0 2.88.0-4.0.4 · @girs/gobject-2.0 2.88.0-4.0.4
@girs/gio-2.0 2.88.0-4.0.4 · @girs/gdk-4.0 4.0.0-4.0.4 · @girs/gtk-4.0 4.23.0-4.0.4
@girs/adw-1 1.10.0-4.0.4
```

That is the old compound `<library-version>-<generator-version>` spelling, and it is the exact
form **ADR 0019 forbids by name**: `docs/adr/0019-ts-for-gir-as-library.md:213` — "Do not
reintroduce a padded `libraryVersion`." The current scheme is a bare version on all 25 tracked
names (`5.1.0` today, `5.2.0` after #1692).

**Why the gate cannot see it.** `scripts/check-girs-exact-pins.mjs` (CI at
`.github/workflows/main.yml:495`) walks `package.json` **files** (`:48-62`), and its `SKIP_DIRS`
(`:37-47`) does *not* skip `tests/`. So the gate would catch this — if the manifest were a file.
It is a JS object literal materialised into a tmpdir at runtime, so the walker never meets it,
escaping both the exactness arm (`:99-103`) and the uniformity arm (`:121-136`), which would
otherwise fail the tree on 5.1.0-vs-4.0.4.

**Compounding: the suite installs these live from npm.** `tests/e2e/helpers.mjs:153-160` rewrites
only names present in the tarball map, and `@girs` are not — so this is the suite's only
live-network dependency. All seven versions still resolve, so it is green today.

**What is actually broken:** the `@girs/<ns>/vocabulary` subpath that #1683 built on **does not
exist at 4.0.4**, so the only storybook-on-node e2e structurally cannot cover today's ARIA path
and stays green while it rots. That is the cheapest kind of green-that-proves-nothing.

*Cost: seven one-token edits. Better — lift the block into a tracked
`tests/e2e/storybook-on-node/fixture/package.json` (~10 lines, **no gate change needed**, the
walker already reaches there) so it can never drift invisibly again. The real risk is the suite
failing to compile at 5.1.0, which is precisely the signal you want.* **Separate work**, and
explicitly **not** in the flip PR: it touches `@girs` version declarations, which #1692 owns.

### 6.3 Three pre-existing Blueprint parser gaps, recorded on #1694 — P2, mostly blocked

Located read-only; `packages/infra/blueprint/**` was not edited.

| gap | where | current behaviour | fix cost | collides with #1694? |
|---|---|---|---|---|
| (a) undeclared loss kinds for `condition`/`setters` outside a breakpoint | `src/project.mjs:175` pushes `kind: extension.name`; the declared union is `corpus/expectations.mjs:82-84` and its hand-kept mirror `scripts/check-blueprint-corpus.mjs:125-140` | inside a breakpoint the child is dropped whole (`project.mjs:177-181`), so only the outside case reaches `:175`, reported as an **unnamed** loss | ~4 lines in 2 files + one rule pair + one expectation | **yes** — #1694 edits that same typedef and Set |
| (b) a refusal that blames the wrong cause | `src/parser.mjs:838-843` | guards `peek().type === 'ident'` across all three menu kinds and blames "`MenuItem` in `ast.d.mts` has no `id` field", while its own comment at `:835-837` states the real scope (only `section`/`submenu` take an id). For `item foo {` the true cause is a missing `{`/`(` | 1-2 lines + one unit test — gate on `kind !== 'item'` and let `expect('{')` at `:845` speak | **no** |
| (c) no property-type checking for object values | `src/emit-xml.mjs:331-337` never reads `ownerType`, while the scalar tail at `:344-345` routes through `scalarText`→`identText`→`resolve-ident.mjs:249` and throws on a bad member | `label: Gtk.Box { }` emits **silently**; same asymmetry at `project.mjs:95-101` vs `:69` | ~60-120 lines plus a `@girs`-derived table and a `corpus/refused/` entry | mild — #1694 edits the JSDoc above and `resolve-ident.mjs:274-291` |

(c) is the one that matters for the flip's premise: it is a hole in clause 3's "an unrecognised
construct is a hard error, never silent wrong output" — the *asymmetry* is that the emitter
refuses what it must READ and copies what it need not, which ADR 0053's Amendment 2 closing
paragraph already names. It does not block the flip (the compiler remains the validator per
clause 4), but it should be recorded against clause 3 rather than discovered later.

**Recommendation: none rides along with the flip.** (b) is free and uncoupled and can go any
time after #1694. (a) and (c) belong to the package #1694 leaves behind.

### 6.4 Leftovers from parallel work itself — P2/P3

| what | file:line | why |
|---|---|---|
| **a half-swept cache-buster class** | `scripts/check-shipped-runtime-packages.mjs:344-349` | #1682 measured **today** that `no-cache`/`max-age=0`/`no-store`/`pragma` all still return `cf-cache-status: HIT`, and added a `__gjsify_readback=<nonce>` query buster to `publish-readback.ts:265` and `verify-published-closure.mjs:434`. The third registry reader was not updated and still carries the comment #1682 disproved. Near-identical `probe()` in both scripts; both read `status/pending-npm-bootstrap.json`. **P2** |
| four hand-rolled submodule checkouts the new action does not cover | `.github/workflows/prebuilds.yml:717,755,1279,1310` | #1688's composite action covers all six gitlab.gnome.org steps; these four still `git submodule update --init --recursive refs/{oxc,rolldown}` with no cache and no mirror. ADR 0061 scopes itself to the six (`:61`) and never says why these are out. **P3** — say why, or cover them |
| a byte-identical 9-line block in two jobs | `.github/workflows/audit-runtimes.yml:391-399` and `:1197-1206` | jobs `check` and `check-windows` both run `check-foreign-platform-paths.mjs`, which only reads files — so the Windows copy re-runs an OS-independent gate. **P3** |

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
| 2.1 | correct clause 7's MSYS2 address (ADR + `open-todos:6258-6260`) | the deletion list is the completion test; a wrong address cannot be checked off |
| 4.3 | ADR 0053 "eleven `.blp`" → twelve (`:24,68,134`) | the flip PR cites this census as its evidence |
| 4.4 | `open-todos:6234-6235` 41/42 → 43/43 | same sentence, same claim |
| 5 | `rolldown-plugin-gjsify/AGENTS.md:25`, `cli/AGENTS.md:163`, `check-system-deps.ts:584-592` | ADR 0053 § Implementation says the rule changes belong to the PR that earns them |
| 2.3 | `open-todos:6257-6258` storybook-window item → scoping, not deletion | one line, same file and paragraph as 4.4 |

Plus the two things that are preconditions rather than edits: **#1692 must merge first** (§ 1.1),
and the bootstrap weight of `@girs/gtk-4.0` + `@girs/adw-1` must be measured (§ 1.3).

### 7.2 Does not ride along

| § | item | priority | why separate |
|---|---|---|---|
| 4.7 | ADR 0060's P2 is already implemented | **P1** | `install`, not Blueprint; and it is urgent on its own — someone will build it twice |
| 4.10 | 0062 vs 0029 on `@girs` 5.2.0 publication | **P1** | belongs with #1692, which is the PR that disproves 0062's claim |
| 4.1 | 705 → 718 in `0062:226` and `0034:823` | P2 | docs sweep |
| 4.6 | ADR 0062's whole count set re-measured | P2 | a re-measurement pass over one ADR; large enough to be its own PR |
| 4.9 | five mis-aimed cross-references | P2 | docs sweep, same PR as 4.1/4.6 |
| 4.11 | 0058 "twelve" vs 0062 "thirteen" | P2 | docs sweep |
| 3.1 | `requireTool()` for the five `--require-<tool>` sites | P2 | a refactor; nothing about the flip needs it |
| 3.3 | write down + gate the exit-code convention (2 = could not measure) | P2 | the higher-value half of § 3, and independent |
| 6.1 | a `@girs` transitive closure oracle in `scripts/` | P2 | release tooling |
| 6.2 | the storybook-on-node synthetic manifest | P2 | **blocked**: touches `@girs` declarations, #1692's territory |
| 6.3 | three parser gaps from #1694's review | P2 | **blocked**: `packages/infra/blueprint/**` is #1694's territory |
| 6.4 | `check-shipped-runtime-packages.mjs:344-349` still header-only cache-bust | P2 | #1682 disproved its comment today; finish the sweep it started |
| 5.1 | ADR 0024:991 never received the `bindtextdomain` amendment 0059 announces | P2 | shipping, not Blueprint |
| 5.1 | "gtk-minimal has no `.blp`" in `create-gjsify/README.md:60`, `cli-reference.md:75` | P3 | docs sweep |
| 5.1 | the eleven-real-files counts inside `packages/infra/blueprint/` | P3 | **blocked**: #1694's territory |
| 4.2 | forward pointer at 0029's first stale 705 | P3 | docs sweep |
| 4.5 | two ADR header formats | P3 | docs sweep |
| 6.4 | `prebuilds.yml` submodule steps outside #1688's action | P3 | cover them, or say in ADR 0061 why not |
| 6.4 | the duplicated `audit-runtimes.yml` block | P3 | CI tidy-up |
| 4.8 | ADR 0059's Status vs its shipped step | P3 | one-line amendment |

### 7.3 Suggested order

1. **#1692 merges** — unblocks everything (§ 1.1, § 4.10, § 6.2).
2. **#1694 merges** — unblocks § 6.3 and settles whether `extern-type` is still refused (§ 1.5).
3. **ADR 0060 correction** (§ 4.7) — independent and P1; do it now, it is not queued behind anything.
4. **Measure the bootstrap weight** (§ 1.3). If it is bad, the flip changes shape before it is written.
5. **The flip PR** — § 7.1 as one atomic change.
6. **Docs sweep** — §§ 4.1, 4.2, 4.5, 4.6, 4.8, 4.9, 4.11 in one PR.
7. **Guard work** — § 3.3 then § 3.1.
8. **Release tooling** — § 6.1, § 6.2.

### 7.4 Does the flip need an ADR of its own?

**Yes, and ADR 0063 is free** — 0059-0062 are taken on `main`, and none of the three open PRs
(#1677, #1692, #1694) claims a new number.

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
- **The npm registry state** for the first-publish caveat (§ 1.7) — no network call was made.
- **Whether external consumers use a refused construct** (§ 1.5). Unknowable from this repo;
  it is a judgement, not a measurement, and § 7.4 is where it gets made.
