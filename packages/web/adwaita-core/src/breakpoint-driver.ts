// The renderer side of a template's `breakpoints` (ADR 0093 § 3): `BreakpointBinState` picks and
// returns writes, and this performs them through the renderer's own property door.
//
// What a renderer still owns is the SIZE SOURCE (a `ResizeObserver`, a view's `layoutChanged`)
// and the two property calls. Everything libadwaita decides — last match wins, restore of the
// value captured at registration, no restore of a property the incoming breakpoint sets again —
// stays in `./breakpoint-bin.ts`, so two renderers cannot spell it twice.

import { BreakpointBinState } from './breakpoint-bin.js';
import type { BreakpointSize } from './breakpoint.js';

/** One authored setter, its target already resolved to the renderer's handle. */
export interface BreakpointDriverSetter<O> {
    readonly object: O;
    readonly property: string;
    readonly value: unknown;
}

/** One authored breakpoint. */
export interface BreakpointDriverDefinition<O> {
    readonly condition: string;
    readonly setters: readonly BreakpointDriverSetter<O>[];
}

/** The renderer's property door. */
export interface BreakpointDriverIo<O> {
    read(object: O, property: string): unknown;
    write(object: O, property: string, value: unknown): void;
}

/** What {@link createBreakpointDriver} hands back. */
export interface BreakpointDriver {
    /** Feed one measured size; performs the writes the change needs, if any. */
    evaluate(size: BreakpointSize): void;
    /** The index of the applied breakpoint, or null. */
    readonly current: number | null;
}

/**
 * Register `definitions` and return the driver a renderer feeds sizes to.
 *
 * Each setter's original is read HERE, once, as `adw_breakpoint_add_setter` does — so create the
 * driver after the tree is built and before any size has been evaluated.
 */
export function createBreakpointDriver<O>(
    definitions: readonly BreakpointDriverDefinition<O>[],
    io: BreakpointDriverIo<O>,
): BreakpointDriver {
    const state = new BreakpointBinState<O>();
    for (const definition of definitions) {
        state.add({
            condition: definition.condition,
            setters: definition.setters.map((setter) => ({
                ...setter,
                originalValue: io.read(setter.object, setter.property),
            })),
        });
    }
    return {
        evaluate(size) {
            const transition = state.evaluate(size);
            if (transition === null) return;
            for (const write of transition.writes) io.write(write.object, write.property, write.value);
        },
        get current() {
            return state.current;
        },
    };
}
