// AdwBreakpointBin — headless (ADR 0004).
//
// `AdwBreakpoint` (`./breakpoint.ts`) answers "does this condition hold" for ONE
// breakpoint, independently of every other. The BIN is the part that was missing: it
// owns a list of them, picks at most one, and works out what to write when the pick
// changes. Three rules in it are not guessable, and all three come from the C source.
//
//   1. **The last matching breakpoint added wins**, not the narrowest and not the best
//      fit. `adw_breakpoint_bin_size_allocate` iterates the array backwards and takes
//      the first match: "Iterate in reverse order since we prioritize breakpoints added
//      last" (adw-breakpoint-bin.c:432). `./breakpoint.ts` describes this as "the best
//      match", which is the intuitive reading and the wrong one.
//   2. **A property both breakpoints set is never restored in between.**
//      `adw_breakpoint_transition` skips a setter the incoming breakpoint also carries:
//      "Don't unset the property if we'll immediately set it again afterwards"
//      (adw-breakpoint.c:1799). Restoring it first would put the widget through a state
//      neither breakpoint describes, once per resize across the boundary.
//   3. **The original value is captured when the setter is REGISTERED**, not when the
//      breakpoint applies (`g_object_get_property` at adw-breakpoint.c:1627). A property
//      changed by other code after registration is therefore restored to what it held at
//      registration, which is surprising until you need it: it makes unapply the exact
//      inverse of apply rather than a diff against a moving target.
//
// The size SOURCE stays with the renderer, as it does for `AdwBreakpoint`. What this
// module never does is write anything: `evaluate` returns the writes and the renderer
// performs them, because a headless module has no property setter and should not pretend
// to.
//
// Reference: refs/libadwaita/src/adw-breakpoint-bin.c
// Reference: refs/libadwaita/src/adw-breakpoint.c (adw_breakpoint_transition)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { evaluateBreakpointCondition, parseBreakpointCondition } from './breakpoint.js';
import type { BreakpointConditionNode, BreakpointSize } from './breakpoint.js';

/**
 * One property a breakpoint writes while it is applied.
 *
 * `originalValue` is supplied by the caller rather than read here, and it is read ONCE,
 * when the setter is registered. That mirrors `adw_breakpoint_add_setter`, and it is
 * also the only thing a headless module can do: it holds no widgets.
 */
export interface BreakpointSetter<O> {
    readonly object: O;
    readonly property: string;
    readonly value: unknown;
    readonly originalValue: unknown;
}

/** A condition plus the properties it writes. */
export interface BreakpointDefinition<O> {
    /** A Libadwaita condition string, e.g. `'max-width: 720sp'`. */
    readonly condition: string;
    readonly setters: readonly BreakpointSetter<O>[];
}

/** One property write a renderer performs. */
export interface BreakpointWrite<O> {
    readonly object: O;
    readonly property: string;
    readonly value: unknown;
}

/** What changes when the applied breakpoint changes. */
export interface BreakpointTransition<O> {
    /** Index of the breakpoint being left, or null when none was applied. */
    readonly from: number | null;
    /** Index of the breakpoint being entered, or null when none matches. */
    readonly to: number | null;
    /**
     * The writes to perform, in order: restores first, then the incoming values.
     *
     * A property both breakpoints set appears ONCE, carrying the incoming value. It is
     * not restored and then re-set, which would take the widget through a state neither
     * breakpoint describes.
     */
    readonly writes: readonly BreakpointWrite<O>[];
}

/** A parsed definition plus its index, so the pick can report which one it took. */
interface Compiled<O> {
    readonly index: number;
    readonly condition: BreakpointConditionNode | null;
    readonly setters: readonly BreakpointSetter<O>[];
}

/**
 * `Adw.BreakpointBin`'s pick-one-and-transition behaviour, over opaque objects.
 *
 * Generic in the object type because the core holds no widgets: `O` is whatever the
 * renderer's handle is, and this class only ever compares them by identity.
 */
export class BreakpointBinState<O> {
    private readonly _breakpoints: Compiled<O>[] = [];
    private _current: Compiled<O> | null = null;
    private _hasChild = true;

    /**
     * `adw_breakpoint_bin_add_breakpoint`. Returns the index, which is what
     * {@link BreakpointTransition} reports.
     *
     * Order is meaningful: a later breakpoint beats an earlier one when both match.
     */
    add(definition: BreakpointDefinition<O>): number {
        const index = this._breakpoints.length;
        this._breakpoints.push({
            index,
            condition: parseBreakpointCondition(definition.condition),
            setters: definition.setters,
        });
        return index;
    }

    /**
     * Whether the bin has a child.
     *
     * `adw_breakpoint_bin_size_allocate` returns before picking anything when there is
     * no child (adw-breakpoint-bin.c:427), so a childless bin keeps whatever breakpoint
     * it had rather than dropping to none. Modelled rather than left to the renderer
     * because "the applied breakpoint did not change while the child was away" is a
     * behaviour, and the alternative is each renderer rediscovering it.
     */
    setHasChild(hasChild: boolean): void {
        this._hasChild = hasChild;
    }

    /** The index of the applied breakpoint, or null when none is. */
    get current(): number | null {
        return this._current?.index ?? null;
    }

    /** How many breakpoints have been added. */
    get length(): number {
        return this._breakpoints.length;
    }

    /**
     * Re-pick against `size` and return the writes, or `null` when nothing changed.
     *
     * Null rather than an empty transition, so a renderer driving this from every
     * allocation can skip the whole path on the overwhelmingly common no-change case
     * without inspecting an object.
     */
    evaluate(size: BreakpointSize): BreakpointTransition<O> | null {
        if (!this._hasChild) return null;

        // Backwards: the LAST matching breakpoint wins (adw-breakpoint-bin.c:432).
        let next: Compiled<O> | null = null;
        for (let i = this._breakpoints.length - 1; i >= 0; i--) {
            const candidate = this._breakpoints[i] as Compiled<O>;
            if (candidate.condition && evaluateBreakpointCondition(candidate.condition, size)) {
                next = candidate;
                break;
            }
        }

        if (next === this._current) return null;

        const from = this._current;
        this._current = next;
        return {
            from: from?.index ?? null,
            to: next?.index ?? null,
            writes: transitionWrites(from, next),
        };
    }

    /**
     * Drop the applied breakpoint without producing writes.
     *
     * For a renderer rebuilding the bin: the widget is going away, so restoring
     * properties on it is pointless, and the next `evaluate` should behave as a first
     * evaluation rather than transition out of a breakpoint nothing is applying.
     */
    reset(): void {
        this._current = null;
    }
}

/** `adw_breakpoint_transition` as data: restores that survive the skip, then the new values. */
function transitionWrites<O>(from: Compiled<O> | null, to: Compiled<O> | null): BreakpointWrite<O>[] {
    const writes: BreakpointWrite<O>[] = [];
    if (from) {
        for (const setter of from.setters) {
            // The skip: `to` setting the same property on the same object means the
            // restore would be overwritten on the next line anyway, and performing it
            // shows a value neither breakpoint asked for.
            const alsoIncoming = to?.setters.some(
                (other) => other.object === setter.object && other.property === setter.property,
            );
            if (alsoIncoming) continue;
            writes.push({ object: setter.object, property: setter.property, value: setter.originalValue });
        }
    }
    if (to) {
        for (const setter of to.setters) {
            writes.push({ object: setter.object, property: setter.property, value: setter.value });
        }
    }
    return writes;
}
