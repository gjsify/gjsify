// Breakpoint-bin specs — driven by the shared conformance vectors in
// `./conformance/breakpoint-bin.js`.
//
// No renderer drives those tables yet; the tables say so themselves (CORE-ONLY GAP,
// #1343), and this suite is their only driver until the NativeScript bin moves onto
// `BreakpointBinState`. That is a gap, not coverage, and it is written here so a reader of
// the spec is told the same thing as a reader of the table.

import { describe, it, expect } from '@gjsify/unit';

import { BreakpointBinState } from './breakpoint-bin.js';
import type { BreakpointDefinition, BreakpointSetter } from './breakpoint-bin.js';
import { BREAKPOINT_PICK_VECTORS, BREAKPOINT_TRANSITION_VECTORS } from './conformance/breakpoint-bin.js';

/** `[object, property, value]` triples into setters whose original is `orig:<object>.<property>`. */
function setters(triples: readonly (readonly [string, string, string])[]): BreakpointSetter<string>[] {
    return triples.map(([object, property, value]) => ({
        object,
        property,
        value,
        originalValue: `orig:${object}.${property}`,
    }));
}

/** A write, spelled the way {@link BREAKPOINT_TRANSITION_VECTORS} spells one. */
const spell = (write: { object: string; property: string; value: unknown }) =>
    `${write.object}.${write.property}=${write.value}`;

export default async () => {
    await describe('BreakpointBinState picks one breakpoint', async () => {
        for (const vector of BREAKPOINT_PICK_VECTORS) {
            await it(vector.rule, async () => {
                const bin = new BreakpointBinState<string>();
                for (const condition of vector.conditions) bin.add({ condition, setters: [] });
                bin.evaluate(vector.size);
                expect(bin.current).toBe(vector.pick);
            });
        }

        await it('add returns the index the transition reports', async () => {
            const bin = new BreakpointBinState<string>();
            expect(bin.add({ condition: 'max-width: 400sp', setters: [] })).toBe(0);
            expect(bin.add({ condition: 'max-width: 720sp', setters: [] })).toBe(1);
            expect(bin.length).toBe(2);
        });
    });

    await describe('BreakpointBinState transitions', async () => {
        for (const vector of BREAKPOINT_TRANSITION_VECTORS) {
            await it(vector.rule, async () => {
                const bin = new BreakpointBinState<string>();
                for (const [condition, triples] of vector.breakpoints) {
                    bin.add({ condition, setters: setters(triples) });
                }
                const got = vector.sizes.map((size) => {
                    const transition = bin.evaluate(size);
                    return transition === null ? null : transition.writes.map(spell);
                });
                expect(got).toStrictEqual(vector.writes.map((w) => (w === null ? null : [...w])));
            });
        }

        await it('reports which breakpoint it left and which it entered', async () => {
            const bin = new BreakpointBinState<string>();
            bin.add({ condition: 'max-width: 720sp', setters: setters([['view', 'collapsed', 'true']]) });
            bin.add({ condition: 'max-width: 400sp', setters: setters([['view', 'collapsed', 'false']]) });

            const entered = bin.evaluate({ width: 500, height: 600 });
            expect(entered?.from).toBe(null);
            expect(entered?.to).toBe(0);

            const swapped = bin.evaluate({ width: 300, height: 600 });
            expect(swapped?.from).toBe(0);
            expect(swapped?.to).toBe(1);
        });
    });

    await describe('BreakpointBinState child and inheritance', async () => {
        await it('a childless bin keeps the breakpoint it had', async () => {
            const bin = new BreakpointBinState<string>();
            bin.add({ condition: 'max-width: 720sp', setters: [] });
            bin.evaluate({ width: 500, height: 600 });
            bin.setHasChild(false);
            expect(bin.evaluate({ width: 900, height: 600 })).toBe(null);
            expect(bin.current).toBe(0);
        });

        await it('the change happens once the child is back', async () => {
            const bin = new BreakpointBinState<string>();
            bin.add({ condition: 'max-width: 720sp', setters: [] });
            bin.evaluate({ width: 500, height: 600 });
            bin.setHasChild(false);
            bin.evaluate({ width: 900, height: 600 });
            bin.setHasChild(true);
            expect(bin.evaluate({ width: 900, height: 600 })?.to).toBe(null);
        });

        // The paid-for bug, at bin level: a renderer that REBUILDS the bin on reconnect
        // (the browser rebinds its ResizeObserver after a re-parent) loses which breakpoint
        // was applied. `evaluate` fires on a change only, so the 900px pass that should
        // leave the breakpoint matches the fresh bin's own "none applied" starting state
        // and writes nothing. Measured on `AdwBreakpoint`: 800 → 500 → 900 stayed collapsed
        // at 900. The three sizes are the sequence, not a round number.
        await it('a rebuilt bin that inherits the pick still restores on the way out', async () => {
            const definition: BreakpointDefinition<string> = {
                condition: 'max-width: 720sp',
                setters: setters([['view', 'collapsed', 'true']]),
            };

            const first = new BreakpointBinState<string>();
            first.add(definition);
            expect(first.evaluate({ width: 800, height: 600 })).toBe(null);
            expect(first.evaluate({ width: 500, height: 600 })?.writes.map(spell)).toStrictEqual([
                'view.collapsed=true',
            ]);

            // The element reconnects: same definitions, a brand-new bin.
            const rebuilt = new BreakpointBinState<string>();
            rebuilt.add(definition);
            rebuilt.inherit(first.current);

            const widened = rebuilt.evaluate({ width: 900, height: 600 });
            expect(widened?.from).toBe(0);
            expect(widened?.to).toBe(null);
            expect(widened?.writes.map(spell)).toStrictEqual(['view.collapsed=orig:view.collapsed']);
        });

        await it('inherit(null) starts with none applied, so the next evaluation enters', async () => {
            const bin = new BreakpointBinState<string>();
            bin.add({ condition: 'max-width: 720sp', setters: setters([['view', 'collapsed', 'true']]) });
            bin.evaluate({ width: 500, height: 600 });
            bin.inherit(null);
            expect(bin.current).toBe(null);
            const again = bin.evaluate({ width: 500, height: 600 });
            expect(again?.from).toBe(null);
            expect(again?.to).toBe(0);
        });

        await it('inherit throws on an index this bin does not have', async () => {
            const bin = new BreakpointBinState<string>();
            bin.add({ condition: 'max-width: 720sp', setters: [] });
            expect(() => bin.inherit(1)).toThrow();
            // Loud beats quiet here: a swallowed stale index is the restore that never
            // happens, which is the bug `inherit` exists to prevent.
            expect(bin.current).toBe(null);
        });
    });
};
