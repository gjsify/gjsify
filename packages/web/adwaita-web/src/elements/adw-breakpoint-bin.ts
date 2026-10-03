// <adw-breakpoint-bin> — a bin whose one child rearranges itself at size thresholds.
// `Adw.BreakpointBin` gives breakpoints a home without a window: it holds a list of
// `Adw.Breakpoint`s, and on every allocation the LAST one whose condition holds is
// picked and its setters written. If none holds, the child's original values stand.
//
// The picking, the restore order and what a restore restores to are all
// `@gjsify/adwaita-core`'s `BreakpointBinState` (ADR 0004), driven from real
// `ResizeObserver` deliveries — the four rules it encodes are quoted at the top of
// `packages/web/adwaita-core/src/breakpoint-bin.ts`, each with its `file:lines`.
//
// WHAT THE ATTRIBUTE CARRIES. `Adw.Breakpoint` is a GObject, not a widget, and
// `adw_breakpoint_bin_add_breakpoint()` is the whole API — so a browser port needs a
// MARKUP form and there is no GIR property for one. `breakpoints` is a JSON array of
// `{ condition, setters: [{ target, property, value }] }`:
//
//   * `condition` is an Adwaita condition string, parsed by the same grammar as every
//     other breakpoint in this package (`max-width: 720px`).
//   * `target` is a CSS selector for a DESCENDANT. The C says it in the docs —
//     "Breakpoints are only allowed to modify widgets inside the AdwBreakpointBin, but
//     not on the AdwBreakpointBin itself" — and the selector cannot escape the subtree
//     because it is resolved with `querySelector` on this element.
//   * `property` is an ATTRIBUTE name and `value` its value. An attribute is the only
//     thing a browser can write on another custom element portably, and this package's
//     own properties ARE attributes (`<adw-label label>` above).
//   * `originalValue` is read ONCE, when the setter is registered, exactly as
//     `g_object_get_property` is at `adw_breakpoint_add_setter` (adw-breakpoint.c:1627).
//     An attribute the element did not have is restored by REMOVING it.
//
// `Adw.BreakpointBin` also measures itself differently once it holds a breakpoint:
// `adw_breakpoint_bin_measure` forces its MINIMUM to 0 (:388) and
// `adw_breakpoint_bin_get_request_mode` answers CONSTANT_SIZE (:362). That is the
// documented rule — "Adding a breakpoint to AdwBreakpointBin will result in it having
// no minimum size" — and it is why the element sets `min-width`/`min-height` to 0 and
// `overflow: hidden` (the C's own `gtk_widget_set_overflow(…, GTK_OVERFLOW_HIDDEN)`,
// :669) while a `breakpoints` attribute is present.
//
// Attributes:
//   breakpoints  (JSON — the breakpoints to add, in ORDER: a later one beats an earlier
//                  one when both match. `current-breakpoint` is reported as the index.)
//
// Events:
//   `notify::current-breakpoint` (CustomEvent, bubbles, `detail = { currentBreakpoint }`)
//     when the picked breakpoint changes — mirrors the GObject property of that name,
//     which is read-only and notified on every change (adw-breakpoint-bin.c:477).
//   `breakpoint-unapply` (CustomEvent, bubbles, `detail = { index }`) BEFORE the writes,
//     `breakpoint-apply` (CustomEvent, bubbles, `detail = { index }`) AFTER them — the
//     order of `adw_breakpoint_transition` (adw-breakpoint.c:1793, :1819). A listener on
//     the apply end therefore sees the INCOMING values and one on the unapply end the
//     OUTGOING ones; neither ever sees the restore in between.
//
// A11Y: `role="group"`. There is no box of its own: GTK clips overflow and gives the
// child the allocation, which a light-DOM passthrough already is.
//
// NOT PORTED: `adw_breakpoint_bin_set_pass_through()` (:893). It makes `contains()`
// return FALSE so the bin claims no event of its own (adw-breakpoint-bin.c:327); a
// browser has no `contains` override for that, and the property is private API besides.
// `adw_breakpoint_bin_set_natural_size()` (:906) and
// `adw_breakpoint_bin_set_warnings()` (:853) are the same shape — private helpers with
// no GIR property, no attribute, and nothing for a page to set.
//
// Reference: refs/libadwaita/src/adw-breakpoint-bin.c
// Reference: refs/libadwaita/src/adw-breakpoint.c (adw_breakpoint_transition)
// Copyright (c) 2023 Purism SPC (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { BreakpointBinState } from '@gjsify/adwaita-core';
import type { BreakpointSetter } from '@gjsify/adwaita-core';

