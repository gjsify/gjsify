// <gtk-level-bar> — a filled portion of a bounded range: a password strength meter, a
// battery. It is NOT a progress bar: the value may go DOWN, and it is drawn in
// PROPORTION to an interval (`min-value`…`max-value`), not to a 0…1 fraction.
//
// CSS NODES, PORTED VERBATIM (gtklevelbar.c:99-116):
//   levelbar[.discrete] ─╮
//     ├── trough         │
//     │   ├── block.filled.level-name
//     │   └── block.empty
// The `level-name` class on a filled block IS the public API for colouring a bar —
// libadwaita paints `.low` warning, `.high`/`:not(.empty)` accent and `.full` success
// off it (refs/libadwaita/src/stylesheet/widgets/_level-bar.scss:71-93), and an
// application adds its own offset to add its own class (gtklevelbar.c:59-76).
//
// WHICH CLASS, FROM THE OFFSETS. `update_level_style_classes` walks the offsets in
// ASCENDING order and stops at the first one that can name the current value
// (gtklevelbar.c:604-625): the lowest offset at or above the value wins, and the lowest
// one of all wins even when the value sits below it. Three offsets exist before any
// code runs — `low` 0.25, `high` 0.75, `full` 1.0 (gtklevelbar.c:1058-1060) — so
// `value = 0` already reads `low`, exactly as it does in GTK.
//
// HOW MANY BLOCKS. Continuous is ONE drawn level with two nodes under the trough (the
// empty one and the filled one painted on top, gtklevelbar.c:344-362); discrete is
// `MAX(1, round(max) − round(min))` drawn blocks (gtklevelbar.c:285-294) of which
// `MIN(blocks, round(value) − round(min))` are filled (gtklevelbar.c:630-633). `inverted`
// counts from the other end — it reverses which block index is filled, it does not
// reverse the DOM (gtklevelbar.c:637, 648).
//
// SETTING AN END MOVES THE VALUE. `set_min_value` pushes `value` up to the new minimum
// and `set_max_value` pushes it down to the new maximum (gtklevelbar.c:1191-1192,
// :1229-1230), and the maximum additionally CLAMPS every offset into the new interval
// (:1234, :667-682) — the minimum deliberately does not. Both are GObject property
// setters, so each fires `notify::` for the value it moved as well as its own.
//
// A11Y: `role="meter"`, which is GtkLevelBar's own accessible role
// (gtklevelbar.c:1033), with `aria-valuemin` / `aria-valuemax` / `aria-valuenow` over
// the REAL interval rather than 0…1 (gtklevelbar.c:1070-1074, :1199-1202, :1238-1241,
// :1266-1268).
//
// Events: `notify::<prop>` (CustomEvent, bubbles, detail `{ <prop>: value }`) on every
// real change, and `offset-changed` (CustomEvent, bubbles, detail `{ name }`), GtkLevelBar's
// own DETAILED signal (gtklevelbar.c:936-958, :1410) — the browser has no per-name signal
// channel, so the name rides in the detail.
//
// Reference: refs/gtk/gtk/gtklevelbar.c
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { normalizeBoxOrientation, type BoxOrientation } from '@gjsify/adwaita-core';

/** `GtkLevelBarMode`, spelled as the GIR's enum nicks (:1004-1008). */
type LevelBarMode = 'continuous' | 'discrete';

/** The offsets GTK installs before any application code runs (gtklevelbar.c:1058-1060). */
const DEFAULT_OFFSETS: readonly (readonly [string, number])[] = [
    ['low', 0.25],
    ['high', 0.75],
    ['full', 1.0],
];

/**
 * The offset that names `value`, transcribed from `update_level_style_classes`
 * (gtklevelbar.c:604-625): ascending, first offset at or above the value wins, and an
 * offset whose PREDECESSOR is not below the value names nothing — the walk continues.
 * Keeping the `previous < value` test rather than simplifying it away is the point:
 * two offsets sharing a value make the two spellings disagree, and only one is C.
 */
function levelClassFor(offsets: readonly (readonly [string, number])[], value: number): string | null {
    for (let i = 0; i < offsets.length; i++) {
        const [name, threshold] = offsets[i];
        if (value > threshold) continue;
        const previous = i === 0 ? null : offsets[i - 1][1];
        if (previous === null || previous < value) return name;
    }
    return null;
}

