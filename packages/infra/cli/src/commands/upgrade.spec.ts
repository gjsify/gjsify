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
import type { DependencyGroup } from '../utils/dep-aggregation.js';

import { reportInexactRanges, targetRange } from './upgrade.js';

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
};
