# 60. What `gjsify install` borrows from Yarn 4 next, and what it refuses

- **Status:** Proposed (2026-09-15)
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
  [ADR 0029](0029-girs-widget-vocabulary.md) (the `@girs` subpath hazard § Risks 1),
  PR #1686 / issue #1683 (the tree-verification fix this ADR generalises),
  `status/open-todos.md` § *No prefix carries that list*

## What was measured, and what was not

Two sides, two kinds of evidence. **gjsify** was read at `da8680b220` on a Fedora
workstation; every row names the grep that produced it. **Yarn** was read from
yarnpkg.com and the `yarnpkg/berry` sources; every row names the URL or file. Nothing here
was produced by running Yarn 4 — no `yarn install` was executed for this document, so every
Yarn row is a claim about what Yarn's documentation and source *say*, not about observed
behaviour. Where a question could only be settled by running it, the row says so and stops.

| probe | result |
|---|---|
| `grep -n "describeLockfileDrift(existingLock" install-backend-native.ts` | one hit, `:334` — `--immutable` compares `lockfile.requested` against the live top-level specs. **Manifests vs lockfile only; the tree is never read** |
| `grep -rn "install-state\|installState" packages/infra/cli/src` | **0 hits** — no record of what a prefix was assembled from exists |
| `function isAlreadyExtracted` (`:1655-1674`) | compares `package.json`'s `name` + `version` **only**. The recorded `integrity` is never checked against extracted bytes |
| `grep -rn "GJSIFY_INSTALL_FORCE_EXTRACT"` over the whole tree | **2 hits, both on one line of one file** (`:1698-1699`). The re-extract lever is an undocumented env var: no flag, no `--help`, no mention in any workflow or doc |
| `ls packages/infra/cli/src/commands \| grep -c dedupe` | **0** — no `dedupe` command |
| `grep -c "'--mode'" commands/install.ts` | **0** — no `--mode=` variants |
| `git ls-files \| grep -c yarn.config` | **0** — no constraints file of any kind |
| `git ls-files packages/infra/manifest-conformance/lib/rules \| wc -l` | **14** — a rule registry already exists, with a `field-coverage` meta-rule |
| `grep -rn "restore-keys" .github/actions/gjsify-setup/action.yml` | `:119-120` → `node-modules-v1-`, a bare prefix matching any commit's tree |
| lockfile entry shape (`python3 -c "json.load(...)"`, 1852 packages) | every entry carries `version` + `resolved` + `integrity` (SRI `sha512-…`) |
| `grep -rl '"@girs/' --include=package.json` | **204** manifests declare `@girs/*` — the blast radius of incident 1 |
| `npm-registry/src/tarball.ts` + `integrity.ts` | SRI **is** verified on download (`verifyIntegrity`, `IntegrityError`, covered by `index.spec.ts`) |
| `getCachedTarball()` (`install-tarball-cache.ts:83-88`) | SRI is **not** re-verified on a cache HIT — the bytes at the content-addressed path are returned as-is. Deliberate, and stated in the caller's comment |
| **Not measured:** whether Yarn's node_modules linker prunes in the cases that matter here | would need a Yarn 4 checkout and a deliberately dirtied `node_modules`. Claimed from source/docs below, never observed |
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

### The finding that reframes incident 2

**Stock Yarn 4 would not have caught it either.** Tree-vs-lockfile divergence under
`nodeLinker: node-modules` is not enforceable with Yarn as shipped: `--immutable` reads the
lockfile, and the linker's diff cannot see a package it never wrote. The open feature
request for precisely this capability — berry#3210, *"[Feature] A flag to enforce
consistency of unplugged files and node_modules"* — has been open since 2021.

So PR #1686 is not gjsify catching up to Yarn. It is gjsify shipping something Yarn has
wanted for four years, and that changes what the rest of this document is allowed to
recommend: **on the tree question there is no design to copy.** What there is, is Yarn's
*precedent for the remedy* — see § 6.

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
(`npm-registry/src/tarball.ts` → `verifyIntegrity`, `IntegrityError`) but **not on a cache
hit**: `getCachedTarball()` returns the bytes at the content-addressed path with no
re-hash, and the caller's comment says why — "tarballs are immutable per SRI integrity, so a
hash hit is byte-identical to what the registry would return and needs no verifying
re-download". That reasoning is sound for a cache this machine wrote. It stops being sound
the moment the store is restored from a **shared CI cache by prefix**, which is exactly what
P2 proposes. Yarn re-hashes on every install *including* cache hits, and `Cache.ts` says the
design leans on it: *"we check the file hashes during each install anyway."*

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
  two open items collapse into one piece of work.
- Nothing here changes the published contract of `@gjsify/cli`, except P4's new flag.

## Implementation

Order: **P4 → P2 → P1 → P3**, with P5 revisited after P2 and P6 not scheduled.
P4 and P2 are days and close the incident that reproduced itself; P1 is the structural one;
P3 is a track, not a task, and should be split (record first, verification later).

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
`packages/plugin-pnp/sources/index.ts`

Open upstream issue relied on in § 2:
[berry#3210](https://github.com/yarnpkg/berry/issues/3210) — *"[Feature] A flag to enforce
consistency of unplugged files and node_modules"*, open since 2021-08-01 (state verified via
the GitHub API; its comment thread was not readable and is not relied on).

**Not verified anywhere in this document:** no Yarn 4 install was executed. The
`NodeModulesLinker` conclusions in § 2 are traced through `master`'s branches, and no
acceptance test covering extraneous-package survival was found
(`packages/acceptance-tests/pkg-tests-specs/sources/node-modules.test.ts` has no match for
`extraneous|stale|leftover`). The `pnpm` linker was not inspected, so § 2 is a claim about
`nodeLinker: node-modules` only. One doc/source discrepancy was found and is noted rather
than resolved: `yarnrc.json` gives `enableImmutableInstalls` a `"default": false`, while the
runtime default is `isCI` — the prose matches the source, the schema field does not.