/** A missing or unparseable attribute is `fallback`, which is also the GIR default. */
function numberAttribute(element: HTMLElement, name: string, fallback: number): number {
    const raw = Number.parseFloat(element.getAttribute(name) ?? '');
    return Number.isFinite(raw) ? raw : fallback;
}

export class GtkLevelBar extends HTMLElement {
    private _trough!: HTMLSpanElement;
    private _initialized = false;
    /** Offset name → value, kept sorted ascending exactly as the C's `GList` is. */
    private _offsets: (readonly [string, number])[] = DEFAULT_OFFSETS.map((entry) => [...entry] as const);

    static get observedAttributes() {
        return ['value', 'min-value', 'max-value', 'mode', 'inverted', 'orientation', 'disabled'];
    }

    /** `Gtk.LevelBar:value` — the filled level. */
    get value(): number {
        return numberAttribute(this, 'value', 0);
    }

    set value(v: number) {
        this._write('value', String(v));
    }

    /** `Gtk.LevelBar:min-value` — the low end of the interval. Defaults to 0. */
    get minValue(): number {
        return numberAttribute(this, 'min-value', 0);
    }

    set minValue(v: number) {
        this._write('min-value', String(v));
    }

    /** `Gtk.LevelBar:max-value` — the high end of the interval. Defaults to 1. */
    get maxValue(): number {
        return numberAttribute(this, 'max-value', 1);
    }

    set maxValue(v: number) {
        this._write('max-value', String(v));
    }

    /** `Gtk.LevelBar:mode` — one filled block, or one per unit of the interval. */
    get mode(): LevelBarMode {
        return this.getAttribute('mode') === 'discrete' ? 'discrete' : 'continuous';
    }

    set mode(v: LevelBarMode) {
        this._write('mode', v);
    }

    /** `Gtk.LevelBar:inverted` — grow from the far end. */
    get inverted(): boolean {
        return this.hasAttribute('inverted');
    }

    set inverted(v: boolean) {
        this.toggleAttribute('inverted', !!v);
    }

    /** `GtkOrientable:orientation` (gtklevelbar.c:825-835). Horizontal fills rightwards. */
    get orientation(): BoxOrientation {
        return normalizeBoxOrientation(this.getAttribute('orientation'));
    }

    set orientation(v: BoxOrientation) {
        this._write('orientation', v);
    }

    /**
     * `setAttribute` runs the custom-element reaction for a write that changes nothing,
     * while every GObject setter here returns early when the value is already right
     * (gtklevelbar.c:1186-1187, :1224-1225, :1300-1301, :1260-1261). This is the guard
     * that makes "notify only on a real change" true for the numeric and enum half.
     */
    private _write(name: string, value: string): void {
        if (this.getAttribute(name) !== value) this.setAttribute(name, value);
    }

    get disabled(): boolean {
        return this.hasAttribute('disabled');
    }

    set disabled(v: boolean) {
        this.toggleAttribute('disabled', !!v);
    }

    /**
     * `gtk_level_bar_add_offset_value` (gtklevelbar.c:1395-1411): replaces the value of
     * an offset of the same name, keeps the list sorted, refuses a value outside the
     * interval (`g_return_if_fail (gtk_level_bar_value_in_interval (…))`, :1403), and
     * emits `offset-changed` — but only when the value actually moved (:259-260).
     */
    addOffsetValue(name: string, value: number): void {
        if (value < this.minValue || value > this.maxValue) return;
        const existing = this._offsets.findIndex(([key]) => key === name);
        if (existing !== -1 && this._offsets[existing][1] === value) return;
        if (existing !== -1) this._offsets.splice(existing, 1);
        this._offsets.push([name, value]);
        this._offsets.sort((a, b) => a[1] - b[1]);
        this._render();
        this.dispatchEvent(new CustomEvent('offset-changed', { bubbles: true, detail: { name } }));
    }

    /** `gtk_level_bar_remove_offset_value` (gtklevelbar.c:1362-1377). */
    removeOffsetValue(name: string): void {
        const existing = this._offsets.findIndex(([key]) => key === name);
        if (existing === -1) return;
        this._offsets.splice(existing, 1);
        this._render();
    }

    /** `gtk_level_bar_get_offset_value` (gtklevelbar.c:1423-1443) — `null` when absent. */
    offsetValue(name: string): number | null {
        return this._offsets.find(([key]) => key === name)?.[1] ?? null;
    }

