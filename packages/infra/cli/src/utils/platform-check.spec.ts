// Unit tests for the install platform filter's two pure halves:
//
//   - platform-check.ts — npm-install-checks `checkList`/`checkPlatform`
//     semantics (`any`, `!negation`, string-or-array lists) + the documented
//     "unknown libc never excludes" deviation.
//   - applyOptionalFlags (install-backend-native.ts) — npm's calc-dep-flags in
//     miniature: a node is optional iff NO chain of non-optional edges reaches
//     it from the project root. This flag is what licenses the filter to skip
//     a foreign-platform node, so the reachability corner cases (transitive
//     optional subtrees, required-edge promotion) are pinned here.
import { describe, it, expect } from '@gjsify/unit';

import { checkList, detectLibcFamily, platformMatches } from './platform-check.js';
import { applyOptionalFlags, type ResolvedEdge } from './install-backend-native.js';

// Minimal ResolvedNode-shaped mock (structural — applyOptionalFlags only
// reads the map keys and writes `.optional`).
function flagNode(installPath: string) {
    return {
        name: installPath.split('/').pop()!,
        version: '1.0.0',
        tarballUrl: '',
        installPath,
        dependencies: {},
        optionalDependencies: {},
        optional: undefined as boolean | undefined,
    };
}

function flagsFor(paths: string[], edges: ResolvedEdge[]): Map<string, ReturnType<typeof flagNode>> {
    const byPath = new Map(paths.map((p) => [p, flagNode(p)] as const));
    applyOptionalFlags(byPath, edges);
    return byPath;
}

