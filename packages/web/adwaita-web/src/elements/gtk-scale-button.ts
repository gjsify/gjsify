// <gtk-scale-button> — a button whose press opens a scale: the volume control of a
// media player, the brightness slider of a toolbar. GTK builds it from a TOGGLE BUTTON
// with an icon plus a popover ("dock") holding a box of [minus, scale, plus]
// (gtk/ui/gtkscalebutton.ui), and every rule below is transcribed from the C rather than
// guessed, because most of them are visible and none is "the slider just works".
//
//   · THE ICON FOLLOWS THE VALUE. `gtk_scale_button_update_icon` (:1040-1098): no icon
//     list at all draws `image-missing`; ONE icon is used for every value; TWO split the
//     range in half; THREE or more put the first at `lower`, the second at `upper`, and
//     spread the rest evenly over what is between — `2 + floor((value - lower) / ((upper
//     - lower) / (n - 2)))`. With exactly three names that step is the whole span, so the
//     interior shares ONE icon and the spread is what FIVE names buy; that is the C's
//     arithmetic and it is transcribed rather than rounded into a nicer story.
//   · THE DEFAULTS ARE GTKS. `gtk_adjustment_new (0, 0, 100, 2, 20, 0)` (:452) — 0…100 by
//     2, a page of 20 — and a VERTICAL orientation (:449-450), which is why the button
//     grows upwards.
//   · THE STEPS MOVE BY THE PAGE INCREMENT, not the step (:984-1013), and each stepper
//     goes INSENSITIVE at its end: `value < upper` for plus, `lower < value` for minus
//     (:1099-1100).
//   · THE SCROLL HANDLER CLAMPS rather than wrapping, one step per notch, and consumes the
//     event (:917-935).
//
// The scale itself is an `<input type="range">`, the substitution the NativeScript port
// already makes for `GtkScale` (`slider-row`); `Gtk.Scale` gets its own element in
// another work package, and until then this is the one range control in the package.
// `SpinState` is `@gjsify/adwaita-core`'s portable adjustment (ADR 0047), which names
// `GtkScaleButton.adjustment` as one of the seven properties it exists for.
//
// `active` is READ-ONLY upstream (`G_PARAM_READABLE`, :277-283): pressing the button
// toggles it, and the dock popping up or down follows. So it is a getter here and not an
// attribute — writing one would be a second door GTK does not have.
//
// The key bindings are GTK's (:355-388): Space, Return and Enter pop the scale up,
// Escape puts it down.
//
// A11Y: GTK's role is GROUP (:402), and GTK pushes VALUE_MIN/MAX/NOW onto the ScaleButton
// itself (:474-480, 1111-1113) — the upper bound being `upper - page_size`, the effective
// end of the range. Both land here where they belong: the role on the host, the values on
// the range that owns them.
//
// Reference: refs/gtk/gtk/gtkscalebutton.c (icon selection, orientation, the steppers,
//   the scroll handler, the key bindings)
// Reference: refs/gtk/gtk/ui/gtkscalebutton.ui:13-56 (the template: the dock and its box)
// Reference: refs/libadwaita/src/stylesheet/widgets/_scale.scss (trough, highlight, slider)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { SpinState, adjustmentRange, parseAdjustment, type AdwAdjustmentInput } from '@gjsify/adwaita-core';

import { createGtkImage } from './gtk-image.js';
// SIDE-EFFECT import, for the reason `gtk-menu-button.ts` carries one: the binding is
// used in type position only, so a combined `import { GtkPopover }` would be elided by
// TypeScript and take the registration with it.
import './gtk-popover.js';
import type { GtkPopover } from './gtk-popover.js';

/** `gtk_adjustment_new (0, 0, 100, 2, 20, 0)` — the adjustment a bare scale button has. */
const GTK_ADJUSTMENT: AdwAdjustmentInput = {
    lower: 0,
    upper: 100,
    stepIncrement: 2,
    pageIncrement: 20,
    pageSize: 0,
};

export class GtkScaleButton extends HTMLElement {
    private readonly _state = new SpinState();
    private _buttonEl!: HTMLButtonElement;
    private _glyph!: HTMLElement;
    private _dockEl!: GtkPopover;
    private _rangeEl!: HTMLInputElement;
    private _minusEl!: HTMLButtonElement;
    private _plusEl!: HTMLButtonElement;
    private _icons: string[] = [];
    private _initialized = false;
    /** Set while a render writes the range, so its `input` echo is not fed back. */
    private _syncing = false;

    static get observedAttributes() {
        return ['value', 'icons', 'adjustment', 'has-frame', 'orientation'];
    }

    /** `Gtk.ScaleButton:value` — always inside the adjustment's range. */
    get value(): number {
        return this._state.value;
    }

    set value(value: number) {
        this._applyValue(value);
    }

    /** `Gtk.ScaleButton:active` — read-only upstream, so read-only here. */
    get active(): boolean {
        return this._buttonEl?.classList.contains('checked') ?? false;
    }

