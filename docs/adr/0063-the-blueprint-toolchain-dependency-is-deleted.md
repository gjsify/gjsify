# 63. The Blueprint toolchain dependency is deleted, and the oracle stays

- Status: **Accepted**
- Date: 2026-09-19
- Deciders: Pascal Garber
- Related: [ADR 0008 (release versioning policy)](0008-release-versioning-policy.md),
  [ADR 0028 (widget table provenance)](0028-widget-table-provenance.md),
  [ADR 0033 (declarative templates preferred)](0033-declarative-templates-preferred.md),
  [ADR 0053 (Blueprint parsed in-repo)](0053-blueprint-parsed-in-repo.md),
  [ADR 0062 (the Blueprint conversion frontier)](0062-the-blueprint-conversion-frontier-is-composition.md),
  #1712

## Context

ADR 0053 clause 5 flipped in #1712 (`b7bb20823b`): `@gjsify/vite-plugin-blueprint` stopped
spawning `blueprint-compiler` and now calls `parseBlueprint` + `emitGtkBuilderXml`, with no
fallback to the binary. Amendment 3 says in as many words that clause 7's deletion list was NOT
started there, and names what was still in the tree.

Clause 7 is why that matters: **"Done is a deletion, not a feature list."** A capability that is
added without removing what it replaces has not finished — it has forked, and the fork keeps the
dependency alive in every place that still knows how to find it. This ADR is the deletion, and
the completion test it doubles as.

### What existed only to find or run the binary

Measured at `b7bb20823b`, each item found by content rather than by the line numbers the 2026-09-16
survey recorded:

| Item | Where | Size |
|---|---|---|
| the resolver | `packages/infra/vite-plugin-blueprint/src/resolve-compiler.ts` | 268 lines |
| its spec | `packages/infra/vite-plugin-blueprint/src/resolve-compiler.spec.ts` | 237 lines |
| the published subpath they backed | `@gjsify/vite-plugin-blueprint/resolve` | 1 `exports` entry |
| the CLI probe | `checkBlueprintCompiler()` in `packages/infra/cli/src/utils/check-system-deps.ts` | 26 lines + 6 package-manager rows + a win32 MSYS2 branch |
| the fence gate's skip | `blueprintAvailable()` in `scripts/check-doc-fences.mjs` | whole arm, skipped wherever the binary was absent |

Two of the survey's four named consumers of `./resolve` were already gone before this work
started, and the correction is worth recording because it changes what "re-point" meant. Measured:

```
git show "b7bb20823b~1:tests/e2e/create-app/run.mjs" | grep vite-plugin-blueprint
  16:import { resolveBlueprintCompiler } from '@gjsify/vite-plugin-blueprint/resolve';
git show "b7bb20823b~1:tests/e2e/library-blueprint/run.mjs" | grep vite-plugin-blueprint
  40:import { resolveBlueprintCompiler } from '@gjsify/vite-plugin-blueprint/resolve';
```

and neither line survives at `b7bb20823b`. #1712 removed both when it removed the suites' skip
conditions — the same commit that made the skip unnecessary removed what the skip was reading. So
the surviving consumers were the plugin's own re-export block, the CLI probe, and the two specs.

## Decision

**`blueprint-compiler` is not a dependency of anything this repository builds, installs or asks a
user to install. It is the oracle of ADR 0053 clause 4 and ADR 0028 § 6, and every use that is
not that is deleted.**

1. **`resolve-compiler.ts` and its spec are deleted, and the published `./resolve` subpath with
   them.** The breaking-change reasoning is § The published export below; it is not a question
   the file's deletion can answer on its own.

2. **The plugin's root re-exports seven symbols fewer, and gains no replacement.** What `load()`
   throws is `@gjsify/blueprint`'s `BlueprintSyntaxError` / `BlueprintEmitError`, from the package
   that defines them and that every consumer of the plugin already has as a declared dependency —
   `plugin.spec.ts` catches them from there today. A re-export would give two classes a second
   import path whose only job is to stay in step with the first.

3. **`gjsify system-check` loses the row, rather than re-pointing it at something else.** The ADR
   0053 clause 7 text calls the CLI "a CONSUMER to re-point, not a third thing to delete", and
   the honest re-point is to nothing: the build cannot spend the binary any more, so a row asking
   for it is this command failing for the wrong reason — which is the exact defect
   `check-system-deps.ts`'s own history is made of. The six `PM_PACKAGES` rows and the win32 MSYS2
   `standalone` branch go with it, and that branch was the whole reason `buildInstallCommand()`
   had a `standalone` channel at all, so the channel goes too.

