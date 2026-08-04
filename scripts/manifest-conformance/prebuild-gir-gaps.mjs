/**
 * The missing-`.gir` ledger.
 *
 * `prebuild-artifacts` requires every committed `prebuilds/<target>/` to hold a
 * `.gir` beside its library and typelib. Ten of the sixty do not, and this is
 * where that is said out loud until the channel that produces them repairs it.
 *
 * WHY THESE TEN
 *
 * `scripts/stage-prebuild.mjs` matches artifacts by EXTENSION and `.gir` is in
 * its list, so every directory the shared stager wrote has one. These ten
 * predate that stager: the hand-written linux `cp` lists for `@gjsify/webgl` and
 * `@gjsify/webrtc-native` copied the `.so` and the `.typelib` and omitted the
 * `.gir` that the same bridges' darwin lists copied. Nothing reported it —
 * `audit-runtimes`' existence check asked for "a library plus a typelib", and
 * the only `.gir` assertion in the tree was a shell loop in `prebuilds.yml`'s
 * macOS job, which is why the ten that got away were all linux.
 *
 * WHY THEY ARE NOT SIMPLY COMMITTED HERE
 *
 * Because that would prove nothing. The `commit-prebuilds` channel was DEAD when
 * this ledger was written — it committed the artifacts and then rebased onto a
 * moved `main`, which cannot merge a Mach-O binary and therefore failed on every
 * run with a darwin artifact. Hand-committing ten files would repair the symptom
 * and leave the channel broken. Landing them THROUGH the fixed channel is the
 * proof that it works.
 *
 * HOW AN ENTRY DIES — automatically, in both directions
 *
 * `prebuild-artifacts` FAILS on an entry whose directory now carries a `.gir`, so
 * a deferral cannot outlive its cause. On its own that is a TRAP for the job that
 * ends the cause: the run that finally lands a `.gir` would push a
 * self-contradictory tree under `[skip ci]` and redden `main` for every open PR
 * until a human sent a follow-up — verbatim what `gjsify.platformsUncommitted`
 * did on 2026-08-01. So `scripts/clear-satisfied-gir-gaps.mjs` deletes the entry
 * in the SAME commit that adds the file, and `commit-prebuilds` runs it beside
 * its `platformsUncommitted` sibling just before staging.
 *
 * That script edits this file by LINE, so the shape below is load-bearing: one
 * entry per line, `    '<per-target package name>': <reason>,`, the key naming a
 * package that maps 1:1 to a single prebuild directory. It re-imports this module
 * afterwards and asserts the surviving key set, so a shape it cannot edit fails
 * loudly rather than silently clearing nothing.
 * `tests/e2e/prebuild-declaration-invariant` asserts that this file still HAS that
 * shape, for any number of entries including none — never that it has entries. A
 * check with a lower bound on this ledger would fail on the very run that emptied
 * it, which is the run it exists to permit.
 *
 * WHY THE DEFERRAL CANNOT QUIETLY BECOME PERMANENT
 *
 * The reason below promises that the next `prebuilds.yml` run to rebuild the target
 * lands the file. A promise nothing checks is how a transient gap turns into a
 * permanent one, so all three links are asserted somewhere:
 *
 *   · the file EXISTS to be staged — `g-ir-compiler` compiles the `.typelib` from a
 *     `.gir` in the same build directory, so a committed typelib is itself proof
 *     that the `.gir` was produced; and both bridges' `meson.build` ask for one
 *     (`vala_gir:`), while `webgl`'s two darwin directories ship theirs;
 *   · the STAGER lands it — `scripts/stage-prebuild.mjs` matches by extension, and
 *     it now REFUSES to stage a `.typelib` with no `.gir` beside it, so a build
 *     that stopped producing one fails the leg that produced it instead of shipping
 *     two of three files;
 *   · a run REACHES the target — the repo-scoped `platforms-ci` rule fails an entry
 *     whose package `prebuilds.yml` does not build for the deferred target, and
 *     prints the leg that will restage each of the others on every run.
 *
 * When the last entry goes, the clearing script leaves `PREBUILD_GIR_GAPS = {}`
 * behind rather than deleting this file — a bot pushing under `[skip ci]` must not
 * be removing modules that `scripts/audit-runtimes.mjs` imports. An empty ledger
 * is a corpse by this repo's own rule, so DELETE THIS FILE and its import in that
 * script, by hand, in a reviewed commit. The record of the gap is that commit.
 * That importer list is CHECKED, not trusted: the e2e suite finds every `.mjs` that
 * statically imports this module and fails if this paragraph does not name it, so
 * the cleanup commit cannot break an importer nobody remembered.
 *
 * SEVERITY, stated because a deferral that overstates its cost gets ignored and
 * one that understates it gets forgotten: a missing `.gir` is NOT runtime
 * breakage. girepository loads the `.typelib`; no path in
 * `detectNativePackages()` / `buildNativeEnv()` opens a `.gir`, and
 * `imports.gi.Gwebgl` works today on every one of these targets. What it costs
 * is everything downstream of the committed artifact — regenerating the bridge's
 * TypeScript from the directory it ships (`ts-for-gir --girDirectories`, which
 * six sibling bridges' `build:gir-types` scripts aim at exactly this path) and
 * the GIR-parsing `shared-library`-leaf assertion. Neither of the two bridges
 * below has a `build:gir-types` script today, which is not a coincidence: they
 * are the two whose committed `.gir` was never there to point one at.
 */

/**
 * The shared cause. One string rather than ten copies — the reason is identical
 * for every entry, and ten paraphrases of one sentence is how a ledger stops
 * being read.
 *
 * EXPORTED so that emptying the ledger leaves a lint-clean file: the clearing
 * script removes entry LINES, and a module-private const with no remaining
 * reference would trip `eslint/no-unused-vars` on a commit the bot pushes under
 * `[skip ci]`, where nothing runs to tell anyone. It is also what the e2e suite
 * asserts against, rather than restating the sentence.
 */
export const PRE_STAGER_CP = [
    'staged before `scripts/stage-prebuild.mjs` existed, by a hand-written `cp` list that named the `.so` and the',
    "`.typelib` and not the `.gir` (the same bridge's darwin list named all three). The stager matches by extension,",
    'so the next `prebuilds.yml` run that rebuilds this target lands the file and this entry becomes a failure —',
    'which is the point: it must arrive through the commit channel, not by hand.',
].join(' ');

/** @type {Record<string, string>} */
export const PREBUILD_GIR_GAPS = {};