    /** `Gtk.ScaleButton:icons` — the icon names the value picks from. */
    get icons(): string[] {
        return [...this._icons];
    }

    set icons(value: string[]) {
        this.setAttribute('icons', JSON.stringify(value));
    }

    /** `Gtk.ScaleButton:has-frame` — false by default, which is a flat button here. */
    get hasFrame(): boolean {
        return this.hasAttribute('has-frame');
    }

    set hasFrame(value: boolean) {
        this.toggleAttribute('has-frame', !!value);
    }

    /** `GtkOrientable:orientation` — vertical by default, the GTK shape of the button. */
    get orientation(): 'horizontal' | 'vertical' {
        return this.getAttribute('orientation') === 'horizontal' ? 'horizontal' : 'vertical';
    }

    set orientation(value: 'horizontal' | 'vertical') {
        this.setAttribute('orientation', value);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;
        this.setAttribute('role', 'group');

        this._glyph = createGtkImage('image-missing', 'scale-button-glyph');
        this._buttonEl = document.createElement('button');
        this._buttonEl.type = 'button';
        this._buttonEl.className = 'adw-button scale-button-icon flat';
        this._buttonEl.setAttribute('aria-expanded', 'false');
        this._buttonEl.appendChild(this._glyph);

        this._minusEl = this._stepButton('list-remove-symbolic', 'Decrease');
        this._plusEl = this._stepButton('list-add-symbolic', 'Increase');

        this._rangeEl = document.createElement('input');
        this._rangeEl.type = 'range';
        this._rangeEl.className = 'scale-button-range';
        this._rangeEl.addEventListener('input', () => {
            if (this._syncing) return;
            this._applyValue(Number(this._rangeEl.value));
        });

        const box = document.createElement('div');
        box.className = 'scale-button-box';
        // `apply_orientation` REORDERS the box so a vertical scale reads plus above minus
        // (:869-889). Reversing the column is the same arrangement without moving nodes,
        // which would take focus off a stepper mid-click.
        box.append(this._minusEl, this._rangeEl, this._plusEl);

        this._dockEl = document.createElement('gtk-popover') as GtkPopover;
        // `gtk/ui/gtkscalebutton.ui` gives the dock the `scale-popup` style class.
        this._dockEl.classList.add('scale-popup');
        this._dockEl.replaceChildren(box);
        this._dockEl.anchor = this._buttonEl;

        this.replaceChildren(this._buttonEl, this._dockEl);

        this._buttonEl.addEventListener('click', () => this._toggleDock());
        this._minusEl.addEventListener('click', () => this._step(-1));
        this._plusEl.addEventListener('click', () => this._step(1));
        // The dock putting ITSELF down is what releases the button, so an outside click or
        // Escape reaches the same state as pressing it again (:436-441).
        this._dockEl.subscribe((open) => this._renderDock(open));
        this.addEventListener(
            'wheel',
            (event) => {
                if (event.deltaY === 0) return;
                event.preventDefault();
                this._applyValue(this._state.value - Math.sign(event.deltaY) * this._state.adjustment.stepIncrement);
            },
            { passive: false },
        );
        this.addEventListener('keydown', (event) => this._onKeyDown(event));

        // The attribute doors, read once here: `attributeChangedCallback` runs BEFORE
        // `connectedCallback` for an attribute the markup already carried, and it returns
        // early while uninitialised — so an authored `icons` would otherwise be dropped.
        this._icons = parseIcons(this.getAttribute('icons'));
        this._syncAdjustment();
        this._render();
    }

    attributeChangedCallback(name?: string) {
        if (!this._initialized) return;
        if (name === 'adjustment') {
            this._syncAdjustment();
            return;
        }
        if (name === 'icons') {
            this._icons = parseIcons(this.getAttribute('icons'));
            this._render();
            this.dispatchEvent(new CustomEvent('notify::icons', { bubbles: true }));
            return;
        }
        if (name === 'value') {
            const raw = this.getAttribute('value');
            // An absent or unreadable `value` is no write at all, not a write of zero: a
            // `<gtk-scale-button>` with no `value` opens at the bottom of its range, which
            // is what the adjustment `gtk_scale_button_init` builds gives.
            if (raw === null || raw.trim() === '') return;
            const value = Number(raw);
            if (Number.isFinite(value)) this._applyValue(value);
            return;
        }
        this._render();
    }

    /** `cb_scale_value_changed` (:1092-1114) — the icon, the steppers, then the signals. */
    private _applyValue(value: number): void {
        const changed = this._state.setValue(value);
        this._render();
        if (!changed) return;
        const current = this._state.value;
        this.setAttribute('value', String(current));
        this.dispatchEvent(new CustomEvent('value-changed', { bubbles: true, detail: { value: current } }));
        this.dispatchEvent(new CustomEvent('notify::value', { bubbles: true, detail: { value: current } }));
    }

