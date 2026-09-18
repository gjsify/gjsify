# 60. What `gjsify install` borrows from Yarn 4 next, and what it refuses

- **Status:** Proposed (2026-09-15), **amended 2026-09-16** — see
  [Amendment](#amendment-2026-09-16--p2-shipped-in-1686-one-commit-before-this-adr-merged).
  The decision and its ordering stand; **P2 is done**, and the six items marked
  **[corrected]** below did not hold when this merged.
- **Deciders:** Pascal Garber
- **Scope:** `@gjsify/cli`'s package-management surface — `install`, its lockfile
  (`gjsify-lock.json` v4), `--immutable`, the tarball store, `upgrade --check/--align`,
  and the CI caches that feed them. It settles nothing about the bundler, `gjsify build`,
  or `gjsify ship`.
- **Related:** [ADR 0001](0001-install-clean-separation.md) (install is non-destructive),
  [ADR 0002](0002-bootstrap-bundle-minimization.md) (CI reaches the CLI through the
  PUBLISHED bootstrap — the release-latency constraint that decides item P1's *location*),
  [ADR 0025](0025-prune-the-install-prefix.md) (prune decides by manifest read; reachability
  deferred for want of an assembly record),
  [ADR 0029](0029-girs-widget-vocabulary.md) (the `@girs` subpath hazard § Risks 1)
  **[corrected]**,
  PR #1686 / issue #1683 (the tree-verification fix this ADR generalises),
  `status/open-todos.md` § *No prefix carries that list*

## What was measured, and what was not

Three kinds of evidence. **gjsify** was read at `da8680b220` on a Fedora workstation; every
row names the grep that produced it. **Yarn** was read from yarnpkg.com and the
`yarnpkg/berry` sources; every row names the URL or file.

**Items marked [corrected] did not survive re-measurement** — two were closed by #1686
before this document merged, three counts were never right, and one is a mis-described
cross-reference. The Amendment gives each one's state on `main` and the command that reads
it. The Yarn rows are untouched by it.

**And, on review, Yarn 4.9.2 was run.** The first revision of this document was written
without executing Yarn and said so. The three claims decisions rest on — cache-hit
re-verification, the conditional-package exception, and whether Yarn detects an extraneous
`node_modules` entry — were afterwards settled by running `yarn@4.9.2` against scratch
projects on this workstation. Rows marked **(run)** are observed behaviour, and the
sections that rely on them say which command produced what. Every other Yarn row is still
a claim about what the source and docs *say*; where a question remains read and not run,
the row says so and stops.

| probe | result |
|---|---|
| `grep -n "describeLockfileDrift(existingLock" install-backend-native.ts` | one hit, `:334` — `--immutable` compares `lockfile.requested` against the live top-level specs. **Manifests vs lockfile only; the tree is never read** |
| `grep -rn "install-state\|installState" packages/infra/cli/src` | **0 hits** — no record of what a prefix was assembled from exists |
| `function isAlreadyExtracted` (`:1655-1674`) | compares `package.json`'s `name` + `version` **only**. The recorded `integrity` is never checked against extracted bytes |
| `grep -rn "GJSIFY_INSTALL_FORCE_EXTRACT"` over the whole tree | **2 hits, both on one line of one file** **[corrected]** (`:1698-1699`). The re-extract lever is an undocumented env var: no flag, no `--help`, no mention in any workflow or doc |
| `ls packages/infra/cli/src/commands \| grep -c dedupe` | **0** — no `dedupe` command |
| `grep -c "'--mode'" commands/install.ts` | **0** — no `--mode=` variants |
| `git ls-files \| grep -c yarn.config` | **0** — no constraints file of any kind |
| `git ls-files packages/infra/manifest-conformance/lib/rules \| wc -l` | **14** — a rule registry already exists, with a `field-coverage` meta-rule |
| `grep -rn "restore-keys" .github/actions/gjsify-setup/action.yml` | `:119-120` → `node-modules-v1-`, a bare prefix matching any commit's tree **[corrected]** |
| lockfile entry shape (`python3 -c "json.load(...)"`, 1852 packages) | every entry carries `version` + `resolved` + `integrity` (SRI `sha512-…`) |
| `grep -rl '"@girs/' --include=package.json` | **204** manifests declare `@girs/*` — the blast radius of incident 1 **[corrected]** |
| `npm-registry/src/tarball.ts` + `integrity.ts` | SRI **is** verified on download (`verifyIntegrity`, `IntegrityError`, covered by `index.spec.ts`) |
| `getCachedTarball()` (`install-tarball-cache.ts:85-89`) | SRI is **not** re-verified on a cache HIT — the bytes at the content-addressed path are returned as-is (`readCacheFile` is `existsSync` + `readFileSync`, nothing else). Deliberate, and stated in the caller's comment. `getForeignCachedTarball()` (npm's cacache) has the same property, so the store has **two** unverified readers, not one **[corrected]** |
| lockfile coverage of *conditional* packages (`json.load`, filter `os`/`cpu`) | **134** **[corrected]** platform-gated entries, **0** of them without `integrity`. gjsify hashes the platform bindings Yarn declines to — see § 2 |
| **(run)** `yarn@4.9.2 install`, cache zip swapped for another package's | `YN0018: left-pad@npm:1.3.0: The remote archive doesn't match the expected checksum`, no flag passed. Identical result with `enableGlobalCache: false` and `true` |
| **(run)** `yarn@4.9.2 install`, tampered `@esbuild/linux-x64` zip (a `conditions:` package) | installs silently, `TAMPERED.txt` lands in `node_modules`. `--check-cache` catches it. The lockfile carries **no `checksum:` line at all** for that entry |
| **(run)** `yarn@4.9.2 install --immutable`, four tree states | a package `node_modules/.yarn-state.yml` records but the lockfile dropped is **pruned silently**; a hand-planted one it never recorded **survives**, exit 0; deleting that state file relinks the tree and sweeps both. This corrects the first revision's reframing of incident 2 — see § 2 |
| **Not measured:** any PnP behaviour under GJS | no PnP install was attempted under SpiderMonkey. The refusal in § 5 is argued from PnP's documented mechanism, not from a failed run |

## Context — three incidents, one week

**Incident 1 — inconsistent ranges.** A PR bumped `@girs` in 2 manifests; the other
declarations stayed behind. `gjsify upgrade --check` caught it, and it caught it because
someone had written that specific rule: `dep-aggregation.ts` groups declarations by name
and `declaredRanges.size > 1` **is** the inconsistency. It runs in CI
(`main.yml:477-480`). The rule is right. What is worth examining is that it is a *command
flag*, and that it is not the only one of its kind.

**Incident 2 — `--immutable` accepted an undescribed tree.** The installer only ever added.
A cache-restored `node_modules` carrying 311 extraneous packages — some of them *nested*
(`node_modules/@girs/gtk-4.0/node_modules/@girs/graphene-1.0`) — passed `--immutable` with
exit 0, and `tsc` then saw one type under two identities (TS2883). PR #1686 is landing the
refusal: name the strangers, fail, do not delete.

**Incident 3 — a cache restored by prefix poisoned a PR, permanently.** `gjsify-setup`
keys the `node_modules` cache on `hashFiles('gjsify-lock.json')` with
`restore-keys: node-modules-v1-`. A lockfile change missed the exact key, the prefix
fallback restored a tree built for a *different* lockfile, `--immutable` added what was
missing and pruned nothing, and the still-wrong tree was saved under the **new** key. No
re-run could go green; the caches had to be deleted by hand.

The three are one question asked three times: **what, exactly, is the authoritative
description of a correct tree, and who is allowed to check a real tree against it?**

## 1. What gjsify already borrowed — so nothing below re-proposes it

Read before proposing. The CLI is further along the Yarn path than its flag list suggests.

| Yarn 4 concept | gjsify today | evidence |
|---|---|---|
| `yarn workspaces foreach -pt` | `gjsify foreach <script> -ptv --include/--exclude/--no-private` | root `package.json` scripts |
| a committed lockfile | `gjsify-lock.json`, `lockfileVersion: 4`, `requested` + `packages` | the file |
| `--immutable` as a CI gate | `gjsify install --immutable`, names the drifted specs | `describeLockfileDrift` |
| content-addressed store | `$XDG_CACHE_HOME/gjsify/tarballs/v1/<algo>/<shard>/<hex>.tgz`, keyed by SRI | `install-tarball-cache.ts` header, which says it mirrors "pnpm / yarn-berry's store layout" |
| checksums recorded in the lockfile | `integrity: sha512-…` on all 1852 entries | lockfile |
| `workspace:` protocol | resolved, packed and published (`pack-workspace-protocol` e2e) | 64 hits in CLI sources |
| PnP **interop as a consumer** | `@gjsify/rolldown-plugin-pnp`, `pnpapi` relay, `cli-only-pnp` + `pnp-zip-static-reads` e2e suites | those suites |

So the content-addressed store — the thing usually recommended first — **already exists**,
and that changes what incident 3 is about. See § 4.

## 2. Yarn's shape, where it differs

Yarn's design answers the § Context question with one sentence: **an install-state file,
not a disk scan, is what a tree is checked against.** Three consequences follow.

- *The linker reconciles against a RECORD, not against the lockfile directly.* Yarn's
  `node-modules` linker keeps `node_modules/.yarn-state.yml` and diffs the tree that file
  describes against the tree the new resolution implies, deleting locations that were in the
  old one and are not in the new (`NodeModulesLinker.ts`, `persistNodeModules()` →
  `removeOutdatedDirs()`). The file's own header says removing it "will cause your
  node_modules installation to become invalidated".

  The consequence is sharper than "Yarn prunes", and it is the single most useful fact in
  this document: **a directory Yarn never recorded is invisible to that diff.**
  `syncPreinstallStateWithDisk()` only ever *narrows* the previous tree — it checks whether
  recorded entries still exist and never enumerates unknown ones. So a stranger placed by
  another tool survives, exactly as it does in gjsify. The one case where Yarn removes it is
  when the state file is **missing**, where the top-level `node_modules` is emptied wholesale
  (`removeDir(..., {contentsOnly: true})`) — which is why an npm-produced tree gets flattened
  by the first `yarn install`.
- *`--immutable` and `--immutable-cache` are two promises, not one.* Verbatim from the CLI
  source: `--immutable` aborts "if **the lockfile** was to be modified"; `--immutable-cache`
  aborts "if **the cache folder** was to be modified". `--immutable` **does not inspect
  `node_modules` at all** — `Project.ts install()` fails on a missing lockfile, on a
  regenerated lockfile that differs, and on `immutablePatterns` checksum drift, and on
  nothing else.
- *Constraints are a declarative engine over all workspaces*, not a flag on a command.
  Yarn 4's supported surface is a JS API (`yarn.config.cjs`, `defineConfig`, a
  `constraints({Yarn})` hook querying `Yarn.workspaces()` / `Yarn.dependencies()`), with
  `yarn constraints` to report (exit 0/1) and `--fix` to rewrite. Prolog was **not removed**
  in v4 — the docs call it "still supported but should be considered deprecated", and the
  command falls back to it when no `yarn.config.cjs` exports `constraints`. It ships **no
  built-in** "all workspaces agree on a range" rule; that is a copy-paste docs example
  (`enforceConsistentDependenciesAcrossTheProject`), under a heading that says Yarn is
  "thinking to provide some of them as builtin helpers later on".

### How Yarn 4 actually behaves on incident 2 — corrected on review

An earlier revision of this section claimed that **stock Yarn 4 would not have caught
incident 2 either**, and concluded that PR #1686 puts gjsify ahead of Yarn. That is a
flattering conclusion about our own work, so it was put to a real Yarn. It is **half right,
and the wrong half was load-bearing.** What follows replaces it.

Yarn's node-modules linker keeps a record of what it linked: `node_modules/.yarn-state.yml`,
written inside the tree, listing every package and its locations. Four runs with
`yarn@4.9.2`, `nodeLinker: node-modules`, separate the cases the earlier claim ran together.

1. **A package the record names, that the lockfile no longer wants, is removed.** Install
   with `left-pad` + `is-odd`, then drop `is-odd` from the manifest and install again:
   `is-odd` and its transitive `is-number` are gone from `node_modules`. This holds under
   `yarn install --immutable` too — exit 0, no message, tree silently corrected.
2. **A package in no record is invisible and survives.** Hand-plant `node_modules/evil/`
   with a `package.json` no manifest and no lockfile mentions, and drop a stray file inside
   a package that *is* declared. `yarn install --immutable` exits 0, warns about nothing,
   and leaves both in place.
3. **No record at all means a rebuild.** Delete `node_modules/.yarn-state.yml` and both the
   planted package and the stray file are swept away as collateral — Yarn stops diffing and
   relinks the tree wholesale.
4. Deleting `.yarn/install-state.gz` changes none of this; it is the resolution cache, not
   the linker's record. The earlier revision tested that file and mistook it for this one.

**Applied to incidents 2 and 3, this reverses the conclusion.** Both were a `node_modules`
restored from a cache built for a *different lockfile* — 311 packages an earlier, legitimate
install had written. Under Yarn those packages are exactly case 1: the restored tree carries
its own `.yarn-state.yml` naming them, the next install diffs against it, and they are
pruned. Yarn would not have *reported* the divergence — but it would not have been poisoned
by it either, and no cache would have needed deleting by hand.

So the honest split is this. Yarn has the **prune** and gjsify does not: gjsify's installer
only ever adds, which is why a stale tree accumulated instead of converging. Yarn lacks the
**refusal** and gjsify is about to have it: `--immutable` silently fixes rather than failing,
and berry#3210 — *"[Feature] A flag to enforce consistency of unplugged files and
node_modules"*, open since 2021-08-01 — is a request for precisely that. PR #1686 is
genuinely ahead of Yarn on the refusal. It is **not** the half that would have prevented
these two incidents; the prune is, and that is the half gjsify is missing.

That promotes P3 from a nice borrowing to the item that closes the real gap, and it means
the tree question does have a design to copy after all — `.yarn-state.yml`, exactly as § P3
already argues. Case 2 marks the limit of what copying it buys: a record-based diff still
cannot see a package no install of ours ever wrote, so #1686's disk scan remains the only
thing that catches a true stranger. The two are complements, not alternatives.

One boundary, so this is not read wider than it was tested: all of the above is the
`node-modules` linker. PnP's linker sweeps its own output the same way — `PnpLinker.ts`
removes any entry under `.yarn/unplugged` the current install did not write.

## 3. Decision — prioritised, with the cost named

### P1 — move cross-workspace dependency rules into the rule registry. *(incident 1)*

**Not** a new constraints engine. gjsify already has the better half of one:
`@gjsify/manifest-conformance` is a rule registry whose `field-coverage` meta-rule fails on
any `gjsify.*` key no rule claims — a self-closing property Yarn's constraints engine does
not have. What it does not yet hold is *cross-workspace dependency* rules, and those have
consequently landed in two other places:

1. `gjsify upgrade --check` / `--align` / `--exact` — a CLI command;
2. `scripts/check-girs-exact-pins.mjs` — a standalone script.

The script's own header explains why it is not a third flag, and the reason is structural,
not stylistic: CI reaches the CLI through the **published bootstrap** (ADR 0002), so a check
written against a flag added in the same commit fails with `Unknown argument` until the next
release — "measured, on this very change". That is the decisive argument, and it points away
from `upgrade` for anything new. A rule in the registry runs from the repo and has no
release latency.

Concretely: a `dependency-ranges` rule reading `ctx.packages` (which is already every
workspace-glob package) and reusing `groupByDependency` from `dep-aggregation.ts`.
`upgrade --align` stays as the fixer — and it is worth noting that it is *better* than
Yarn's published example. `enforceConsistentDependenciesAcrossTheProject` deliberately picks
no winner, so a genuine disagreement surfaces as Yarn's **unfixable** "Conflict detected in
constraint targeting …" error. `--align` resolves to the highest declared version and
rewrites. On this specific rule gjsify is ahead; do not regress it while borrowing the
packaging.

**Cost, honestly:** small but not zero. One rule file, plus a decision about `scope`
(`portable` vs `repo`) that the registry forces and that is genuinely arguable for a rule
about *this* repo's `@girs` pins. It also creates a third caller of the same aggregation,
so `dep-aggregation.ts` must be importable from `.mjs` rule code. The risk is a *duplicated*
rule that disagrees with `upgrade --check`; the mitigation is that `upgrade` keeps the
interactive/fix surface and the registry keeps the gate.

One trap to inherit knowingly: `yarn constraints --fix` rewrites `package.json` and **not**
the lockfile — the command has no `project.install()` — so a fixed tree can be left with a
stale lockfile. Whatever gjsify wires must run `--align` *before* `install --immutable`, not
after, or CI will trade one red for another.

### P2 — cache the content-addressed store, not the tree; keep the prefix fallback there. *(incident 3)*

> **Done — shipped whole in #1686 (`ab53678d65`), which merged BEFORE this ADR.** All three
> parts: the store is cached with a prefix fallback, the `node_modules` fallback stays
> dropped, and SRI is re-verified on a cache hit. The reasoning below is kept because it is
> why; the premises it argues from are corrected in the Amendment. Do not build this twice.

This is the item with the best cost/benefit in the document, and PR #1686 already names it
as the next move.

Yarn's checksums make an imprecise cache restore safe **for the cache**, and the reason is
narrow and verifiable. A cache entry is one zip per package; the lockfile's `checksum:` is
`<cacheKey>/<sha512 of the zip bytes>`; and — the load-bearing part — **that hash is
re-verified on every install**, not only on a cache miss. `fetchEverything()` passes cache
options without `skipIntegrityCheck`, and a cache *hit* still calls `validateFile()`, which
re-hashes the file off disk and compares it to the lockfile, with `checksumBehavior`
defaulting to `throw`. `Cache.ts` states the intent outright: *"It doesn't matter if that
makes the hash easier to collide with, because we check the file hashes during each install
anyway."* A stale or foreign hit is therefore a *superset* of what is needed, never a
*wrong* answer.

**Run, not inferred.** With `yarn@4.9.2`, a scratch project and one cache zip overwritten by
another package's, a plain `yarn install` — no `--check-cache`, no flag of any kind — fails
with `YN0018: left-pad@npm:1.3.0: The remote archive doesn't match the expected checksum`.
The same holds under `enableGlobalCache: true`, which is v4's default and where the cache
filename does not even carry the hash. So the re-hash is not conditional on `--check-cache`,
not conditional on the cache mode, and not an artefact of the filename: `--check-cache` only
*escalates* it, from "re-hash off disk" to "re-download and compare against the remote".

**With one exception, and it lands squarely on this repo — though not the way it first
looks.** `Cache.ts` skips verification entirely for *conditional* locators —
`optionalDependencies` gated by `os`/`cpu`:
`if (controlPath === null && opts.unstablePackages?.has(locator.locatorHash)) return
{isValid: true, hash: null};`. Those are exactly the platform-binary packages, and this
workspace is unusually full of them: `@rolldown/binding-*`, `@gjsify/*-<os>-<arch>`,
`lightningcss-native-*`, `oxfmt-native-*` — the set ADR 0017 created and ADR 0025's prune
pass exists to clean up after. Confirmed by running it: a tampered `@esbuild/linux-x64` zip
installs silently and the planted file lands in `node_modules`; `--check-cache` catches it.

The deeper reason is worth stating, because it changes what P2 has to decide. Yarn does not
merely skip the *check* for these packages — it never records the hash. `exposedChecksum`
drops conditional locators from the lockfile, and the lockfile confirms it: the
`@esbuild/linux-x64` entry carries `conditions: os=linux & cpu=x64` and **no `checksum:`
line at all**. Yarn's exception is therefore a limitation gjsify does not inherit:
`gjsify-lock.json` carries `integrity` for all 1852 entries, including all 134 platform-gated
ones. So "content-addressed means a prefix restore cannot be wrong" holds for ordinary
packages and not for Yarn's platform bindings — but gjsify has the hash Yarn declines to
keep, and P2 should put the platform packages **inside** the guarantee rather than treat
this as an open question.

Two further conditions, because a CI job can silently void the whole argument: the lockfile
must come from the trusted checkout rather than from the restored cache, and
`checksumBehavior` must stay `throw` — `ignore` skips the comparison outright and `update`
rewrites the lockfile to match whatever the cache holds. Both are bypasses, not degradations.

One reading trap worth naming for whoever traces this next: `linkEverything()` *does* pass
`skipIntegrityCheck: true`. That is not a second exception — the fetch step has already
validated every entry by the time the linker runs, and re-hashing there would only pay the
cost twice. The guarantee lives in `fetchEverything()`, and only there.

That property **does not extend to `node_modules`**. An extracted
tree is not content-addressed, carries no checksum, and gjsify's own
`isAlreadyExtracted` accepts it on `name` + `version` alone. This is the precise reason
incident 3 was unrecoverable: nothing in the pipeline could tell a correct tree from a
poisoned one bearing the right version numbers.

So the answer to "does content-addressing make prefix restoration safe?" is **yes for the
store, no for the tree** — and gjsify already has the store. The fix is to cache
`.gjsify-cache/gjsify/tarballs` under its own key *with* a prefix fallback, and to keep the
`node_modules` fallback dropped as #1686 does. That also buys back most of #1686's cost:
its analysis found CI never persists `.gjsify-cache` at all, so a lockfile change today
re-downloads all ~1850 tarballs on top of a ~16 min extract.

**One coupling that must ship with it.** gjsify verifies SRI on *download*
(`npm-registry/src/tarball.ts:41` → `verifyIntegrity`, `IntegrityError`) but **not on a cache
hit**: `getCachedTarball()` returns the bytes at the content-addressed path with no
re-hash, and the caller's comment says why — "tarballs are immutable per SRI integrity, so a
hash hit is byte-identical to what the registry would return and needs no verifying
re-download". The claim was re-checked against the whole path rather than the one function,
because a missing safeguard is the kind of finding that causes work: `readCacheFile()` is
`existsSync` + `readFileSync` and hashes nothing; the only caller
(`install-backend-native.ts:1707`) goes straight from those bytes to `extractWithStallGuard`;
and the one gate upstream of it, `isAlreadyExtracted`, compares `name` + `version`. There is
no check elsewhere. Note also that the store has **two** unverified readers, not one —
`getForeignCachedTarball()` reads npm's cacache on the same SRI key with the same trust, and
its own doc comment says so. Whatever P2 wires must cover both.

That reasoning is sound for a cache this machine wrote. It stops being sound
the moment the store is restored from a **shared CI cache by prefix**, which is exactly what
P2 proposes. Yarn re-hashes on every install *including* cache hits — run, not inferred,
above — and `Cache.ts` says the design leans on it: *"we check the file hashes during each
install anyway."*

So P2 is two changes, not one: cache the store, **and** verify on cache hit. Shipping the
first without the second moves trust onto an artifact nothing checks — the same mistake in a
new location.

**Cost:** one cache step, one hash per cache hit (measurable but small against a ~16 min
extract), and a real risk that must be weighed first — GitHub's 10 GB per-repo cache limit.
A tarball-store entry large enough to matter can evict the very `node_modules` caches it
exists to help. Measure the store's size before wiring it.

**Honest limit on the authority here:** Yarn publishes **no** CI-caching guidance. There is
no CI page in its docs, and the GitHub Actions section of *Caching* is an explicit stub
("We're still investigating the exact set of defaults…"). The "cache the cache, not the
tree" conclusion is derived from the checksum mechanics above, not quoted from Yarn.

### P3 — verify the tree against the integrity the lockfile already records. *(incident 3, preventative for 2)*

The lockfile carries an SRI hash for all 1852 packages and nothing ever checks it against
what is on disk. `--immutable` after #1686 will catch a *stranger* (a package that should
not be there); it still will not catch a package that is present, correctly named and
versioned, and **wrong inside**. That is the exact residue of incident 3.

