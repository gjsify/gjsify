// Header-bar specs — driven by the shared conformance vectors, so this suite and every
// renderer suite assert the SAME table.

import { describe, it, expect } from '@gjsify/unit';

import { HeaderBarState, resolveHeaderBarTitle } from './header-bar.js';
import {
    HEADER_BAR_PACK_VECTORS,
    HEADER_BAR_TITLE_SOURCE_VECTORS,
    HEADER_BAR_TITLE_WIDGET_VECTORS,
} from './conformance/header-bar.js';

await describe('HeaderBarState packing', async () => {
    for (const vector of HEADER_BAR_PACK_VECTORS) {
        await it(`${vector.calls.join(', ') || '(no calls)'} — ${vector.rule}`, async () => {
            const bar = new HeaderBarState<string>();
            for (const call of vector.calls) {
                const [slot, child] = call.split(':');
                if (slot === 'start') bar.packStart(child as string);
                else bar.packEnd(child as string);
            }
            expect(bar.state.start).toEqual([...vector.start]);
            expect(bar.state.end).toEqual([...vector.end]);
        });
    }

    await it('remove takes a child out of whichever slot holds it', async () => {
        const bar = new HeaderBarState<string>();
        bar.packStart('back');
        bar.packEnd('menu');
        bar.packEnd('search');
        expect(bar.remove('search')).toBe(true);
        expect(bar.state.end).toEqual(['menu']);
        expect(bar.remove('back')).toBe(true);
        expect(bar.state.start).toEqual([]);
    });

    await it('remove reports false for a child the bar never held', async () => {
        const bar = new HeaderBarState<string>();
        bar.packStart('back');
        expect(bar.remove('nothing')).toBe(false);
        expect(bar.state.start).toEqual(['back']);
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

    await it('the returned slot arrays are copies — mutating one does not reach the state', async () => {
        const bar = new HeaderBarState<string>();
        bar.packStart('back');
        const start = bar.state.start as string[];
        start.push('smuggled');
        expect(bar.state.start).toEqual(['back']);
    });
});

await describe('HeaderBarState title widget', async () => {
    for (const vector of HEADER_BAR_TITLE_WIDGET_VECTORS) {
        await it(`${vector.calls.map((c) => c ?? 'null').join(' → ') || '(no calls)'} — ${vector.rule}`, async () => {
            const bar = new HeaderBarState<string>();
            const changed = vector.calls.map((call) => bar.setTitleWidget(call));
            expect(changed).toEqual([...vector.changed]);
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
});