    connectedCallback() {
        if (this._initialized) {
            this._render();
            return;
        }
        this._initialized = true;

        this._trough = document.createElement('span');
        this._trough.className = 'adw-level-bar-trough';
        this.replaceChildren(this._trough);

        this.setAttribute('role', 'meter');
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized || name === 'disabled') return;
        // A NEW interval endpoint drags the value with it (gtklevelbar.c:1191-1192,
        // :1229-1230); writing the clamped value back re-enters here as a `value` change,
        // so the value notifies first and the endpoint second — the C's order, where
        // `set_value_internal` runs before the endpoint's own `g_object_notify_by_pspec`
        // (:1164 before :1204, :1243). `set_max_value` clamps the OFFSETS as well, and on
        // both paths.
        if (name === 'min-value' && this.value < this.minValue) {
            this._write('value', String(this.minValue));
            this._notify(name);
            return;
        }
        if (name === 'max-value') {
            this._clampOffsets();
            if (this.value > this.maxValue) {
                this._write('value', String(this.maxValue));
                this._notify(name);
                return;
            }
        }
        this._render();
        this._notify(name);
    }

    private _notify(name: string): void {
        this.dispatchEvent(
            new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: this._property(name) } }),
        );
    }

    /** One interval endpoint CLAMPS every offset into the new range — the other does not. */
    private _clampOffsets(): void {
        for (let i = 0; i < this._offsets.length; i++) {
            const [name, value] = this._offsets[i];
            if (value < this.minValue) this._offsets[i] = [name, this.minValue];
            else if (value > this.maxValue) this._offsets[i] = [name, this.maxValue];
        }
    }

    /** The `notify::` detail for `name`: the PROPERTY, parsed, not the raw attribute. */
    private _property(name: string): string | number | boolean {
        switch (name) {
            case 'value':
                return this.value;
            case 'min-value':
                return this.minValue;
            case 'max-value':
                return this.maxValue;
            case 'mode':
                return this.mode;
            case 'inverted':
                return this.inverted;
            default:
                return this.orientation;
        }
    }

    private _render(): void {
        if (!this._trough) return;
        const discrete = this.mode === 'discrete';
        const vertical = this.orientation === 'vertical';
        // `update_mode_style_classes` puts exactly one of the two on the node
        // (gtklevelbar.c:574-590), and libadwaita's `levelbar.horizontal` /
        // `levelbar.vertical` selectors are what read them.
        this.classList.toggle('continuous', !discrete);
        this.classList.toggle('discrete', discrete);
        this.classList.toggle('vertical', vertical);
        this.classList.toggle('horizontal', !vertical);

        const min = this.minValue;
        const max = this.maxValue;
        const value = this.value;
        // `gtk_level_bar_get_num_blocks` (gtklevelbar.c:285-294) — the node count is one
        // MORE than the block count in continuous mode: the empty level is its own node.
        const blocks = discrete ? Math.max(1, Math.round(max) - Math.round(min)) : 1;
        const level = levelClassFor(this._offsets, value);

        this._trough.replaceChildren();
        if (!discrete) {
            // The empty level is allocated full size and the filled one painted over it
            // (gtklevelbar.c:344-362); at value 0 the filled node is never allocated at
            // all (:429-430), which is what `hidden` stands for here.
            const empty = this._block('empty', null);
            const filled = this._block('filled', level);
            filled.style.setProperty('--level-fraction', String(max > min ? (value - min) / (max - min) : 0));
            filled.hidden = value === 0;
            this._trough.append(empty, filled);
        } else {
            const count = Math.min(blocks, Math.max(0, Math.round(value) - Math.round(min)));
            for (let i = 0; i < blocks; i++) {
                // `inverted` fills from the far end by reversing the INDEX, so the first
                // DOM block is filled last (gtklevelbar.c:637, 648).
                const isFilled = this.inverted ? i >= blocks - count : i < count;
                this._trough.append(this._block(isFilled ? 'filled' : 'empty', isFilled ? level : null));
            }
        }

        this.setAttribute('aria-valuemin', String(min));
        this.setAttribute('aria-valuemax', String(max));
        this.setAttribute('aria-valuenow', String(value));
    }

    /** One `block` node, `filled` or `empty`, wearing the offset's class (:635-652). */
    private _block(state: 'filled' | 'empty', level: string | null): HTMLSpanElement {
        const block = document.createElement('span');
        block.className = `adw-level-bar-block ${state}`;
        if (state === 'filled' && level) block.classList.add(level);
        return block;
    }
}

customElements.define('gtk-level-bar', GtkLevelBar);