    /** The range, from GTK's default with whatever `adjustment` authored over it. */
    private _syncAdjustment(): void {
        const authored = parseAdjustment(this.getAttribute('adjustment'));
        const input: AdwAdjustmentInput = { ...GTK_ADJUSTMENT, ...authored };
        // `value` belongs to the widget, not to the range: an adjustment that authored one
        // must not silently move what the button already held — and an authored `value`
        // attribute is read here, because the callback that would have applied it ran
        // before this element was connected.
        const raw = this.getAttribute('value');
        const authoredValue = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
        input.value = Number.isFinite(authoredValue) ? authoredValue : this._state.value;
        this._state.configure(input);
        this._render();
        this.dispatchEvent(new CustomEvent('notify::adjustment', { bubbles: true }));
    }

    private _render(): void {
        if (!this._initialized) return;
        const value = this._state.value;
        const [low, high] = adjustmentRange(this._state.adjustment);

        const icon = selectIcon(this._icons, value, low, high);
        if (this._glyph.getAttribute('icon-name') !== icon) this._glyph.setAttribute('icon-name', icon);
        this._buttonEl.setAttribute('aria-label', icon);

        this._syncing = true;
        this._rangeEl.min = String(low);
        this._rangeEl.max = String(high);
        this._rangeEl.step = String(this._state.adjustment.stepIncrement);
        this._rangeEl.value = String(value);
        this._rangeEl.setAttribute('aria-valuemin', String(low));
        this._rangeEl.setAttribute('aria-valuemax', String(high));
        this._rangeEl.setAttribute('aria-valuenow', String(value));
        this._syncing = false;

        this._minusEl.disabled = !(low < value);
        this._plusEl.disabled = !(value < high);
        this._buttonEl.classList.toggle('flat', !this.hasFrame);
        this.classList.toggle('horizontal', this.orientation === 'horizontal');
        this.classList.toggle('vertical', this.orientation === 'vertical');
    }

    private _stepButton(icon: string, label: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'adw-button scale-button-step flat';
        button.setAttribute('aria-label', label);
        button.appendChild(createGtkImage(icon));
        return button;
    }

    private _toggleDock(): void {
        if (this.active) this._dock('popdown');
        else this._dock('popup');
    }

    /** `gtk_scale_popup` (:940-948) — press the button in, which pops the dock up. */
    private _dock(signal: 'popup' | 'popdown'): void {
        const open = signal === 'popup';
        if (this.active === open) return;
        this._buttonEl.classList.toggle('checked', open);
        this._buttonEl.setAttribute('aria-expanded', String(open));
        if (open) {
            this._dockEl.popup();
            // `cb_popup_mapped` (:1116-1122) hands focus to the scale.
            this._rangeEl.focus();
        } else {
            this._dockEl.popdown();
            this._buttonEl.focus();
        }
        this.dispatchEvent(new CustomEvent(signal, { bubbles: true }));
        this.dispatchEvent(new CustomEvent('notify::active', { bubbles: true, detail: { active: open } }));
    }

    /** The dock closing on its own — an outside click or Escape. */
    private _renderDock(open: boolean): void {
        this._dock(open ? 'popup' : 'popdown');
    }

    /** `button_click` (:1000-1013): one PAGE increment, and the end of the range stops it. */
    private _step(direction: 1 | -1): void {
        this._applyValue(this._state.value + direction * this._state.adjustment.pageIncrement);
    }

    /** Space / Return / Enter pop up, Escape pops down — the bindings `class_init` adds. */
    private _onKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            if (!this.active) return;
            event.preventDefault();
            this._dock('popdown');
            return;
        }
        // Only the ICON button pops. The steppers answer Space themselves as buttons, and
        // the range needs every key it has.
        if (event.target !== this._buttonEl) return;
        if (event.key !== ' ' && event.key !== 'Enter' && event.key !== 'Return') return;
        event.preventDefault();
        this._toggleDock();
    }
}

customElements.define('gtk-scale-button', GtkScaleButton);

/**
 * `gtk_scale_button_update_icon` (:1040-1098) — which of the icon names the value picks.
 * Transcribed including the arithmetic, because "spread evenly" is only true of the
 * interior: `lower` and `upper` always take the first two names.
 */
export function selectIcon(icons: string[], value: number, lower: number, upper: number): string {
    const first = icons[0];
    if (first === undefined || first === '') return 'image-missing';
    if (icons.length === 1) return first;
    if (icons.length === 2) return value < (upper - lower) / 2 + lower ? first : (icons[1] ?? first);
    if (value === lower) return first;
    if (value === upper) return icons[1] ?? first;
    const step = (upper - lower) / (icons.length - 2);
    return icons[Math.floor((value - lower) / step) + 2] ?? first;
}

/**
 * The `icons` attribute, as the portable array a list-model property takes elsewhere
 * (ADR 0046). Total in every failure mode, because malformed JSON is an author slip that
 * must not stop the element upgrading — and an empty list has an answer of its own,
 * `image-missing` (:1046-1050).
 */
export function parseIcons(raw: string | null | undefined): string[] {
    if (!raw) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((name): name is string => typeof name === 'string');
}
