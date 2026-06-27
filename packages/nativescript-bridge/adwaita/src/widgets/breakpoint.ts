// AdwBreakpoint — Libadwaita-style responsive breakpoints for NativeScript.
//
// Mirrors `Adw.Breakpoint` + `Adw.BreakpointCondition`: a window (here, a bound
// root VIEW) evaluates a condition against its current size and runs apply /
// unapply callbacks as the condition flips. Adwaita apps lean on these to collapse
// split views, swap header layouts, or hide chrome on narrow widths — the single
// most important adaptive primitive when porting a GNOME app to a phone or tablet,
// and the missing piece that kept the NS storybook stuck in phone layout on a wide
// (tablet / desktop) screen.
//
// FIDELITY: Adwaita evaluates against the WINDOW content size in `sp` (scalable
// px). NS exposes no window-resize signal, so a breakpoint watches its bound
// view's POST-LAYOUT size (DIPs — the NS analog of `sp`) via the view's
// `layoutChanged` event, with an initial `loaded` seed. The `px` / `sp` / `pt`
// units in a condition string are all read as DIPs (NS already works in
// density-independent units). Conditions support `min-width` / `max-width` /
// `min-height` / `max-height` leaves joined by `and` / `or` with optional
// parentheses — the grammar GNOME apps actually use.
//
// Divergence from `Adw.Breakpoint`: Adwaita keeps at most ONE breakpoint applied
// at a time (the best match) and unapplies the others, because breakpoints there
// fight over the same GObject properties. Here each breakpoint owns independent
// apply/unapply callbacks, so {@link addBreakpoints} evaluates each on its own
// merits — more flexible for the callback model and identical for the common
// single-breakpoint case.
//
// Type-only `@nativescript/core` import → this module loads and is unit-testable
// off-device (like row-press / color-scheme).
//
// Reference: refs/libadwaita/src/adw-breakpoint.c (condition grammar, apply/unapply)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';

/** The two size axes a condition can test. */
export type BreakpointDimension = 'width' | 'height';

/** Whether a leaf is a lower (`min`) or upper (`max`) bound. */
export type BreakpointBound = 'min' | 'max';

/** A single `min-/max-width/height: <value>` comparison (value in DIPs). */
export interface BreakpointConditionLeaf {
    dimension: BreakpointDimension;
    bound: BreakpointBound;
    /** Threshold in DIPs (the parsed `px` / `sp` / `pt` value). */
    value: number;
}

/** A boolean combination of two condition nodes. */
export interface BreakpointConditionGroup {
    op: 'and' | 'or';
    left: BreakpointConditionNode;
    right: BreakpointConditionNode;
}

/** A parsed breakpoint condition: a leaf comparison or an and/or group. */
export type BreakpointConditionNode = BreakpointConditionLeaf | BreakpointConditionGroup;

/** A measured size in DIPs. */
export interface BreakpointSize {
    width: number;
    height: number;
}

const LEAF_RE = /^(min|max)-(width|height)\s*:\s*(\d+(?:\.\d+)?)\s*(px|sp|pt)?$/i;

/** True when `node` is a leaf comparison (vs. an and/or group). */
function isLeaf(node: BreakpointConditionNode): node is BreakpointConditionLeaf {
    return (node as BreakpointConditionGroup).op === undefined;
}

/**
 * Split `spec` on the rightmost top-level (paren-depth 0) occurrence of `op`
 * (a whole word with surrounding whitespace). Rightmost-as-root yields
 * left-associative grouping (`A op B op C` → `(A op B) op C`). Returns the two
 * raw sides, or null when `op` does not appear at the top level.
 */
function splitOn(spec: string, op: 'and' | 'or'): { left: string; right: string } | null {
    let depth = 0;
    for (let i = spec.length - 1; i >= 0; i--) {
        const ch = spec[i];
        if (ch === ')') depth++;
        else if (ch === '(') depth--;
        else if (depth === 0) {
            const start = i - op.length + 1;
            if (
                start > 0 &&
                i + 1 < spec.length &&
                /\s/.test(spec[start - 1]) &&
                /\s/.test(spec[i + 1]) &&
                spec.slice(start, i + 1).toLowerCase() === op
            ) {
                return { left: spec.slice(0, start), right: spec.slice(i + 1) };
            }
        }
    }
    return null;
}

/**
 * Split `spec` on a top-level boolean operator, honouring precedence: `or` binds
 * LOOSER than `and` (so `A or B and C` parses as `A or (B and C)`), matching CSS
 * media-query / Adwaita semantics. Returns the operator + sides, or null when the
 * top level is a single comparison.
 */
function splitTopLevel(spec: string): { op: 'and' | 'or'; left: string; right: string } | null {
    for (const op of ['or', 'and'] as const) {
        const parts = splitOn(spec, op);
        if (parts) return { op, ...parts };
    }
    return null;
}