The cheap version is not a full re-hash: record, at install time, the set of
`(installPath → integrity)` pairs the install placed — the assembly record ADR 0025 and
`status/open-todos.md` § *No prefix carries that list* both say does not exist. That record
is what makes reachability-pruning justifiable later, so this one item unblocks a second.

**This is the one place where Yarn has a design worth copying wholesale**, and it is not a
flag: it is `node_modules/.yarn-state.yml`. Yarn does not derive the tree's correctness from
the lockfile at verification time; it writes down what it linked and diffs against *that*.
gjsify has the lockfile and the SRI hashes and no such file — which is why § 2's "a stranger
is invisible to the diff" applies here too, and why #1686 had to reach for a disk scan
instead. Borrow the artefact, and take its two known weaknesses with open eyes: a state file
can be deleted (Yarn's response is to wipe, which ADR 0001 forbids here) and it is trusted
by mtime rather than re-read, which is a cheapness gjsify may or may not want.

And the parallel runs deeper than it first looks. Yarn has gjsify's `isAlreadyExtracted`
hole too, in the one place it also extracts: a package unplugged out of its zip is skipped
whenever a `.ready` marker file exists beside it (`PnpLinker.ts`), with no re-checksum. So
*"bytes that have been unpacked stop being verified"* is not a gjsify defect that Yarn
avoided — it is a property of both, and P3 is the place to decide gjsify should be the one
that does better.

**Cost:** this is the most expensive item here and should not be sold cheaply. Hashing an
extracted directory is not the same hash as the tarball's, so "verify the tree against
`integrity`" cannot be done directly — it needs either a per-file manifest written at
extract time or a re-derived tree hash, and both add install-time work on a path whose cold
run already costs ~16 minutes. Scope it to a record first (cheap, unblocks pruning), and
treat full verification as a separate, later decision.

### P4 — promote `GJSIFY_INSTALL_FORCE_EXTRACT` to a documented flag. *(incident 3)*

The recovery lever for a corrupted tree exists and is invisible: two greps over the whole
repository find it on one line of one file. During incident 3 the caches were deleted by
hand, which is what you do when you do not know a lever exists. Yarn's nearest equivalent
is `yarn install --check-cache`, which is a documented flag precisely because it is what
you reach for when you suspect the cache.

**Cost:** an afternoon. This is the highest ratio of relief to effort in the document, and
it is the item most likely to be skipped because it is not architectural.

### P5 — `--immutable-cache` as a second, separate promise. *(preventative)*

Yarn splits "the lockfile must not change" from "the cache must not gain entries". gjsify's
`--immutable` today promises only the first (and, after #1686, that the tree holds no
strangers). Splitting the cache promise out would make an offline/hermetic CI leg
expressible.

**Cost:** low in code, but it adds a flag to a surface that already confuses people about
what `--immutable` covers — and it solves **no incident on this list**. Explicitly
preventative. Do P2 first; if the tarball store is cached properly, the hermetic-leg
question may not need a flag at all.

### P6 — `patch:` protocol. *(preventative, and probably not)*

`workspace:` is in use; `link:`/`portal:` appear in the sources but the distinction Yarn
draws is not one this repo has needed. That distinction, for the record, is sharper than
"resolves dependencies or not": a `link:` target *"cannot have a `package.json` file, and
thus can't have dependencies"* — it is a pointer to an arbitrary folder — whereas a
`portal:` target must exist at resolution time and is *"treated like any other package in
the dependency tree"*. gjsify's workspace sources are already symlinked by the installer, so
neither protocol adds a capability here. `patch:` is the only one that answers a live need —
patching a dependency without vendoring it — and this repo's standing rule is the opposite
one: **fix it at the core**. A `patch:` entry is a workaround with a file attached, and the
repo already treats workarounds as things that ossify.

**Cost:** implementing a resolution protocol is not small, and the thing it buys is
something the workspace has deliberately decided not to do. Recommended **against** unless
a specific unfixable third-party dependency appears.

## 4. `yarn dedupe` — a real question with a "no" attached

`yarn dedupe` "deduplicate[s] dependencies with overlapping ranges", rewriting the lockfile
so they resolve to fewer distinct versions. It has exactly one strategy, `highest` — "can
only be upgraded, never downgraded" — and a `--check` flag that exits 1 when duplicates are
found, which is the CI shape. The
gjsify lockfile holds 1852 packages and incident 2 involved a *nested* placement, which is
what dedupe exists to reduce — so the question is fair. It is still a no, for one reason:
gjsify's installer hoists and its nesting is a *placement* decision, not a resolution
decision. Incident 2's nested `@girs/graphene-1.0` was not there because resolution demanded
two versions; it was there because an old tree was restored and nothing removed it. Dedupe
would not have prevented it and would not have cleaned it up.

**Cost of doing it anyway:** a lockfile-rewriting command is a large surface with a large
blast radius, justified by no incident on this list. Recommended **against** for now;
revisit if a duplicate-version problem is ever actually measured.

## 5. PnP — the honest no

PnP would dissolve incident 2 outright: with no `node_modules`, there is no extraneous
package to find, and Yarn's default linker in v4 is PnP. It still cannot be gjsify's linker,
and the reason is not preference.

**PnP's resolution is a Node-runtime hook**, and this is not an inference. Yarn's own
description: PnP "tells Yarn to generate a single **Node.js loader file** in place of the
typical `node_modules` folder… informing your tools as to the location of the packages on
the disk and letting them know how to resolve `require` and `import` calls". In the
implementation, `applyPatch.ts` monkey-patches `Module._load`, `Module._resolveFilename` and
`Module._extensions['.js']`, sets `process.versions.pnp`, and patches `fs`. ESM goes through
a separate `.pnp.loader.mjs`, activated by injecting
`--require <.pnp.cjs> --experimental-loader …` into `NODE_OPTIONS`. The ESM loader's own
feature detection branches on `process.versions.node`.

Every one of those is a Node API. Its correctness depends on a host that *has* a Node
resolver to patch.

gjsify's target runtime is **GJS on SpiderMonkey**, which has no CommonJS, no Node resolver,
and no loader-hook API to install one into. gjsify's own bootstrap is required to run under
GJS with no Node present at all (`tests/e2e/node-free-bootstrap`). A PnP-linked tree is
therefore not merely awkward under the runtime gjsify exists to serve — it is unreadable by
it, because the file layout PnP produces (zips, resolved through an API) is only navigable
*through* that API.

The distinction that matters, and which the existing e2e suites make precisely: gjsify
already supports PnP **where PnP runs**, which is at build time, under Node, in someone
else's project. `@gjsify/rolldown-plugin-pnp` reads zip-resident sources and
`inlineStaticReads` bakes their bytes into the bundle. That is interop with a consumer's
choice, and it works because the *build* is a Node process. Adopting PnP as gjsify's own
linker would put it on the runtime side, where there is no host to hook.

Add to that: the repo ships **bundles**. For a bundled artifact, the linker's job is over
before the artifact exists — PnP would buy a dev-time property at the cost of the one
runtime gjsify is for.

**One honest qualification, which does not change the answer.** The argument above is about
Yarn's *implementation*, not about PnP as an idea. The
[PnP specification](https://yarnpkg.com/advanced/pnp-spec) is deliberately written for
third-party implementers — it publishes the full resolution algorithm (`PNP_RESOLVE`,
`RESOLVE_TO_UNQUALIFIED`, `FIND_LOCATOR`), and `pnpEnableInlining: false` emits a plain-JSON
`.pnp.data.json` precisely so a non-Node host can build its own resolver over the data. So
"PnP cannot work under GJS" is too strong: *a* PnP resolver could be written for GJS. What
cannot be reused is everything Yarn ships — and writing a second implementation of a
resolution standard, to replace a `node_modules` layout that GJS reads natively today, buys
nothing this repo wants. The refusal is on cost and fit, not impossibility.

Worth noting for scale: Yarn's own docs record exactly one runtime exclusion, React
Native/Expo, which "require using typical `node_modules` installs". There is **no** official
statement about browsers, Bun, Deno or other non-Node hosts either way.

**Recommended against, permanently, as a linker.** Keep the consumer-side interop.

## 6. What else not to copy

- **Prolog constraints.** Still *shipped* in Yarn 4 — the docs call them "still supported but
  should be considered deprecated", and `constraints.ts` falls back to the Prolog engine when
  no `yarn.config.cjs` exports a `constraints` method. Do not reach for the older shape, and
  take the general lesson with it: the *engine* was never the valuable part. The registry is.
  gjsify should not acquire a query language at all.
- **`--mode=` variants.** Yarn 4 has exactly **two**, not three: `skip-build` and
  `update-lockfile` (`enum InstallMode`, `Project.ts`). A `cache-only` mode is sometimes
  attributed to Yarn and **does not exist** — the string appears nowhere in the docs or in
  `master`. Of the two real ones, `skip-build` is meaningless here, where building is a
  separate command by design (ADR 0001), and `update-lockfile` targets a bot workflow
  (Renovate/Dependabot) this repo does not run.
- **A tree-wiping linker.** Yarn's recovery path for an unrecognised tree is to empty
  `node_modules` wholesale when the state file is absent. That is a legitimate choice for a
  tool that owns the directory outright; it is the wrong default for gjsify, whose
  `automaticPruneRefusal` already declines to delete under `--immutable` and whose ADR 0001
  makes install non-destructive on purpose. Adopt the state file (P3), not the wipe.
- **Yarn's silence on the tree — and the remedy it *does* model.** Yarn has no
  "name the extraneous packages" path for `node_modules`; it reconciles what it recorded and
  says nothing about the rest. But under `--immutable-cache` it does exactly what PR #1686
  chose, for the cache: one named error per unused file —
  `"<file> appears to be unused and would be marked for deletion, but the cache is immutable"`
  — rather than a deletion. So #1686's "name and refuse" is not a departure from Yarn; it is
  Yarn's own immutable-mode behaviour applied to the artefact Yarn never extended it to. The
  failure modes are asymmetric and that is why it holds: a wrong deletion loses work, a wrong
  refusal costs one red run carrying the exact paths.

## Consequences

- Cross-workspace dependency rules get one home, and `upgrade` stops being where new gates
  are added — which also routes around the published-bootstrap latency ADR 0002 imposes.
- The CI cache story inverts: cache the checksummed artifact with a prefix fallback, never
  the tree. "A tree is not safe to restore by prefix" becomes a stated rule rather than a
  lesson re-learned per incident.
- P3's assembly record is a prerequisite for the reachability pruning ADR 0025 deferred, so
  two open items collapse into one piece of work. § 2's measurements raise its standing
  further: the record is what prunes a stale restored tree, and pruning — not refusing — is
  what would have prevented incidents 2 and 3. #1686 supplies the refusal Yarn still lacks;
  it does not supply this.
- Nothing here changes the published contract of `@gjsify/cli`, except P4's new flag.

## Implementation

Order: **P4 → P2 → P1 → P3**, with P5 revisited after P2 and P6 not scheduled.
P4 and P2 are days and close the incident that reproduced itself; P1 is the structural one;
P3 is a track, not a task, and should be split (record first, verification later).

That order was set before § 2's measurements, and this ADR does not silently re-decide it:
P3's *record* half is now the item with the strongest incident claim behind it, and it is
the cheap half of a track whose expensive half can wait. Whether the record moves ahead of
P1 — or of P2 — is left open deliberately, and should be settled when this is accepted.

None of this is scheduled here. On acceptance it goes to `status/open-todos.md` per
governance; this ADR records the *why*.

## Sources

Yarn documentation, read 2026-09-15:
[features/constraints](https://yarnpkg.com/features/constraints) ·
[cli/constraints](https://yarnpkg.com/cli/constraints) ·
[cli/install](https://yarnpkg.com/cli/install) ·
[cli/dedupe](https://yarnpkg.com/cli/dedupe) ·
[configuration/yarnrc](https://yarnpkg.com/configuration/yarnrc) ·
[features/pnp](https://yarnpkg.com/features/pnp) ·
[features/linkers](https://yarnpkg.com/features/linkers) ·
[features/caching](https://yarnpkg.com/features/caching) ·
[protocol/portal](https://yarnpkg.com/protocol/portal) ·
[protocol/link](https://yarnpkg.com/protocol/link)

`yarnpkg/berry@master` sources, where the docs are silent or thinner than the behaviour:
`packages/yarnpkg-core/sources/{Project,Cache,hashUtils,structUtils}.ts` ·
`packages/plugin-nm/sources/NodeModulesLinker.ts` ·
`packages/plugin-constraints/sources/{commands/constraints,constraintUtils}.ts` ·
`packages/yarnpkg-types/sources/constraints.ts` ·
`packages/plugin-essentials/sources/{commands/install,commands/dedupe,index}.ts` ·
`packages/yarnpkg-pnp/sources/loader/applyPatch.ts` ·
`packages/yarnpkg-pnp/sources/esm-loader/loaderFlags.ts` ·
`packages/plugin-pnp/sources/{index,PnpLinker}.ts`

Open upstream issue relied on in § 2:
[berry#3210](https://github.com/yarnpkg/berry/issues/3210) — *"[Feature] A flag to enforce
consistency of unplugged files and node_modules"*, open since 2021-08-01 (state verified via
the GitHub API; its comment thread was not readable and is not relied on).

**Run on review**, with `yarn@4.9.2` (`repo.yarnpkg.com/4.9.2`) under Node 24 on Fedora,
against throwaway projects — three experiments, each stated where it is relied on: cache-hit
re-verification (§ P2), the conditional-package exception (§ P2), and extraneous-entry
survival under `--immutable`, with and without `.yarn/install-state.gz` (§ 2). The source
trace that preceded them was confirmed rather than corrected, except where § P2 now says so.

**Still not verified.** The `pnpm` linker was not inspected, so § 2 is a claim about
`nodeLinker: node-modules` only, and the experiments used that linker. No acceptance test
covering extraneous-package survival exists upstream
(`packages/acceptance-tests/pkg-tests-specs/sources/node-modules.test.ts` has no match for
`extraneous|stale|leftover`), so the § 2 result rests on this workstation's runs, not on
Yarn's own suite. Yarn makes **no** official statement about PnP under
browsers, Bun, Deno or any other non-Node host, so § 5 argues from the implementation's
Node API surface, never from a Yarn claim; whether Yarn's ESM wiring has since moved to
`module.register()` was not exhaustively audited, and only "`--require` plus
`--experimental-loader`" is verified. No PnP install was attempted under GJS.

Two doc/source discrepancies were found and are noted rather than resolved:
`yarnrc.json` gives `enableImmutableInstalls` a `"default": false` while the runtime default
is `isCI`, and it gives `compressionLevel` a `"default": "mixed"` while both its own prose
and `Configuration.ts` say `0`. In both cases the prose matches the code and the schema's
`default` field is stale — worth knowing before quoting that schema as authority.

## Amendment (2026-09-16) — P2 shipped in #1686, one commit before this ADR merged

This ADR was measured at `da8680b220` and merged as #1687 (`1bd3159d4b`). PR #1686
(`ab53678d65`) — which § Related already calls *"the tree-verification fix this ADR
generalises"* — landed **between** those two points and closed **all three** of P2's
premises. P2 was therefore implemented before the document proposing it existed, and left
standing it would have been built a second time. That, not the arithmetic below, is why this
amendment exists.

**P2 is done, not pending**; its heading in § 3 now says so. The decision, the P1–P6 set and
the `P4 → P2 → P1 → P3` order in § Implementation are deliberately **not** rewritten — an ADR
records what was decided when it was decided, and P2's reasoning is still why the shipped
shape is the right one. Only the evidence that reasoning quotes changes.

### P2's three premises, against `main`

| claimed | on `main` today |
|---|---|
| "SRI is **not** re-verified on a cache HIT … the store has **two** unverified readers, not one" (§ evidence, and again under P2's *"One coupling that must ship with it"*) | **False.** `getCachedTarball()` re-hashes and unlinks the blob on a mismatch — `install-tarball-cache.ts:114,118`. `getForeignCachedTarball()` re-hashes too (`:220`), and its doc comment (`:206-213`) retires the old argument by name: *"the next stage will probably notice" is not verification* |
| `restore-keys: node-modules-v1-`, "a bare prefix matching any commit's tree" (§ evidence; incident 3) | **Gone for the tree.** `.github/actions/gjsify-setup/action.yml:118` reads "EXACT KEY ONLY — no `restore-keys` fallback, deliberately", and `:120-126` keeps incident 3 as the reason. `restore-keys` survives in that file only where P2 asked for it: the tarball store (`:191`) and the build cache (`:369`) |
| "CI never persists `.gjsify-cache` at all" (under P2) | **False.** `action.yml:185-192` restores `.gjsify-cache/gjsify/tarballs` under `gjsify-tarballs-v1-<hashFiles(gjsify-lock.json)>` with `restore-keys: gjsify-tarballs-v1-`, and `:291-296` saves it |

### Three counts that were never right

These did not move under the document. They read the same at `da8680b220` — the commit
§ evidence names — as on `main`, so the error is in the probe, not in the tree, and no later
change can be blamed for them:

```sh
git ls-files '*package.json' | xargs grep -l '"@girs/' | wc -l   # 146, not 204
python3 -c "import json; p = json.load(open('gjsify-lock.json'))['packages']; \
print(len(p), len([k for k, v in p.items() if 'os' in v or 'cpu' in v]))"  # 1853 211, not 134
git grep -c GJSIFY_INSTALL_FORCE_EXTRACT -- . ':!docs/adr'       # 5 hits in 2 files
```

- **204 manifests declare `@girs/*` → 146.** That row's `grep -rl` recurses into
  `node_modules`, so it counted installed copies alongside tracked ones. Incident 1's blast
  radius is smaller than stated, not larger.
- **134 platform-gated lockfile entries → 211**, of 1853. The half P2 leans on is unaffected
  and holds: **0** of the 211 lack `integrity`, so gjsify does keep the hash Yarn's
  `exposedChecksum` drops for conditional locators.
- **`GJSIFY_INSTALL_FORCE_EXTRACT` is not "2 hits, both on one line of one file".** Five
  hits across two files: `install-backend-native.ts:1723-1724` (cited here as `:1698-1699`)
  and `tests/e2e/install-incremental-extract/run.mjs:23,182,189`, whose
  `it('GJSIFY_INSTALL_FORCE_EXTRACT=1 re-extracts everything')` exercises the lever.

### What holds, and is left alone

- **P4 stands, and so does the rest of its row.** The lever still has no flag, no `--help`
  entry and no mention in any workflow or doc; `git grep` finds it in one source file and
  one e2e suite, nowhere else. Only *invisible* needs softening — it is tested, just not
  reachable by anyone who has not read the installer. Nothing has shipped it.
- **Every Yarn row.** Nothing here re-runs `yarn@4.9.2` or re-reads `yarnpkg/berry`. The
  three **(run)** experiments, § 2's linker reading and § 5's refusal are claims about Yarn,
  and it is this repository that moved under them.
- **P1, P3, P5 and P6.** None has shipped.

### One cross-reference

§ Related cites ADR 0029 as "the `@girs` subpath hazard § Risks 1". `0029:387` § Risks has
three entries and the first is **Release coupling** (caret-vs-exact-pin); none of the three
concerns a subpath. The link resolves, its description does not — the hazard meant here is
0029's release-coupling risk.

### Status

Left at **Proposed**. P2 having shipped is an argument for accepting this, but acceptance is
a decision and this amendment only corrects measurements. Whoever accepts it should settle
that together with § Implementation's open question about where P3's record half sits in the
order.

Found by the parallel-day survey (#1695 § 4.7, § 4.9). Every row above was re-read against
`main` at `e49f9fbcf4` rather than carried over from the survey.
