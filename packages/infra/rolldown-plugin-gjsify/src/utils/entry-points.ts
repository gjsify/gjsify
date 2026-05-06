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

import fastGlob from 'fast-glob';

export type EntryPoints = string | string[] | Record<string, string>;

const DEFAULT_IGNORE = ['**/*.d.ts'];

export const globToEntryPoints = async (
    _entryPoints: EntryPoints | undefined,
    ignore: string[] = [],
): Promise<EntryPoints | undefined> => {
    if (_entryPoints === undefined) return undefined;
    const fullIgnore = [...DEFAULT_IGNORE, ...ignore];

    if (typeof _entryPoints === 'string') {
        const expanded = await fastGlob([_entryPoints], { ignore: fullIgnore });
        return expanded;
    }

    if (Array.isArray(_entryPoints)) {
        return await fastGlob(_entryPoints, { ignore: fullIgnore });
    }

    const entryPoints: Record<string, string> = {};
    for (const input in _entryPoints) {
        const output = _entryPoints[input];
        const inputs = await fastGlob(input, { ignore: fullIgnore });
        for (const matched of inputs) {
            entryPoints[matched] = output;
        }
    }
    return entryPoints;
};
