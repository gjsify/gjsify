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

/** Never expandable to an entry point — the type-only exclusion from the header. */
const DEFAULT_IGNORE = ['**/*.d.ts'];

/**
 * BLAST-RADIUS cap, added to a pattern that does not itself name `node_modules`.
 *
 * `ignore` prunes fast-glob's DIRECTORY traversal, not merely its results, so it
 * bounds the walk: on the mis-formed pattern in {@link toGlobSeparators} it turns
 * heap death into 32 ms. That matters beyond the one bug — the walk it stops runs
 * into the workspace's RELATIVE `node_modules/@gjsify/*` symlinks, which cycle
 * back into `packages/`.
 *
 * Conditional, and NOT a blanket default, because a package may legitimately
 * bundle an entry that lives in there: `@gjsify/tsc`'s whole build is
 * `gjsify build node_modules/typescript/lib/_tsc.js --app gjs`, and an
 * unconditional ignore emptied its input and broke `build:infra` (caught by the
 * closure build, not by a unit test — which is why the rule is stated as
 * narrowly as it can be). The rule in one sentence: a WILDCARD never descends
 * into `node_modules`, while a path that names it explicitly is honoured.
 */
const NODE_MODULES_IGNORE = '**/node_modules/**';

function ignoreFor(pattern: string, ignore: readonly string[]): string[] {
    return pattern.includes('node_modules') ? [...ignore] : [...ignore, NODE_MODULES_IGNORE];
}

/**
 * Make a pattern safe to hand to fast-glob on Windows.
 *
 * fast-glob patterns are POSIX-only: `\` is its ESCAPE character, never a path
 * separator. Its own source says so where it declines to use `path.normalize`
 * (`fast-glob/out/utils/path.js`):
 *
 * > Because of this, we cannot use the standard `path.normalize` method,
 * > because on Windows platform it will use of backslashes.
 *
 * A backslashed pattern does NOT fail cleanly, which is what made this
 * expensive. `src\**\*.{ts,js}` contains no `/`, so fast-glob's
 * `generateTasks` finds no static prefix and walks from `.` instead of from
 * `src` — and its walker follows symlinks with unbounded depth and no cycle
 * detection. In a workspace whose `node_modules/@gjsify/*` are RELATIVE
 * symlinks back into `packages/`, that walk never terminates: RSS climbs until
 * the heap dies, nothing ever matches, and no output file is written. Measured
 * on win32 (issue #914): `@gjsify/utils` at 845 MB / 413 s CPU after 5 min with
 * zero outputs, `@gjsify/rolldown-native` `FATAL ERROR: Ineffective
 * mark-compacts near heap limit` after 33 min — reproduced verbatim on Linux by
 * feeding the backslashed pattern in directly.
 *
 * The conversion is win32-ONLY because on POSIX a backslash is a legitimate
 * escape (`src/\*.ts` = a file literally named `*.ts`); rewriting it there
 * would silently change what the pattern means. `platform` is injected so both
 * branches are unit-testable from either host — the shape
 * `utils/win32-command.ts` uses.
 */
function toGlobSeparators(pattern: string, platform: string): string {
    return platform === 'win32' ? pattern.replaceAll('\\', '/') : pattern;
}

/** Expand ONE pattern to its lexicographically sorted match list. */
async function expandPattern(pattern: string, ignore: string[], platform: string): Promise<string[]> {
    const normalized = toGlobSeparators(pattern, platform);
    const matched = await fastGlob([normalized], { ignore: ignoreFor(normalized, ignore) });
    return matched.sort();
}

export const globToEntryPoints = async (
    _entryPoints: EntryPoints | undefined,
    ignore: string[] = [],
    platform: string = process.platform,
): Promise<EntryPoints | undefined> => {
    if (_entryPoints === undefined) return undefined;
    // The ignore list is fed to the same matcher, so it needs the same
    // treatment — a backslashed `--exclude` silently excludes nothing.
    const fullIgnore = [...DEFAULT_IGNORE, ...ignore.map((p) => toGlobSeparators(p, platform))];

    if (typeof _entryPoints === 'string') {
        return await expandPattern(_entryPoints, fullIgnore, platform);
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
            for (const matched of await expandPattern(pattern, fullIgnore, platform)) {
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
        for (const matched of await expandPattern(input, fullIgnore, platform)) {
            entryPoints[matched] = output;
        }
    }
    return entryPoints;
};