import { observeAdaptiveSize } from '../breakpoints.js';

/** One authored setter, as it reads in the `breakpoints` attribute. */
interface AuthoredSetter {
    readonly target: string;
    readonly property: string;
    readonly value: string;
}

/** One authored breakpoint, as it reads in the `breakpoints` attribute. */
interface AuthoredBreakpoint {
    readonly condition: string;
    readonly setters: readonly AuthoredSetter[];
}

/** `breaks` parsed, or `[]` for anything that is not an array of breakpoints. */
function parseBreakpoints(raw: string | null): AuthoredBreakpoint[] {
    if (!raw) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // A typo in a condition must not empty the bin: `adw_breakpoint_check_condition`
        // returns FALSE for an unparseable condition (adw-breakpoint.c:1831), so C drops
        // that ONE breakpoint. Silently losing all of them would be a different widget.
        console.error('<adw-breakpoint-bin>: `breakpoints` is not JSON; no breakpoint is applied.');
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null) return [];
        const { condition, setters } = entry as Partial<AuthoredBreakpoint>;
        if (typeof condition !== 'string') return [];
        return [{ condition, setters: Array.isArray(setters) ? setters : [] }];
    });
}

export class AdwBreakpointBin extends HTMLElement {
    /** The C's own structure: a list of breakpoints, and at most one picked. */
    private _state = new BreakpointBinState<Element>();
    private _dispose: (() => void) | undefined;
    /**
     * What the last binding applied, carried across every rebind.
     *
     * `BreakpointBinState.inherit` exists for exactly this and its docblock records the
     * measurement: a browser element rebinds on every `connectedCallback`, and a bin that
     * restarts at "none applied" reads the size that LEFT the old breakpoint's range as
     * no change at all and leaves the child holding what the old bin wrote.
     */
    private _applied: number | null = null;
    /** Registration is deferred to the first allocation; see `_observe`. */
    private _pendingSync = false;
    /**
     * What each setter's target held when the setter was FIRST registered, keyed by
     * target + property + value.
     *
     * Carried across a REBIND because a rebind is not a re-registration. Upstream
     * `adw_breakpoint_add_setter` captures the original once, at the call
     * (`g_object_get_property`, adw-breakpoint.c:1627), and the widget outlives every
     * resize; a browser element rebinds on every connect, and re-reading the original
     * then would capture the value the OUTGOING breakpoint had already written — so the
     * restore would write back the applied value and the widget would never recover.
     * Measured: a bin applied at 400px, moved to a 500px parent and widened to 900px
     * kept its narrow label for good.
     *
     * Cleared when the AUTHOR rewrites `breakpoints`, which is a new
     * `add_breakpoint`/`add_setters` sequence and captures new originals.
     */
    private _originals = new Map<string, string | null>();

    static get observedAttributes() {
        return ['breakpoints'];
    }

    /** `Adw.BreakpointBin:current-breakpoint` — the picked index, or null. Read-only. */
    get currentBreakpoint(): number | null {
        return this._state.current;
    }

    /** `adw_breakpoint_bin_get_current_breakpoint()` (:841), under its property name. */
    get currentBreakpointAttribute(): string | null {
        const current = this._state.current;
        return current === null ? null : String(current);
    }

    /** `Adw.BreakpointBin:child` — the bin has one child, the one every breakpoint writes. */
    get child(): Element | null {
        return this.firstElementChild;
    }

    connectedCallback() {
        this.setAttribute('role', 'group');
        // A GTK widget is a box and an unknown custom element is `inline`, which measures
        // zero — and a bin measuring zero matches every condition forever. libadwaita
        // ships no rule for this widget, so the box model is set here rather than
        // invented in a partial.
        this.style.display = 'block';
        this._syncSizing();
        // Registration waits for the first allocation: `connectedCallback` of a bin fires
        // while its OWN markup is still being parsed, so `#caption` below it does not
        // exist yet and a setter resolved here would be dropped rather than restored.
        // `ResizeObserver` delivers its first observation after layout, by which time the
        // tree is whole and nothing has been written yet — so the originals are still the
        // ones `adw_breakpoint_add_setter` would have captured.
        this._pendingSync = true;
        this._observe();
    }

