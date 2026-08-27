// AdwBreakpointBin — headless (ADR 0004).
//
// `AdwBreakpoint` (`./breakpoint.ts`) answers "does this condition hold" for ONE
// breakpoint, independently of every other. The BIN is the part that was missing: it
// owns a list of them, picks at most one, and works out what to write when the pick
// changes. Four rules in it are not guessable, and all four come from the C source.
//
//   1. **The last matching breakpoint added wins**, not the narrowest and not the best
//      fit. `adw_breakpoint_bin_size_allocate` iterates the array backwards and takes
//      the first match: "Iterate in reverse order since we prioritize breakpoints added
//      last" (adw-breakpoint-bin.c:432). `./breakpoint.ts` described this as "the best
//      match", which is the intuitive reading and the wrong one.
//   2. **A property both breakpoints set is never restored in between.**
//      `adw_breakpoint_transition` skips a setter the incoming breakpoint also carries:
//      "Don't unset the property if we'll immediately set it again afterwards"
//      (adw-breakpoint.c:1799). Restoring it first would put the widget through a state
//      neither breakpoint describes, once per resize across the boundary. The skip keys
//      on OBJECT and property together (`setter_equal`, adw-breakpoint.c:1060), so the
//      same property on a second widget is still restored.
//   3. **The original value is captured when the setter is REGISTERED**, not when the
//      breakpoint applies (`g_object_get_property` at adw-breakpoint.c:1627). A property
//      changed by other code after registration is therefore restored to what it held at
//      registration, which is surprising until you need it: it makes unapply the exact
//      inverse of apply rather than a diff against a moving target.
//   4. **Unapply is signalled BEFORE the writes, apply AFTER them.**
//      `adw_breakpoint_transition` emits the outgoing breakpoint's `unapply`
//      (adw-breakpoint.c:1793), then restores, then sets, then emits the incoming one's
//      `apply` (:1819) — so a callback on either end sees the properties in the state its
//      own breakpoint describes, never the other one's.
//
// The size SOURCE stays with the renderer, as it does for `AdwBreakpoint`. What this
// module never does is write anything: `evaluate` returns the writes and the renderer
// performs them, because a headless module has no property setter and should not pretend
// to.
//
// One method has no C counterpart at all — `BreakpointBinState.inherit`, which seeds
// the applied breakpoint. A GTK bin is never rebuilt; a browser element is, on every
// reconnect, and a bin that restarts at "none applied" silently keeps the properties the
// bin it replaced had set. Its docblock carries the measurement.
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

/**
 * What changes when the applied breakpoint changes.
 *
 * `Adw.Breakpoint`'s apply/unapply signals have no field here, because the bin holds
 * condition strings and setter DATA — never an `AdwBreakpoint` (`./breakpoint.ts`), whose
 * callbacks it therefore cannot run. {@link from} and {@link to} are how a renderer that
 * has callbacks gets the ORDER right, and rule 4 above is what that order is: the
 * outgoing breakpoint's unapply, then {@link writes}, then the incoming one's apply.
 */
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
     * Take over the applied breakpoint from the bin this one REPLACES, or `null` to start
     * with none applied.
     *
     * No `Adw.BreakpointBin` counterpart, because a GTK bin is never rebuilt — the widget
     * outlives every resize. A browser element rebinds on every `connectedCallback`, and
     * {@link evaluate} fires on a CHANGE only, so a fresh bin that starts at "none
     * applied" reads the size that LEFT the old breakpoint's range as no change at all,
     * produces no writes, and leaves the widget holding what the old bin set. This is the
     * seed `AdwBreakpoint`'s `applied` parameter carries (`./breakpoint.ts`), one level
     * up, and it was paid for once already: a `<adw-navigation-split-view>` driven
     * 800px → 500px → 900px stayed collapsed at 900px, and only a narrow → wide cycle IN
     * PLACE healed it.
     *
     * Call it after {@link add}, and read each setter's `originalValue` BEFORE the old bin
     * applied anything: the restore this enables writes the NEW definitions' originals, so
     * an original read off a widget the outgoing breakpoint has already changed restores
     * it to the applied value, which is no restore at all.
     *
     * Throws on an index this bin does not have rather than quietly applying nothing — a
     * stale index means the caller's breakpoint list moved, and the restore it would skip
     * is the whole bug this method exists to prevent.
     */
    inherit(current: number | null): void {
        if (current === null) {
            this._current = null;
            return;
        }
        const breakpoint = this._breakpoints[current];
        if (!breakpoint) {
            throw new RangeError(
                `BreakpointBinState.inherit: no breakpoint at index ${current}; ${this._breakpoints.length} added.`,
            );
        }
        this._current = breakpoint;
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
