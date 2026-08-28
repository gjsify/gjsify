/**
 * What counts as a hand-written source file in this repository — spelled ONCE.
 *
 * THE INCIDENT
 *
 * `.tsx` arrived in this tree and every walker that had been written before it kept
 * grading the files it was handed. Three were found in one day (2026-08-28), each
 * reporting green over code it had never opened:
 *
 *   - `source-graph.mjs` matched `/\.(ts|mts)$/`, so all four widget implementations
 *     in `@gjsify/adwaita-react-native` were invisible to the ADR 0014 reachability
 *     audit — setting its `gjsify.runtimes["react-native"]` to `polyfill`, `partial`
 *     or `none` each left `audit-runtimes --check` at exit 0. Measured on
 *     `feat/adwaita-react-native`, where that package lives: on `main` no `.tsx` file
 *     sits under any package `src` yet, and `listSourceFiles` returns the identical
 *     1354 files either way. This arm is the one that has not landed its file yet, so
 *     the vector in `check-source-visibility.mjs` is all that falsifies it here.
 *   - `check-comment-budget.mjs` globbed `'*.ts' '*.mts' '*.mjs' '*.js' '*.cjs'` and
 *     did not count 19 tracked `.tsx` files — 12 in `packages/framework`, 7 in
 *     `showcases/gtk`. Folding them in moved `showcases` from 0.153 to 0.170, over a
 *     ceiling of 0.158 that had read as 78 lines of headroom.
 *   - `generate-status.mjs`'s open-todo anchor walk matched
 *     `/\.(?:ts|mts|cts|js|mjs|cjs)$/`, so a dangling `open-todos:` anchor in a `.tsx`
 *     file could never be reported.
 *
 * Each of the three carried its OWN literal, which is why fixing one taught the
 * others nothing. This module is the one place an extension is added; a walker that
 * reads from here cannot fall behind alone, and `scripts/check-source-visibility.mjs`
 * fails when a registered walker stops seeing something this vocabulary names.
 *
 * `cts` and `jsx` are in the lists although the tree holds no `.cts` implementation
 * and no `.jsx` file today. Leaving out the extension nobody has yet is exactly how
 * the three above were written.
 */

/** TypeScript sources — what `tsc` and `gjsify build` compile. */
export const TS_SOURCE_EXTENSIONS = ['ts', 'mts', 'cts', 'tsx'];

/** JavaScript sources — hand-written, not build output. */
export const JS_SOURCE_EXTENSIONS = ['js', 'mjs', 'cjs', 'jsx'];

/** Both, for a walker whose subject is "every source file a human wrote". */
export const CODE_SOURCE_EXTENSIONS = [...TS_SOURCE_EXTENSIONS, ...JS_SOURCE_EXTENSIONS];

/**
 * `\.(a|b|c)$` over the given extensions, anchored at the end of a name.
 *
 * Built rather than written out so the two halves of a check — the filter and the
 * message that explains it — cannot name different sets.
 *
 * @param {readonly string[]} extensions
 */
export function sourceExtensionRe(extensions = CODE_SOURCE_EXTENSIONS) {
    return new RegExp(`\\.(${extensions.join('|')})$`);
}

/** `git ls-files` pathspecs for the given extensions. @param {readonly string[]} extensions */
export function sourcePathspecs(extensions = CODE_SOURCE_EXTENSIONS) {
    return extensions.map((ext) => `*.${ext}`);
}

/**
 * A TypeScript DECLARATION file — `.d.ts`, and its two module variants.
 *
 * Every caller that had this as `endsWith('.d.ts')` was one `.d.cts` away from
 * grading a declaration file as source: `packages/node/stream/src/cjs-interop.fixture.d.cts`
 * is tracked today and slipped into the comment budget the moment `cts` joined the
 * vocabulary above.
 *
 * @param {string} name
 */
export function isDeclarationFile(name) {
    return /\.d\.[cm]?ts$/.test(name);
}

/** @param {string} name @param {readonly string[]} extensions */
export function hasSourceExtension(name, extensions = CODE_SOURCE_EXTENSIONS) {
    return sourceExtensionRe(extensions).test(name);
}
