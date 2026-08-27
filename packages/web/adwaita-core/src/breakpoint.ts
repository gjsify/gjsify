// AdwBreakpoint — headless Libadwaita-style responsive breakpoints.
//
// Mirrors `Adw.Breakpoint` + `Adw.BreakpointCondition`: a condition is evaluated against a
// measured size and apply / unapply callbacks run as the condition flips — the primitive
// Adwaita apps collapse split views and swap header layouts with.
//
// PLATFORM-NEUTRAL (ADR 0004): knows nothing about where a `{ width, height }` sample comes
// from. Renderers own the size source and drive {@link AdwBreakpoint.evaluate} from it —
// `@gjsify/adwaita-nativescript`'s `addBreakpoints(view, …)` feeds it the bound view's
// post-layout size off the NS `layoutChanged` event.
//
// FIDELITY: Adwaita evaluates against the WINDOW content size in `sp` (scalable px). The
// `px` / `sp` / `pt` units in a condition string are all read as DIPs (what both NS layout
// and CSS px effectively are). Conditions support `min-width` / `max-width` / `min-height` /
// `max-height` leaves joined by `and` / `or` with optional parentheses.
//
// NOT A DIVERGENCE, A SPLIT. Adwaita keeps at most ONE breakpoint applied at a time,
// because breakpoints there fight over the same GObject properties. That selection is not
// `Adw.Breakpoint`'s job and it is not this class's either: it belongs to the BIN, and it
// lives in `./breakpoint-bin.ts` with the two rules that make it non-obvious. This class
// answers "does my condition hold" for one breakpoint, which is what
// `adw_breakpoint_check_condition` does.
//
// The comment here used to say the bin picks "the best match". It does not: it picks the
// one added LAST among those that match (adw-breakpoint-bin.c:433). The intuitive reading
// and the wrong one, which is why it now has vectors.
//
// Reference: refs/libadwaita/src/adw-breakpoint.c (condition grammar, apply/unapply)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

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
 * Split `spec` on the rightmost top-level (paren-depth 0) occurrence of `op`, as a whole word
 * with surrounding whitespace. Rightmost-as-root yields left-associative grouping
 * (`A op B op C` → `(A op B) op C`). Null when `op` does not appear at the top level.
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
                /\s/.test(spec[start - 1] as string) &&
                /\s/.test(spec[i + 1] as string) &&
                spec.slice(start, i + 1).toLowerCase() === op
            ) {
                return { left: spec.slice(0, start), right: spec.slice(i + 1) };
            }
        }
    }
    return null;
}

/**
 * Split `spec` on a top-level boolean operator, honouring precedence: `or` binds LOOSER than
 * `and` (so `A or B and C` parses as `A or (B and C)`), matching CSS media-query / Adwaita
 * semantics. Null when the top level is a single comparison.
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
        bound: (m[1] as string).toLowerCase() as BreakpointBound,
        dimension: (m[2] as string).toLowerCase() as BreakpointDimension,
        value: Number.parseFloat(m[3] as string),
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
 * A single responsive breakpoint: a condition plus apply/unapply callbacks, mirroring
 * `Adw.Breakpoint`. Drive {@link evaluate} from the renderer's size source (`addBreakpoints`
 * in `@gjsify/adwaita-nativescript`, a `ResizeObserver` in a browser renderer).
 */
export class AdwBreakpoint {
    /** The parsed condition (null when an invalid string was passed). */
    readonly condition: BreakpointConditionNode | null;
    private _handlers: AdwBreakpointHandlers;
    private _applied = false;

    /**
     * `applied` is the state this breakpoint INHERITS — the one a breakpoint it replaces
     * had reached. It exists because {@link evaluate} fires on a TRANSITION only: a
     * renderer that has to rebuild the object (a browser element rebinding its
     * ResizeObserver after a re-parent) otherwise restarts at `false`, and a view the
     * old breakpoint had collapsed, re-evaluated where the condition is FALSE, matches
     * its own starting state and never hears `onUnapply`. Measured: a
     * `<adw-navigation-split-view>` moved 800px → 500px → 900px stayed collapsed at
     * 900px, and only a narrow→wide cycle IN PLACE healed it.
     */
    constructor(condition: string | BreakpointConditionNode | null, handlers: AdwBreakpointHandlers, applied = false) {
        this.condition = typeof condition === 'string' ? parseBreakpointCondition(condition) : (condition ?? null);
        this._handlers = handlers;
        this._applied = applied;
    }

    /** Whether the condition is currently satisfied (apply has fired, not unapply). */
    get applied(): boolean {
        return this._applied;
    }

    /**
     * Re-evaluate against `size`, firing apply / unapply ONLY on a state change, so a steady
     * stream of layout passes does not re-run the callbacks. Returns the post-evaluation
     * applied state; a null condition never applies.
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
