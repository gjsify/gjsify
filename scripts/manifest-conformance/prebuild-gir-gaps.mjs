/**
 * The missing-`.gir` ledger — DRAINED. `prebuild-artifacts` requires every
 * committed `prebuilds/<target>/` to hold a `.gir` beside its library and typelib;
 * this file excused the directories that did not, and no entry is left.
 *
 * RETIRE IT. `scripts/clear-satisfied-gir-gaps.mjs` deletes the last entry and
 * leaves `PREBUILD_GIR_GAPS = {}` rather than the file, because a bot pushing under
 * `[skip ci]` must not remove a module that `scripts/audit-runtimes.mjs` imports. An
 * empty ledger is a corpse by this repo's own rule, so DELETE THIS FILE and that
 * import by hand, in a reviewed commit — the record of the gap is that commit. The
 * importer list above is CHECKED, not trusted: `tests/e2e/prebuild-declaration-invariant`
 * finds every `.mjs` that statically imports this module and fails if this paragraph
 * does not name it, so the cleanup cannot break an importer nobody remembered.
 *
 * While an entry exists, the shape below is load-bearing: one per line,
 * `    '<per-target package name>': <reason>,`, the key naming a package that maps
 * 1:1 to a single prebuild directory. The clearing script edits this file by LINE and
 * re-imports it afterwards to assert the surviving key set, so a shape it cannot edit
 * fails loudly instead of silently clearing nothing. The e2e suite asserts the shape
 * for any number of entries INCLUDING NONE, never a lower bound — a floor here would
 * fail on the very run that empties the ledger, which is the run it exists to permit.
 *
 * An entry must die in the SAME commit that lands its `.gir`: `prebuild-artifacts`
 * fails on a deferral whose directory now carries one, so the run that ends the cause
 * would otherwise push a self-contradictory tree under `[skip ci]` and redden `main`
 * for every open PR until a human followed up — verbatim what
 * `gjsify.platformsUncommitted` did on 2026-08-01. `commit-prebuilds` runs the
 * clearing script beside its `platformsUncommitted` sibling just before staging.
 *
 * SEVERITY, so a future deferral neither overstates nor understates its cost: a
 * missing `.gir` is NOT runtime breakage — girepository loads the `.typelib` and no
 * path in `detectNativePackages()` / `buildNativeEnv()` opens a `.gir`. What it costs
 * is everything downstream of the committed artifact: regenerating the bridge's
 * TypeScript from the directory it ships (`ts-for-gir --girDirectories`, where the
 * sibling bridges' `build:gir-types` scripts aim) and the GIR-parsing
 * `shared-library`-leaf assertion.
 */

/**
 * The shared cause, once: every entry had the identical reason, and N paraphrases of
 * one sentence is how a ledger stops being read.
 *
 * EXPORTED so that emptying the ledger leaves a lint-clean file — the clearing script
 * removes entry LINES, and a module-private const with no remaining reference would
 * trip `eslint/no-unused-vars` on a commit the bot pushes under `[skip ci]`, where
 * nothing runs to tell anyone.
 */
export const PRE_STAGER_CP = [
    'staged before `scripts/stage-prebuild.mjs` existed, by a hand-written `cp` list that named the `.so` and the',
    "`.typelib` and not the `.gir` (the same bridge's darwin list named all three). The stager matches by extension,",
    'so the next `prebuilds.yml` run that rebuilds this target lands the file and this entry becomes a failure —',
    'which is the point: it must arrive through the commit channel, not by hand.',
].join(' ');

/** @type {Record<string, string>} */
export const PREBUILD_GIR_GAPS = {};