/**
 * Parse a Libadwaita breakpoint condition string into a {@link BreakpointConditionNode}.
 * Accepts a single comparison (`'max-width: 720sp'`), and/or chains
 * (`'max-width: 720sp and max-height: 480sp'`), and parenthesised groups. Units
 * are read as DIPs. Returns null when the string can't be parsed.
 */
export function parseBreakpointCondition(spec: string): BreakpointConditionNode | null {
    const trimmed = spec.trim();
    if (!trimmed) return null;

    const split = splitTopLevel(trimmed);
    if (split) {
        const left = parseBreakpointCondition(split.left);
        const right = parseBreakpointCondition(split.right);
        if (!left || !right) return null;
        return { op: split.op, left, right };
    }

    // No top-level operator: a parenthesised group or a bare leaf.
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        return parseBreakpointCondition(trimmed.slice(1, -1));
    }

    const m = LEAF_RE.exec(trimmed);
    if (!m) return null;
    return {
        bound: m[1].toLowerCase() as BreakpointBound,
        dimension: m[2].toLowerCase() as BreakpointDimension,
        value: Number.parseFloat(m[3]),
    };
}

/** Evaluate a parsed condition against a measured size (DIPs). */
export function evaluateBreakpointCondition(node: BreakpointConditionNode, size: BreakpointSize): boolean {
    if (isLeaf(node)) {
        const measured = node.dimension === 'width' ? size.width : size.height;
        return node.bound === 'max' ? measured <= node.value : measured >= node.value;
    }
    const left = evaluateBreakpointCondition(node.left, size);
    // Short-circuit so `and`/`or` behave as expected.
    if (node.op === 'and') return left && evaluateBreakpointCondition(node.right, size);
    return left || evaluateBreakpointCondition(node.right, size);
}

/** Callbacks run as a breakpoint's condition flips. */
export interface AdwBreakpointHandlers {
    /** Run when the condition becomes true (the narrow/large state is entered). */
    onApply: () => void;
    /** Run when the condition becomes false again. Optional. */
    onUnapply?: () => void;
}

/**
 * A single responsive breakpoint: a condition plus apply/unapply callbacks.
 * Mirrors `Adw.Breakpoint`. Bind one or more to a view with {@link addBreakpoints}
 * (or drive {@link evaluate} yourself from a custom size source).
 */
export class AdwBreakpoint {
    /** The parsed condition (null when an invalid string was passed). */
    readonly condition: BreakpointConditionNode | null;
    private _handlers: AdwBreakpointHandlers;
    private _applied = false;

    constructor(condition: string | BreakpointConditionNode | null, handlers: AdwBreakpointHandlers) {
        this.condition =
            typeof condition === 'string' ? parseBreakpointCondition(condition) : (condition ?? null);
        this._handlers = handlers;
    }

    /** Whether the condition is currently satisfied (apply has fired, not unapply). */
    get applied(): boolean {
        return this._applied;
    }

    /**
     * Re-evaluate against `size`, firing apply / unapply ONLY on a state change
     * (so a steady stream of layout passes doesn't re-run the callbacks). Returns
     * the post-evaluation applied state. A null condition never applies.
     */
    evaluate(size: BreakpointSize): boolean {
        const matches = this.condition ? evaluateBreakpointCondition(this.condition, size) : false;
        if (matches === this._applied) return this._applied;
        this._applied = matches;
        if (matches) this._handlers.onApply();
        else this._handlers.onUnapply?.();
        return this._applied;
    }
}

/** The DIP size of a view post-layout, or null before it has been measured. */
function measureView(view: View): BreakpointSize | null {
    const size = view.getActualSize?.();
    if (size && size.width > 0 && size.height > 0) return { width: size.width, height: size.height };
    return null;
}

/**
 * Bind breakpoints to a view so they re-evaluate on every layout pass (the NS
 * stand-in for Adwaita's window-size signal): the view's `layoutChanged` event
 * drives {@link AdwBreakpoint.evaluate} with the post-layout DIP size, and a
 * `loaded` seed evaluates once the first size is known. Each breakpoint is
 * evaluated independently. Returns a dispose function that detaches the listeners.
 */
export function addBreakpoints(view: View, breakpoints: AdwBreakpoint[]): () => void {
    const recompute = (): void => {
        const size = measureView(view);
        if (!size) return;
        for (const bp of breakpoints) bp.evaluate(size);
    };
    view.addEventListener('layoutChanged', recompute);
    view.addEventListener('loaded', recompute);
    // If the view is already laid out (bound late), evaluate now.
    recompute();
    return () => {
        view.removeEventListener('layoutChanged', recompute);
        view.removeEventListener('loaded', recompute);
    };
}
