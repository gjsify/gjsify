// SPDX-License-Identifier: MIT
// Unit coverage for `gjsify upgrade --exact`.
//
// WHY THE FIRST BLOCK IS THE IMPORTANT ONE. `--exact` shipped for exactly one revision
// with the range built in three places — the writer, the bulk preview and the align
// preview — and only the writer knew about the flag. `--dry-run --exact` therefore
// announced `^4.3.0` while the write would have produced `4.3.0`: a tool describing a
// change it was not about to make, which is worse than either behaviour on its own,
// because the preview is what a reader checks BEFORE letting it touch 138 files.
//
// The repair was one shared function, so the property worth pinning is not "exact drops
// the caret" but "there is a single answer to what gets written". A test that called the
// writer only would have passed throughout the defect.

import { describe, expect, it } from '@gjsify/unit';
import type { Workspace } from '@gjsify/workspace';
import type { DependencyGroup } from '../utils/dep-aggregation.js';

import { collectFromWorkspace, isDistTagSpec, reportInexactRanges, targetRange } from './upgrade.js';

/** A dependency group with one declaration per given range. */
function group(name: string, ...ranges: string[]): DependencyGroup {
    return {
        name,
        occurrences: ranges.map((currentRange, i) => ({
            workspace: `@gjsify/pkg-${i}`,
            workspaceLocation: `/tmp/pkg-${i}`,
            field: 'dependencies',
            currentRange,
            prefix: /^[\^~]|^[<>]=?/.exec(currentRange)?.[0] ?? '',
        })),
        declaredRanges: new Set(ranges),
    } as unknown as DependencyGroup;
}

