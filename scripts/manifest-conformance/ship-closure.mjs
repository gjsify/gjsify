/**
 * WHAT A RELEASE SHIPS, derived once.
 *
 * Two scripts must agree on the published package closure and neither may own the list:
 *
 *   · `scripts/audit-runtimes.mjs --scope ship` — the release gate (#1898). It audits
 *     what the cut publishes, and its population has to BE what the cut publishes.
 *   · `scripts/verify-package-outputs.mjs` — the post-build guard on the same closure.
 *     Its default scope exists to carve out the three families that build on a different
 *     schedule, and it carried that list inline.
 *
 * They were two copies of one decision, which is the shape every check here exists to
 * remove: `@gjsify/example-*` builds only when an example is in the CI closure
 * (`build:examples`), so it must be OUT of the core sweep and IN of the examples one; and
 * a guard whose population disagrees with the gate that ships it is a gate over a
 * different set of bytes than the ones a user installs.
 *
 * The examples carve-out is the load-bearing half and the reason this is a module rather
 * than a flag. `@gjsify/example-dom-excalibur-jelly-pumper@0.23.0` declared four runtimes
 * and shipped only the GJS bundle, because "not checked in the core pass" had become "not
 * checked anywhere" — a published showcase is as broken to a user as a published library.
 * The two scopes below are the two doors that finding walked through, and they have to be
 * the same two doors.
 *
 * DERIVED FROM THE MANIFESTS, never from a directory listing: `@gjsify/example-*` is a
 * NAME prefix that appears under `examples/`, `showcases/` and (for the workspace-excluded
 * NativeScript apps) neither. Keying on the name keeps the closure identical whichever
 * tree the script runs in, and keeps a `showcases/` package from falling out of the ship
 * scope merely because it lives one level deeper than its siblings.
 */

/** Packages built by `build:examples`, published by `npm:publish`, audited by `--scope examples`. */
export const EXAMPLE_NAME = /^@gjsify\/example-/;

/**
 * Families the CORE sweep does not own.
 *
 * `@girs/*` are generated TYPE packages — nothing to bundle and no runtime artifact.
 * `@gjsify/website` is an Astro site, not a GJS bundle set. `@gjsify/example-*` builds on
 * the examples schedule.
 */
export const CORE_EXCLUDE_NAME_PATTERNS = [/^@girs\//, /^@gjsify\/website$/, EXAMPLE_NAME];

/** `--scope ship`: the published closure, minus the three families above. */
export const SHIP_NAME_PATTERNS = CORE_EXCLUDE_NAME_PATTERNS;

/** `--scope examples`: `@gjsify/example-*` and nothing else. */
export const EXAMPLES_NAME_PATTERNS = [/^(?!@gjsify\/example-).*$/];

/** The three scope names `--scope` accepts, plus the default that means "the whole tree". */
export const SCOPES = /** @type {const} */ (['core', 'ship', 'examples']);

/**
 * @param {string} scope one of `SCOPES`
 * @returns {RegExp[]} name patterns the scope EXCLUDES (an empty list is a whole-tree sweep)
 */
export function excludePatternsFor(scope) {
    if (scope === 'ship') return SHIP_NAME_PATTERNS;
    if (scope === 'examples') return EXAMPLES_NAME_PATTERNS;
    if (scope === 'core') return CORE_EXCLUDE_NAME_PATTERNS;
    return [];
}

/** @param {string} name @param {RegExp[]} patterns */
export function inScope(name, patterns) {
    return !patterns.some((re) => re.test(name));
}