export default async () => {
    await describe('platform-check.checkList', async () => {
        await it('matches a listed value and rejects an unlisted one', async () => {
            expect(checkList('linux', ['linux', 'darwin'])).toBeTruthy();
            expect(checkList('win32', ['linux', 'darwin'])).toBeFalsy();
        });

        await it('accepts the string form', async () => {
            expect(checkList('linux', 'linux')).toBeTruthy();
            expect(checkList('darwin', 'linux')).toBeFalsy();
        });

        await it('treats a single "any" as always matching', async () => {
            expect(checkList('win32', ['any'])).toBeTruthy();
        });

        await it('rejects a matching negation and accepts a non-matching all-negation list', async () => {
            expect(checkList('win32', ['!win32'])).toBeFalsy();
            expect(checkList('linux', ['!win32'])).toBeTruthy();
            expect(checkList('linux', ['!win32', '!darwin'])).toBeTruthy();
        });

        await it('requires a positive match when positives are present alongside negations', async () => {
            expect(checkList('linux', ['!win32', 'darwin'])).toBeFalsy();
            expect(checkList('darwin', ['!win32', 'darwin'])).toBeTruthy();
        });

        await it('treats an empty or malformed list as no constraint', async () => {
            expect(checkList('linux', [])).toBeTruthy();
            expect(checkList('linux', 42 as never)).toBeTruthy();
        });
    });

    await describe('platform-check.platformMatches', async () => {
        const linuxX64 = { os: 'linux', cpu: 'x64', libc: 'glibc' };

        await it('matches when os+cpu agree and mismatches on either axis', async () => {
            expect(platformMatches({ os: ['linux'], cpu: ['x64'] }, linuxX64)).toBeTruthy();
            expect(platformMatches({ os: ['darwin'], cpu: ['x64'] }, linuxX64)).toBeFalsy();
            expect(platformMatches({ os: ['linux'], cpu: ['arm64'] }, linuxX64)).toBeFalsy();
        });

        await it('treats missing constraints as compatible', async () => {
            expect(platformMatches({}, linuxX64)).toBeTruthy();
            expect(platformMatches({ os: ['linux'] }, linuxX64)).toBeTruthy();
        });

        await it('applies libc constraints when the host family is known', async () => {
            expect(platformMatches({ os: ['linux'], libc: ['glibc'] }, linuxX64)).toBeTruthy();
            expect(platformMatches({ os: ['linux'], libc: ['musl'] }, linuxX64)).toBeFalsy();
        });

        await it('never excludes on an UNKNOWN host libc (documented npm deviation)', async () => {
            // npm prunes here; we keep — a wrong skip breaks a working install,
            // a wrong keep only costs the bytes the filter would have saved.
            const unknownLibc = { os: 'linux', cpu: 'x64', libc: null };
            expect(platformMatches({ os: ['linux'], libc: ['glibc'] }, unknownLibc)).toBeTruthy();
            expect(platformMatches({ os: ['linux'], libc: ['musl'] }, unknownLibc)).toBeTruthy();
        });
    });

    await describe('platform-check.detectLibcFamily', async () => {
        await it('returns null off linux', async () => {
            expect(detectLibcFamily('darwin')).toBeNull();
            expect(detectLibcFamily('win32')).toBeNull();
        });

        await it('returns a known family or null on linux', async () => {
            const family = detectLibcFamily('linux');
            expect(family === 'glibc' || family === 'musl' || family === null).toBeTruthy();
        });
    });

    await describe('install-backend-native.applyOptionalFlags', async () => {
        await it('marks a top-level required chain as required', async () => {
            const flags = flagsFor(
                ['node_modules/a', 'node_modules/b'],
                [
                    { from: null, to: 'node_modules/a', optional: false },
                    { from: 'node_modules/a', to: 'node_modules/b', optional: false },
                ],
            );
            expect(flags.get('node_modules/a')!.optional).toBeFalsy();
            expect(flags.get('node_modules/b')!.optional).toBeFalsy();
        });

        await it('marks an optionalDependencies target as optional', async () => {
            const flags = flagsFor(
                ['node_modules/a', 'node_modules/opt'],
                [
                    { from: null, to: 'node_modules/a', optional: false },
                    { from: 'node_modules/a', to: 'node_modules/opt', optional: true },
                ],
            );
            expect(flags.get('node_modules/opt')!.optional).toBeTruthy();
        });

        await it('keeps the whole subtree behind an optional edge optional (required inner edges)', async () => {
            // a ──dep──> a, a ──opt──> x, x ──dep──> y: y is only reachable
            // through the optional edge, so it is optional despite the
            // required x→y edge (npm's optionalSet boundary).
            const flags = flagsFor(
                ['node_modules/a', 'node_modules/x', 'node_modules/y'],
                [
                    { from: null, to: 'node_modules/a', optional: false },
                    { from: 'node_modules/a', to: 'node_modules/x', optional: true },
                    { from: 'node_modules/x', to: 'node_modules/y', optional: false },
                ],
            );
            expect(flags.get('node_modules/x')!.optional).toBeTruthy();
            expect(flags.get('node_modules/y')!.optional).toBeTruthy();
        });

        await it('promotes a node to required when ANY non-optional root chain reaches it', async () => {
            // x is an optional dep of a but a required dep of b — required wins
            // (npm: an edge in from a required node clears the optional flag).
            const flags = flagsFor(
                ['node_modules/a', 'node_modules/b', 'node_modules/x'],
                [
                    { from: null, to: 'node_modules/a', optional: false },
                    { from: null, to: 'node_modules/b', optional: false },
                    { from: 'node_modules/a', to: 'node_modules/x', optional: true },
                    { from: 'node_modules/b', to: 'node_modules/x', optional: false },
                ],
            );
            expect(flags.get('node_modules/x')!.optional).toBeFalsy();
        });

        await it('does not let an optional node confer requiredness through its own edges', async () => {
            // Root requires nothing of x; x (optional) requires z. z stays
            // optional — requiredness only flows FROM required nodes.
            const flags = flagsFor(
                ['node_modules/x', 'node_modules/z'],
                [
                    { from: null, to: 'node_modules/x', optional: true },
                    { from: 'node_modules/x', to: 'node_modules/z', optional: false },
                ],
            );
            expect(flags.get('node_modules/x')!.optional).toBeTruthy();
            expect(flags.get('node_modules/z')!.optional).toBeTruthy();
        });
    });
};