export default async () => {
    await describe('upgrade --exact', async () => {
        await describe('targetRange — the one answer preview and writer share', async () => {
            await it('keeps the operator when not exact', async () => {
                expect(targetRange('^', '4.3.0', false)).toBe('^4.3.0');
                expect(targetRange('~', '4.3.0', false)).toBe('~4.3.0');
            });

            await it('drops the operator when exact', async () => {
                expect(targetRange('^', '4.3.0', true)).toBe('4.3.0');
                expect(targetRange('~', '1.2.3', true)).toBe('1.2.3');
            });

            await it('is a no-op on a range that already has no operator', async () => {
                expect(targetRange('', '4.3.0', true)).toBe('4.3.0');
                expect(targetRange('', '4.3.0', false)).toBe('4.3.0');
            });

            await it('does not invent a prefix for a prerelease pin', async () => {
                // `@girs/gwebgl-0.1` is declared as `0.1.0-4.0.0-rc.5`, already exact.
                expect(targetRange('', '0.1.0-4.0.0-rc.5', true)).toBe('0.1.0-4.0.0-rc.5');
            });
        });

        await describe('reportInexactRanges — the CI arm', async () => {
            await it('counts every loose DECLARATION, not every dep', async () => {
                // Three manifests, one dep: the operator is wrong three times over, and the
                // count is what tells a reader how much moves.
                expect(reportInexactRanges([group('@girs/gtk-4.0', '^4.3.0', '^4.3.0', '^4.3.0')])).toBe(3);
            });

            await it('passes a dep pinned exactly everywhere', async () => {
                expect(reportInexactRanges([group('@girs/gtk-4.0', '4.3.0', '4.3.0')])).toBe(0);
            });

            await it('reports the loose half of a mixed dep', async () => {
                expect(reportInexactRanges([group('@girs/adw-1', '4.3.0', '^4.3.0')])).toBe(1);
            });

            await it('is silent on an empty set rather than passing vacuously', async () => {
                // A filter matching nothing must not read as "everything is pinned": the
                // caller pairs this with `--filter`, and a typo there would otherwise be
                // indistinguishable from a clean tree.
                expect(reportInexactRanges([])).toBe(0);
            });

            await it('catches operators other than caret', async () => {
                expect(reportInexactRanges([group('@girs/gio-2.0', '~4.3.0', '>=4.3.0')])).toBe(2);
            });
        });
    });

    // A dist-tag spec is how an app opts into the `next` channel (ADR 0111), and until
    // this skip existed `--align` was the thing that took it away again: the tag joined
    // its dep's group as the literal range `next`, `--check` called the dep inconsistent
    // with every sibling declaring a real range, and the repair its own failure message
    // names rewrote `"next"` to the highest declared version. The gate demanded a
    // property the opt-in cannot have, and the fix silently removed the opt-in.
    await describe('upgrade and dist-tag specs', async () => {
        await describe('isDistTagSpec', async () => {
            await it('recognises the tags an app actually declares', async () => {
                expect(isDistTagSpec('next')).toBe(true);
                expect(isDistTagSpec('latest')).toBe(true);
                expect(isDistTagSpec('beta')).toBe(true);
                expect(isDistTagSpec('canary')).toBe(true);
                expect(isDistTagSpec('rc-1')).toBe(true);
                expect(isDistTagSpec('next-2')).toBe(true);
            });

            await it('does not claim `latest` is a range, which validRange does', async () => {
                // `@gjsify/semver`'s `validRange('latest')` answers `>=0.0.0` — it reads the
                // unparseable token as an x-range. npm's "not a valid range ⇒ a tag" rule is
                // therefore not usable here, and this is the case that proves it.
                expect(isDistTagSpec('latest')).toBe(true);
            });

            await it('leaves every real range alone', async () => {
                for (const range of ['^0.63.0', '~1.2.3', '0.63.1', '>=1.0.0 <2.0.0', '1.x', '1', '1.2']) {
                    expect(isDistTagSpec(range)).toBe(false);
                }
            });

            await it('leaves the alphabetic RANGE spellings alone', async () => {
                // `x`, `X` and `*` begin with a letter or are letter-free and still mean
                // "any version" — classing them as tags would stop `upgrade` seeing a
                // `"x"`-pinned dep at all.
                for (const range of ['x', 'X', '*', '', 'v1.2.3', 'v1.x']) {
                    expect(isDistTagSpec(range)).toBe(false);
                }
            });
        });

        await describe('collectFromWorkspace — where the skip has to live', async () => {
            /** A workspace declaring one dep per entry, in `dependencies`. */
            function ws(deps: Record<string, string>): Workspace {
                return {
                    name: '@acme/app',
                    location: '/tmp/app',
                    relativeLocation: '.',
                    version: '1.0.0',
                    private: false,
                    manifest: { name: '@acme/app', version: '1.0.0', dependencies: deps },
                } as Workspace;
            }

            await it('drops the tag and keeps the ranges beside it', async () => {
                // The skip belongs in COLLECTION, not in one mode: every mode —
                // interactive, `--latest`, `--align`, `--check` and the lockfile
                // comparison — reads the same declarations, and a per-mode guard would
                // have to be repeated five times to hold.
                const decls = collectFromWorkspace(ws({ '@gjsify/cli': 'next', '@girs/gtk-4.0': '^4.3.0' }), []);
                expect(decls.length).toBe(1);
                expect(decls[0]!.name).toBe('@girs/gtk-4.0');
            });

            await it('drops a tag in every dep field, not only `dependencies`', async () => {
                const w = ws({ a: 'next' });
                w.manifest.devDependencies = { '@gjsify/cli': 'next' };
                w.manifest.peerDependencies = { b: 'latest' };
                w.manifest.optionalDependencies = { c: 'beta' };
                expect(collectFromWorkspace(w, []).length).toBe(0);
            });

            await it('still skips the protocol specs it always skipped', async () => {
                const decls = collectFromWorkspace(
                    ws({ a: 'workspace:^', b: 'file:../b', c: 'link:../c', d: 'npm:e@^1.0.0' }),
                    [],
                );
                expect(decls.length).toBe(0);
            });
        });
    });
};