4. **The fence gate's skip becomes two stages, and the report names which ran.** Clause 7 requires
   this and it is the item most easily got wrong, because deleting the skip and deleting the arm
   look the same from the exit code:

   - **stage PARSE** hands every ` ```blueprint ` fence to `@gjsify/blueprint` with all five
     emitter seams. It needs no binary, no typelib and no GNOME, so it runs on every runner.
   - **stage ORACLE** re-compiles the same fences with `blueprint-compiler` wherever it is present
     *with* GTK's typelibs, for the ParamSpec validation clause 4 keeps it for and for the
     warnings the parser has no opinion about, of which `Unused import: Adw` is the one the arm
     was written for.

   Neither contains the other, which is why this is a split rather than a replacement. A fence
   parity guard fails the gate when the two stages see different fence counts, because a stage
   that silently reads nothing is the failure this whole file exists to prevent.

5. **The `oxlint-disable` in `loading-stack.ts` and `@gjsify/storybook`'s programmatic window are
   NOT deleted here, and the list stays open because of it.** Both are conversions — a widget that
   must be re-declared in a `.blp` and proved at run time — not lines to drop, and ADR 0053
   Amendment 3 already says each clause-7 item "is its own change". ADR 0062 owns that frontier.
   What this ADR does remove from both is the *stated reason*: each said it was blocked by a
   toolchain, and after clause 5 neither is.

## The published export

Removing `./resolve` is a breaking change to a published export of `@gjsify/vite-plugin-blueprint`,
which is tier 1. **Per ADR 0008 that is not a major event for the whole train — it is a breaking
entry in the next release's notes.** This repository ships ONE release train: every package carries
the same version, compatibility is guaranteed ONLY within a release version, and ADR 0008 § 2
rejects per-package independent semver in as many words. A consumer who pins a release gets a
coherent tree; a consumer who crosses a release reads the notes. That is the contract, and this
change is exactly the kind it was written for.

The size of that train is 206 non-private packages under `packages/` at `0.51.1`, plus 9
showcases. It was 205 one commit earlier: the flip itself added one, because
`@gjsify/blueprint` could no longer stay `private` once a published tier-1 package depended on
it (ADR 0053 Amendment 3). Counted with `git ls-tree -r <rev> -- packages`, reading each
`package.json` and keeping the non-private ones at `0.51.1`.

Release-note entry, to be carried into the notes of the version that ships it:

> **Breaking — `@gjsify/vite-plugin-blueprint`:** the `./resolve` subpath and the seven symbols the
> package root re-exported from it (`resolveBlueprintCompiler`, `formatMissingBlueprintCompiler`,
> `currentBlueprintHost`, `BlueprintCompileError`, `BlueprintCompilerNotFoundError`,
> `ResolvedBlueprintCompiler`, `BlueprintHost`) are removed. The plugin no longer spawns
> `blueprint-compiler`, so there is nothing left to locate. **There is no replacement, and that
> is the point** — the capability is gone because the build no longer needs it. Code that called
> `resolveBlueprintCompiler()` to decide whether a `.blp` would build can delete the call: it
> always will. Code that caught `BlueprintCompileError` should catch `BlueprintSyntaxError` or
> `BlueprintEmitError` from `@gjsify/blueprint` instead — both carry `file` and `line`.

The honest answer for an external consumer is therefore "nothing", with one narrow exception: a
consumer who wanted the binary for *itself* — to run it, not to feed this plugin — was using a
build-tool subpath as a package-manager-independent `which`, and should look for it on `PATH`.

## Consequences

- **Stage PARSE found a defect on its first run, and it is the kind clause 7 predicted.** A
  ` ```blueprint ` fence in `website/src/content/docs/adwaita/feedback.mdx` declared an
  `Adw.AlertDialog` response with the `destructive` flag. `blueprint-compiler` compiles it, which
  is why the old one-stage arm was green on the only job where it ran; `@gjsify/blueprint` refuses
  it — a response flag is one of the seven refusals ADR 0053 Amendment 3 enumerates, with a golden
  in `corpus/refused/response-flags.blp`. Amendment 3's "none of the 85 files here uses one" was
  true and was about tracked `.blp`; a fence inside an `.mdx` is neither tracked `.blp` nor
  anything the corpus gate reads. **The sample was fixed rather than exempted**: the flag is
  dropped and the fence says in a comment that the appearance comes from code, which is what the
  parser's own refusal message prescribes and what the GJS tab beside it already does.
