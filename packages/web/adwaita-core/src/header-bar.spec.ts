// Header-bar specs — driven by the shared conformance vectors, so this suite and every
// renderer suite assert the SAME table.

import { describe, it, expect } from '@gjsify/unit';

import { HeaderBarState, resolveHeaderBarTitle } from './header-bar.js';
import {
    HEADER_BAR_PACK_VECTORS,
    HEADER_BAR_TITLE_SOURCE_VECTORS,
    HEADER_BAR_TITLE_WIDGET_VECTORS,
} from './conformance/header-bar.js';

export default async () => {
    await describe('HeaderBarState packing', async () => {
        for (const vector of HEADER_BAR_PACK_VECTORS) {
            await it(`${vector.calls.join(', ') || '(no calls)'} — ${vector.rule}`, async () => {
                const bar = new HeaderBarState<string>();
                for (const call of vector.calls) {
                    const [slot, child] = call.split(':');
                    if (slot === 'start') bar.packStart(child as string);
                    else if (slot === 'end') bar.packEnd(child as string);
                    // Without this, a typo'd slot fell into `packEnd` and the row still
                    // asserted — a table that reads as driven while exercising the wrong
                    // method is the failure the conformance suite exists to prevent.
                    else throw new Error(`unknown slot in pack vector call ${JSON.stringify(call)}`);
                }
                expect(bar.state.start).toStrictEqual([...vector.start]);
                expect(bar.state.end).toStrictEqual([...vector.end]);
            });
        }

        await it('remove takes a child out of whichever slot holds it', async () => {
            const bar = new HeaderBarState<string>();
            bar.packStart('back');
            bar.packEnd('menu');
            bar.packEnd('search');
            expect(bar.remove('search')).toBe(true);
            expect(bar.state.end).toStrictEqual(['menu']);
            expect(bar.remove('back')).toBe(true);
            expect(bar.state.start).toStrictEqual([]);
        });

        await it('remove reports false for a child the bar never held', async () => {
            const bar = new HeaderBarState<string>();
            bar.packStart('back');
            expect(bar.remove('nothing')).toBe(false);
            expect(bar.state.start).toStrictEqual(['back']);
        });

        await it('remove of the title widget clears the centre and restores the derived title', async () => {
            const bar = new HeaderBarState<string>();
            bar.setTitle('Files');
            bar.setTitleWidget('entry');
            expect(bar.state.derivedTitle).toBe(null);
            expect(bar.remove('entry')).toBe(true);
            expect(bar.state.titleWidget).toBe(null);
            expect(bar.state.derivedTitle).toBe('Files');
        });

        await it('a pack vector naming an unknown slot fails instead of packing at the end', async () => {
            const bar = new HeaderBarState<string>();
            expect(() => {
                for (const call of ['strt:a']) {
                    const [slot, child] = call.split(':');
                    if (slot === 'start') bar.packStart(child as string);
                    else if (slot === 'end') bar.packEnd(child as string);
                    else throw new Error(`unknown slot in pack vector call ${JSON.stringify(call)}`);
                }
            }).toThrow('unknown slot');
        });

        // libadwaita cannot reach any of the next three: pack_start/pack_end refuse a child
        // that already has a parent (adw-header-bar.c:1081, :1104). `T` is opaque and carries
        // no parent, so core has to answer for the shape anyway — and the only answer a
        // caller cannot recover from is `true` with the child still on the bar.
        await it('remove takes out EVERY copy of a child packed twice into one slot', async () => {
            const bar = new HeaderBarState<string>();
            bar.packStart('x');
            bar.packStart('x');
            expect(bar.state.start).toStrictEqual(['x', 'x']);
            expect(bar.remove('x')).toBe(true);
            expect(bar.state.start).toStrictEqual([]);
        });

        await it('remove sweeps both slots, not just the first one holding the child', async () => {
            const bar = new HeaderBarState<string>();
            bar.packStart('x');
            bar.packEnd('x');
            expect(bar.remove('x')).toBe(true);
            expect(bar.state.start).toStrictEqual([]);
            expect(bar.state.end).toStrictEqual([]);
        });

        await it('remove of a child that is packed AND the centre clears both', async () => {
            const bar = new HeaderBarState<string>();
            bar.packStart('x');
            bar.setTitleWidget('x');
            expect(bar.remove('x')).toBe(true);
            expect(bar.state.start).toStrictEqual([]);
            expect(bar.state.titleWidget).toBe(null);
        });

        await it('removing a fresh wrapper matches nothing — T is compared by identity', async () => {
            const bar = new HeaderBarState<{ node: string }>();
            const packed = { node: 'back' };
            bar.packStart(packed);
            expect(bar.remove({ node: 'back' })).toBe(false);
            expect(bar.state.start).toStrictEqual([packed]);
            expect(bar.remove(packed)).toBe(true);
        });

        await it('the returned slot arrays are copies — mutating one does not reach the state', async () => {
            const bar = new HeaderBarState<string>();
            bar.packStart('back');
            const start = bar.state.start as string[];
            start.push('smuggled');
            expect(bar.state.start).toStrictEqual(['back']);
        });
    });

    await describe('HeaderBarState title widget', async () => {
        for (const vector of HEADER_BAR_TITLE_WIDGET_VECTORS) {
            await it(`${vector.calls.map((c) => c ?? 'null').join(' → ') || '(no calls)'} — ${vector.rule}`, async () => {
                const bar = new HeaderBarState<string>();
                const changed = vector.calls.map((call) => bar.setTitleWidget(call));
                expect(changed).toStrictEqual([...vector.changed]);
                expect(bar.state.titleWidget).toBe(vector.titleWidget);
                expect(bar.state.derivedTitle !== null).toBe(vector.derivedPresent);
            });
        }

        await it('the subtitle follows the derived title in and out of the centre', async () => {
            const bar = new HeaderBarState<string>();
            bar.setTitle('Files');
            bar.setSubtitle('/home');
            expect(bar.state.derivedSubtitle).toBe('/home');
            bar.setTitleWidget('entry');
            expect(bar.state.derivedSubtitle).toBe(null);
            bar.setTitleWidget(null);
            expect(bar.state.derivedSubtitle).toBe('/home');
        });

        await it('setTitle reports whether it changed, and a repeat does not', async () => {
            const bar = new HeaderBarState<string>();
            expect(bar.setTitle('Files')).toBe(true);
            expect(bar.setTitle('Files')).toBe(false);
            expect(bar.setTitle(null)).toBe(true);
            expect(bar.title).toBe('');
        });
    });

    await describe('resolveHeaderBarTitle', async () => {
        for (const vector of HEADER_BAR_TITLE_SOURCE_VECTORS) {
            await it(vector.rule, async () => {
                expect(resolveHeaderBarTitle(vector.sources)).toBe(vector.title);
            });
        }

        await it('an explicitly set title wins over the resolved chain', async () => {
            const bar = new HeaderBarState<string>();
            bar.setTitleSources({ windowTitle: 'Window' });
            expect(bar.state.derivedTitle).toBe('Window');
            bar.setTitle('Explicit');
            expect(bar.state.derivedTitle).toBe('Explicit');
        });

        await it('setTitleSources reports a change only when the RESOLVED title moves', async () => {
            const bar = new HeaderBarState<string>();
            expect(bar.setTitleSources({ windowTitle: 'Files' })).toBe(true);
            // A different source, same answer: the walk short-circuits above it.
            expect(bar.setTitleSources({ windowTitle: 'Files', applicationName: 'Other' })).toBe(false);
            expect(bar.setTitleSources({ windowTitle: 'Photos' })).toBe(true);
        });

        await it('a masked source change reports true, and its false never hides a moved title', async () => {
            const bar = new HeaderBarState<string>();
            bar.setTitleSources({ windowTitle: 'Window' });
            bar.setTitle('Explicit');
            // Reported over the CHAIN, so this is true while `derivedTitle` does not move.
            // Costing a spurious repaint is the safe direction; the other way round would
            // lose one.
            expect(bar.setTitleSources({ windowTitle: 'Other' })).toBe(true);
            expect(bar.state.derivedTitle).toBe('Explicit');
            // And where it reports false, the rendered title is genuinely unchanged.
            const before = bar.state.derivedTitle;
            expect(bar.setTitleSources({ windowTitle: 'Other', programName: 'p' })).toBe(false);
            expect(bar.state.derivedTitle).toBe(before);
        });

        await it('setTitle("") is "unset", so installed sources take the centre back', async () => {
            const bar = new HeaderBarState<string>();
            bar.setTitleSources({ windowTitle: 'Window' });
            bar.setTitle('Explicit');
            expect(bar.state.derivedTitle).toBe('Explicit');
            // `''` is the bar having no title of its own — the state Adw.HeaderBar is always
            // in — NOT a request for a blank centre. Clearing the sources is that request.
            expect(bar.setTitle('')).toBe(true);
            expect(bar.state.derivedTitle).toBe('Window');
            expect(bar.setTitleSources({})).toBe(true);
            expect(bar.state.derivedTitle).toBe('');
        });
    });
};
