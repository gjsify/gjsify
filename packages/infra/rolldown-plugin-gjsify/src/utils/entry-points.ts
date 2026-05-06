// Glob expansion for Rolldown entry-point input.
//
// Rolldown's `input` accepts:
//   - a single path string
//   - an array of strings
//   - a record mapping output names to input paths
//   - an array of `{ in: <path>, out: <name> }` objects (Rolldown extension)
//
// `globToEntryPoints` accepts the same shapes and expands any glob patterns
// against the filesystem via `fast-glob`. Pure-string entries return as-is
// when they don't contain wildcards (fast-glob handles that gracefully).

import fastGlob from 'fast-glob';

export type EntryPoints =
    | string
    | string[]
    | { in: string; out: string }[]
    | Record<string, string>;

export const globToEntryPoints = async (
    _entryPoints: EntryPoints | undefined,
    ignore: string[] = [],
): Promise<EntryPoints | undefined> => {
    if (_entryPoints === undefined) return undefined;

    if (typeof _entryPoints === 'string') {
        const expanded = await fastGlob([_entryPoints], { ignore });
        return expanded;
    }

    if (Array.isArray(_entryPoints) && typeof _entryPoints[0] === 'string') {
        return await fastGlob(_entryPoints as string[], { ignore });
    }

    if (Array.isArray(_entryPoints) && typeof _entryPoints[0] === 'object') {
        const entryPoints: { in: string; out: string }[] = [];
        for (const entryPoint of _entryPoints as { in: string; out: string }[]) {
            const inputs = await fastGlob(entryPoint.in, { ignore });
            for (const input of inputs) {
                entryPoints.push({ in: input, out: entryPoint.out });
            }
        }
        return entryPoints;
    }

    const entryPoints: Record<string, string> = {};
    for (const input in _entryPoints as Record<string, string>) {
        const output = (_entryPoints as Record<string, string>)[input];
        const inputs = await fastGlob(input, { ignore });
        for (const matched of inputs) {
            entryPoints[matched] = output;
        }
    }
    return entryPoints;
};