- The refusal set is now enforced against something a reader COPIES, not only against what the
  repo builds. That is a stricter gate than the one it replaces, in the direction that matters:
  the doc sample was the one artifact in this repository that could hand someone a `.blp` the
  build refuses.
- `gjsify system-check` no longer names `blueprint-compiler` in any section, and
  `tests/e2e/cli-only/check-deps.mjs` holds that over the whole of stdout rather than over the
  status lines — the install hint and the `Missing optional:` summary are where a re-added table
  row would surface without a check behind it.
- **That e2e file ran nowhere, and rewriting it is how that surfaced.** `check-deps.mjs` and its
  neighbour `showcase.mjs` sit beside `tests/e2e/cli-only/run.mjs`, define tests with `node:test`,
  and are named by no script and imported by no suite: `package.json#scripts.test:e2e` lists only
  `run.mjs`, `e2e-shard.mjs` parses that script rather than globbing, and
  `check-e2e-suite-coverage.mjs` takes the DIRECTORY as its unit, so a covered directory hid two
  unrun files. Both are now listed, and the coverage check gained a fourth direction that takes
  the FILE as the unit — the same incident its own header records, one level down. This ADR's
  claim above would otherwise have been the thing it exists to refuse: a guard cited in a document
  and run by nothing.
- **And the unrun file had drifted, which is the second half of the cost.** Listed and run,
  `showcase.mjs` failed on `Missing "bundlePath"`. The first hypothesis was that it needed built
  examples — its own header says `Requires: yarn build && yarn build:examples` — and that was
  FALSIFIED by running `gjsify run build:examples` and re-running it: 8 pass, the same 1 fail.
  `gjsify showcase --json` emits `name`, `packageName`, `category`, `description`, and
  `bundlePath` appears in no line of `packages/infra/cli/src`. The field went with the
  showcase-decoupling refactor the sibling `run.mjs` records, and nothing failed because nothing
  ran. The assertion now names a field the command answers. Behind it sat a SECOND stale line in
  the same test: every entry's `category` had to be `dom`, and the command reports
  `{ dom: 7, gtk: 1, node: 1 }` — false about correct code since the first showcase outside that category
  shipped. Neither is weakened to pass; both were claims that had stopped being true, and what
  replaces them is a shape plus an anchor rather than a list that drifts the same way. A test that
  runs nowhere does not merely fail to catch a regression — it stops describing the code, silently,
  and the drift compounds where nobody is looking.
- The corpus harness, `--require-oracle`, `scripts/blueprint-wild-sweep.mjs` and the ci-fedora
  image's `blueprint-compiler` all stay, untouched. Clause 4 makes the binary the thing that
  proves the emitted XML; deleting it would delete the only independent reading the goldens have,
  which is the difference between a parser that is checked and one that is merely present.
- The deletion list is not finished, and this ADR is the record of which boxes are ticked. Two
  conversions remain (Decision 5). A future reader who finds this ADR and an `oxlint-disable` in
  `loading-stack.ts` is looking at an honest completion test, not at drift.

## Alternatives rejected

- **Keep `./resolve` as a deprecated no-op returning `null`.** Cheaper for a consumer to survive
  and it lies: a function whose whole contract is "where is the compiler" answering `null` forever
  is indistinguishable from a host that has not installed it, so every caller's error path fires
  for a reason that no longer exists. A removed export fails at resolve time, where it is read.
- **Keep the `system-check` row as an optional, unscoped nicety.** It costs nothing to leave, and
  it is a published command telling a user to install a tool this project cannot spend. The one
  audience it would serve — someone running the corpus gate with `--require-oracle` — is a
  maintainer inside this tree, whom `check-blueprint-corpus.mjs` already tells directly.
- **Delete the fence gate's blueprint arm along with the skip.** The shortest diff, and it
  retires the ParamSpec validation with the skip. Two questions were being answered by one arm
  that could only run in one place; the split is what makes each answerable where it can be.
- **Exempt the `feedback.mdx` fence instead of fixing it.** `status/doc-fence-exemptions.json`
  exists and would have taken it. A gate whose first finding is exempted has taught the next
  reader what the file is for.
- **Implement response flags in the parser so the sample can keep its `destructive`.** The right
  eventual answer and the wrong PR: it grows clause 3's subset, moves a corpus entry out of
  `refused/` with a new golden, and would arrive inside a change whose entire purpose is deletion.
  ADR 0053 clause 5 already calls each divergence "the next unit of work".