    disconnectedCallback() {
        this._dispose?.();
        this._dispose = undefined;
    }

    attributeChangedCallback(name?: string) {
        if (name !== 'breakpoints' || !this.isConnected) return;
        // The tree IS whole by the time anything rewrites the attribute, so a change
        // registers immediately rather than one allocation later — and it is a NEW
        // sequence of `add_breakpoint` calls, so the originals are captured afresh.
        this._originals.clear();
        this._syncBreakpoints();
    }

    /**
     * Rebuild the state from the attribute, keeping the applied breakpoint.
     *
     * The originals are read on the way, because `inherit` restores what the NEW
     * definitions captured: a restore read off a child the outgoing breakpoint already
     * changed would restore it to the applied value, which is no restore at all.
     */
    private _syncBreakpoints(): void {
        this._pendingSync = false;
        const authored = parseBreakpoints(this.getAttribute('breakpoints'));
        this._state = new BreakpointBinState<Element>();
        for (const breakpoint of authored) {
            const setters: BreakpointSetter<Element>[] = [];
            for (const setter of breakpoint.setters) {
                if (typeof setter?.target !== 'string' || typeof setter.property !== 'string') continue;
                const target = this.querySelector(setter.target);
                // An unmatched selector is a setter that would write to nothing; C's
                // `add_setters` needs a live object and refuses one that is not.
                if (target === null) continue;
                const key = `${setter.target}\u0000${setter.property}\u0000${setter.value}`;
                if (!this._originals.has(key)) this._originals.set(key, target.getAttribute(setter.property));
                setters.push({
                    object: target,
                    property: setter.property,
                    value: setter.value,
                    originalValue: this._originals.get(key) ?? null,
                });
            }
            this._state.add({ condition: breakpoint.condition, setters });
        }
        this._state.inherit(this._applied);
        this._state.setHasChild(this.child !== null);
        this._write(this._state.current);
        this._syncSizing();
    }

    /**
     * The size source. `ResizeObserver` delivers an initial observation, so the pick is
     * settled before first paint — the same seam `src/breakpoints.ts` gives every other
     * adaptive element, re-created on every connect so a widget MOVED between parents
     * tracks its conditions again.
     *
     * The CHILD is read here rather than cached, because
     * `adw_breakpoint_bin_size_allocate` tests it on every allocation (:427) and a child
     * appended after connect is then a child.
     */
    private _observe(): void {
        this._dispose?.();
        this._dispose = observeAdaptiveSize(this, (size) => {
            if (this._pendingSync) this._syncBreakpoints();
            this._state.setHasChild(this.child !== null);
            const transition = this._state.evaluate(size);
            if (transition === null) return;
            this._emit(transition.from, 'breakpoint-unapply');
            this._perform(transition.writes);
            this._write(transition.to);
            this._emit(transition.to, 'breakpoint-apply');
            this.dispatchEvent(
                new CustomEvent('notify::current-breakpoint', {
                    bubbles: true,
                    detail: { currentBreakpoint: this.currentBreakpointAttribute },
                }),
            );
        });
    }

    private _perform(writes: readonly { object: Element; property: string; value: unknown }[]): void {
        for (const write of writes) {
            // A `null` original is an attribute that was ABSENT, and `removeAttribute`
            // is its restore — the one that makes unapply the exact inverse of apply.
            if (write.value === null) write.object.removeAttribute(write.property);
            else write.object.setAttribute(write.property, String(write.value));
        }
    }

    private _write(index: number | null): void {
        this._applied = index;
    }

    private _emit(index: number | null, type: string): void {
        if (index === null) return;
        this.dispatchEvent(new CustomEvent(type, { bubbles: true, detail: { index } }));
    }

    /** The measure rules of a bin that holds breakpoints (:356, :388, :669). */
    private _syncSizing(): void {
        const adaptive = this._state.length > 0;
        // `display` and the clip are left to the author's stylesheet on purpose: the
        // MINIMUM is the documented rule, and writing `display` from here would fight a
        // host page that lays the bin out in a grid.
        this.style.minWidth = adaptive ? '0px' : '';
        this.style.minHeight = adaptive ? '0px' : '';
        if (adaptive) this.style.overflow = 'hidden';
    }
}

customElements.define('adw-breakpoint-bin', AdwBreakpointBin);
