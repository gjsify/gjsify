// `AdwBreakpointBin` is `Adw.Bin` with a `current-breakpoint` the tree builder fills in: it
// measures ITSELF (not the window) and reports which authored breakpoint `adwaita-core` applied.
//
// On the TREES entry for the reason `grid-layout.spec.ts` gives.

import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import type * as Adw from './namespace/adw.js';

type Size = { width: number; height: number };

const tree: SharedTreeNode = {
    tag: 'AdwBreakpointBin',
    id: 'bin',
    children: [{ tag: 'GtkLabel', id: 'label', props: { label: 'wide' } }],
    breakpoints: [
        { condition: 'max-width: 400px', setters: [{ object: 'label', property: 'label', value: 'narrow' }] },
        { condition: 'max-width: 200px', setters: [{ object: 'label', property: 'label', value: 'tiny' }] },
    ],
};

const built = () => {
    let feed!: (size: Size) => void;
    const observeSize = (_view: unknown, onSize: (size: Size) => void) => {
        feed = onSize;
        return () => {};
    };
    const bin = build(tree, { observeSize }) as unknown as Adw.BreakpointBin;
    const label = (bin as unknown as { getViewById(id: string): { label: string } }).getViewById('label');
    return { bin, label, feed: (width: number) => feed({ width, height: 600 }) };
};

export const AdwBreakpointBinNsTest = async () => {
    await describe('AdwBreakpointBin: current-breakpoint', async () => {
        await it('is null until a condition matches, then the applied breakpoint', () => {
            const { bin, label, feed } = built();
            expect(bin.get_current_breakpoint()).toBe(null);
            feed(800);
            expect(bin.get_current_breakpoint()).toBe(null);
            expect(label.label).toBe('wide');
            feed(300);
            expect(bin.get_current_breakpoint() !== null).toBe(true);
            expect(label.label).toBe('narrow');
        });

        await it('answers the same object for the same definition and a new one for the next', () => {
            const { bin, feed } = built();
            feed(300);
            const first = bin.get_current_breakpoint();
            feed(100);
            const second = bin.get_current_breakpoint();
            expect(second !== first).toBe(true);
            feed(300);
            expect(bin.get_current_breakpoint() === first).toBe(true);
        });

        await it('emits notify::current-breakpoint on a change and only on a change', () => {
            const { bin, feed } = built();
            let emitted = 0;
            bin.connect('notify::current-breakpoint', () => emitted++);
            feed(800);
            expect(emitted).toBe(0);
            feed(300);
            expect(emitted).toBe(1);
            feed(350);
            expect(emitted).toBe(1);
            feed(800);
            expect(emitted).toBe(2);
            expect(bin.get_current_breakpoint()).toBe(null);
        });

        await it('reads back through get_property', () => {
            const { bin, feed } = built();
            feed(300);
            expect(bin.get_property('current-breakpoint') === bin.get_current_breakpoint()).toBe(true);
        });
    });
};
