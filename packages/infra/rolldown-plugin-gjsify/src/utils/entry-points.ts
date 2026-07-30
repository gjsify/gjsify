// Glob expansion for Rolldown entry-point input.
//
// Rolldown's `input` accepts:
//   - a single path string
//   - an array of strings
//   - a record mapping output names to input paths
//
// `globToEntryPoints` accepts the same shapes and expands any glob patterns
// against the filesystem via `fast-glob`. Pure-string entries return as-is
// when they don't contain wildcards (fast-glob handles that gracefully).
//
// `.d.ts` files are always excluded — they are type-only declarations,
// not parseable as runtime modules. esbuild handled this implicitly via
// its loader table; Rolldown's Oxc parser errors on declaration-only
// shapes (`get foo(): T;`).
//
// DETERMINISM — entry ORDER is an input to the emitted BYTES, so each
// pattern's expansion is sorted. Rolldown derives every module's and
// external's exec order from a DFS that starts at the entries IN ORDER
// (`sort_modules.rs`), and each emitted chunk renders its import statements
// sorted by that exec order (`compute_cross_chunk_links.rs`) — so a
// multi-entry `--library` build emits differently-ordered `lib/esm/*.js`
// import statements when the entry order changes, and every app bundle that
// inlines those libs (the committed `dist/*.gjs.mjs`) inherits the drift.
// fast-glob does NOT pin that order: its concurrent directory walker yields
// matches in COMPLETION order, so sibling directories race (measured: 9
// distinct orderings in 60 runs over one 6-subdir tree). That race is what
// made the committed GJS bundles reproduce on CI but not on developer
// machines (`verify-committed-bundles.mjs`'s `system`/`gi://GioUnix`
// hoisted-import swap; the `makeCallable`/`mapSysname` module-order
// divergence noted in release-cut.yml). The sort is `Array.prototype.sort`'s
// UTF-16 code-unit order — locale-independent, unlike the `strcoll`-based
// ordering some readdir paths apply. The pattern-LIST order is the user's
// explicit input (entry execution order) and is preserved; only each
// pattern's own expansion is canonicalized. Guarded by
// `packages/infra/cli/src/entry-points.spec.ts` and
// `tests/e2e/deterministic-library-build/`.

import fastGlob from 'fast-glob';

export type EntryPoints = string | string[] | Record<string, string>;

const DEFAULT_IGNORE = ['**/*.d.ts'];

/** Expand ONE pattern to its lexicographically sorted match list. */
async function expandPattern(pattern: string, ignore: string[]): Promise<string[]> {
    const matched = await fastGlob([pattern], { ignore });
    return matched.sort();
}

export const globToEntryPoints = async (
    _entryPoints: EntryPoints | undefined,
    ignore: string[] = [],
): Promise<EntryPoints | undefined> => {
    if (_entryPoints === undefined) return undefined;
    const fullIgnore = [...DEFAULT_IGNORE, ...ignore];

    if (typeof _entryPoints === 'string') {
        return await expandPattern(_entryPoints, fullIgnore);
    }

    if (Array.isArray(_entryPoints)) {
        // Per-pattern expansion (not one combined fast-glob call): the
        // combined call would interleave matches across patterns in walker
        // order, losing both the sort and the user's pattern order. Overlapping
        // patterns are deduped like fast-glob's `unique` did — first
        // occurrence wins.
        const out: string[] = [];
        const seen = new Set<string>();
        for (const pattern of _entryPoints) {
            for (const matched of await expandPattern(pattern, fullIgnore)) {
                if (!seen.has(matched)) {
                    seen.add(matched);
                    out.push(matched);
                }
            }
        }
        return out;
    }

    const entryPoints: Record<string, string> = {};
    for (const input in _entryPoints) {
        const output = _entryPoints[input];
        for (const matched of await expandPattern(input, fullIgnore)) {
            entryPoints[matched] = output;
        }
    }
    return entryPoints;
};
