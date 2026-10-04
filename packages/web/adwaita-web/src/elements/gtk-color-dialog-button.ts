// <gtk-color-dialog-button> — a button that shows a colour and opens a chooser for it.
// GTK's is a `GtkWidget` holding a plain `GtkButton` whose CHILD is a `GtkColorSwatch`
// (gtkcolordialogbutton.c:126-171), with the CSS node `colorbutton > button.color`.
// This element builds the same three nodes: the host, the button, the swatch.
//
// `rgba` is the colour, and `dialog` the chooser it opens. The C's sensitivity rule is
// `self->dialog != NULL && self->cancellable == NULL` (:384-390), and BOTH halves matter:
// a button with no dialog is insensitive, and so is one while a chooser is already up.
//
// WHAT THE DIALOG IS HERE. `GtkColorDialog` is a GObject carrying three parameters —
// `modal` (TRUE), `title` (NULL) and `with-alpha` (TRUE) — and presenting it is GTK's
// job. A browser has one colour chooser and no parameters for it, so:
//   · `dialog` accepts those three as a plain bag, and the two a browser can honour are
//     honoured: `title` becomes the picker's title and `withAlpha: false` says the button
//     will not carry a translucent colour, which is what `with-alpha` decides.
//   · the chooser is `<input type="color">`, and it has NO alpha channel — so a colour
//     chosen in it keeps the alpha the button already had. `withAlpha` is therefore not
//     observable here and says so in the header rather than pretending otherwise.
//   · the SECOND half of the sensitivity rule is not reproduced: the platform picker is
//     modal and reports no "still open" state, so `_pending` only stops a second click
//     from opening a second picker. That is a strictly weaker guarantee than
//     `cancellable` and the reason is the platform's, not a choice.
//
// `update_button_sensitivity`'s dialog half IS reproduced exactly, which is why the
// button is dead out of the box: `dialog` has to be set, from markup with the attribute
// or from code with the property.
//
// The swatch's accessible name is GTK's sentence, `accessible_color_name` (:334-347):
// `Red 75%, Green 25%, Blue 25%`, with `, Alpha 50%` appended while the colour is
// translucent — and `scale_round` is transcribed with it, `floor (value * 100 + 0.5)`
// clamped into 0…100 (:329-333), because a colour announced as "Red 75%" and drawn as
// 75.4% is a mismatch a reader can hear.
//
// Reference: refs/gtk/gtk/gtkcolordialogbutton.c (rgba, dialog, the sensitivity rule, the
//   accessible name, the swatch)
// Reference: refs/gtk/gtk/gtkcolordialog.c (the three parameters a GtkColorDialog holds)
// Reference: refs/libadwaita/src/stylesheet/widgets/_linked.scss:6 (`colorbutton > button`)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** A `GdkRGBA` — the four channels of `GtkColorDialogButton:rgba`, each 0…1. */
export interface GdkRgbaValue {
    red: number;
    green: number;
    blue: number;
    alpha: number;
}

/**
 * `GtkColorDialog`'s three parameters, under the property names. `filter` and `font-map`
 * are font dialog's; the colour one holds exactly these.
 */
export interface ColorDialogParameters {
    /** Whether the chooser is modal. Default `TRUE`, as in the GIR. */
    modal?: boolean;
    /** The chooser's title. Default `null`. */
    title?: string | null;
    /** Whether colours may carry alpha. Default `TRUE`, as in the GIR. */
    withAlpha?: boolean;
}

/** `gtk_color_dialog_button_init`'s own colour: `{ 0.75, 0.25, 0.25, 1.0 }` (:170). */
const INITIAL_RGBA: GdkRgbaValue = { red: 0.75, green: 0.25, blue: 0.25, alpha: 1 };

export class GtkColorDialogButton extends HTMLElement {
    private _buttonEl!: HTMLButtonElement;
    private _swatchEl!: HTMLSpanElement;
    private _inputEl!: HTMLInputElement;
    private _dialog: ColorDialogParameters | null = null;
    private _rgba: GdkRgbaValue = { ...INITIAL_RGBA };
    /** `self->cancellable != NULL` — a chooser run is in progress (:396-419). */
    private _pending = false;
    private _initialized = false;

    static get observedAttributes() {
        return ['rgba', 'dialog', 'disabled'];
    }

    /** `GtkColorDialogButton:rgba` — the selected colour. */
    get rgba(): GdkRgbaValue {
        return { ...this._rgba };
    }

    set rgba(value: string | GdkRgbaValue) {
        const next = typeof value === 'string' ? parseCssColor(value) : value;
        // `gtk_color_dialog_button_set_rgba` returns early when `gdk_rgba_equal` holds
        // (:520-522): a write of the colour already shown is not a change.
        if (next === null || rgbaEqual(next, this._rgba)) return;
        this._rgba = next;
        this._renderSwatch();
        this.dispatchEvent(new CustomEvent('notify::rgba', { bubbles: true, detail: { rgba: this.rgba } }));
    }

    /** `GtkColorDialogButton:dialog` — the chooser this button opens, or `null` for none. */
    get dialog(): ColorDialogParameters | null {
        return this._dialog;
    }

    set dialog(value: ColorDialogParameters | null) {
        // `g_set_object` + an early return (:508-512): the same dialog twice is not a
        // change, and the notify follows the change rather than the assignment.
        if (this._dialog === value) return;
        this._dialog = value;
        if (value?.title != null) this._inputEl.title = value.title;
        this._renderSensitivity();
        this.dispatchEvent(new CustomEvent('notify::dialog', { bubbles: true, detail: { dialog: value } }));
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;
        this.setAttribute('role', 'group');

        this._swatchEl = document.createElement('span');
        this._swatchEl.className = 'color-button-swatch';

        this._buttonEl = document.createElement('button');
        this._buttonEl.type = 'button';
        // `gtk_widget_add_css_class (self->button, "color")` (:163).
        this._buttonEl.className = 'adw-button color icon-only';
        // GTK marks the button HAS_POPUP (:174-176).
        this._buttonEl.setAttribute('aria-haspopup', 'dialog');
        this._buttonEl.appendChild(this._swatchEl);

        // A SIBLING of the button, not its child: an interactive control inside a `<button>`
        // is not content the HTML parser or the a11y tree can make sense of.
        this._inputEl = document.createElement('input');
        this._inputEl.type = 'color';
        this._inputEl.className = 'color-button-input';
        this._inputEl.tabIndex = -1;
        this._inputEl.setAttribute('aria-hidden', 'true');

        this.replaceChildren(this._buttonEl, this._inputEl);

        this._buttonEl.addEventListener('click', () => this.activate());
        this._inputEl.addEventListener('change', () => {
            this._pending = false;
            // The input carries no alpha channel, so the chosen colour keeps the alpha the
            // button already had — which is what `GtkColorDialog:with_alpha` decides, and
            // the only half of it a browser colour picker can honour.
            const chosen = parseCssColor(this._inputEl.value);
            if (chosen !== null) this.rgba = { ...chosen, alpha: this._rgba.alpha };
            this._renderSensitivity();
        });

        // The attribute door: a bare `dialog` means a chooser with the GIR's own defaults.
        if (this.hasAttribute('dialog')) this.dialog = {};
        const authored = this.getAttribute('rgba');
        if (authored !== null) this.rgba = authored;
        this._renderSwatch();
        this._renderSensitivity();
    }

    attributeChangedCallback(name?: string) {
        if (!this._initialized) return;
        if (name === 'rgba') {
            const authored = this.getAttribute('rgba');
            if (authored !== null) this.rgba = authored;
            return;
        }
        if (name === 'dialog') {
            this.dialog = this.hasAttribute('dialog') ? (this._dialog ?? {}) : null;
            return;
        }
        this._renderSensitivity();
    }

    /**
     * The `::activate` action signal (:283-296), which `activated()` binds straight to
     * `gtk_widget_activate (self->button)` (:378-382): pressing the button and activating
     * the widget are the same thing, and both pop the chooser.
     */
    activate(): void {
        this.dispatchEvent(new CustomEvent('activate', { bubbles: true }));
        this._choose();
    }

    /** `button_clicked` (:394-419) — the whole run, and it is one guard deep. */
    private _choose(): void {
        if (this._dialog === null || this._pending) return;
        this._pending = true;
        this._renderSensitivity();
        // The input holds no alpha, so it is seeded with the opaque part and the alpha the
        // button had comes back untouched when `change` reads only `value`.
        this._inputEl.value = formatHex(this._rgba);
        this._inputEl.click();
    }

    /** `update_button_sensitivity` (:380-391), with the run guard explained in the header. */
    private _renderSensitivity(): void {
        const sensitive = this._dialog !== null && !this.hasAttribute('disabled');
        this._buttonEl.disabled = !sensitive;
        this._buttonEl.classList.toggle('disabled', !sensitive);
    }

    private _renderSwatch(): void {
        this._swatchEl.style.backgroundColor = formatCssColor(this._rgba);
        // The checkerboard behind a translucent colour is GtkColorSwatch's own drawing;
        // `data-translucent` is what `_color_button.scss` keys it on.
        this._swatchEl.dataset.translucent = String(this._rgba.alpha < 1);
        // `accessible_color_name` (:334-347), on the swatch as on the C, and on the button
        // beside it — a swatch with a name inside a button with none announces nothing.
        const name = describeColor(this._rgba);
        this._swatchEl.setAttribute('aria-label', name);
        this._buttonEl.setAttribute('aria-label', name);
    }
}

customElements.define('gtk-color-dialog-button', GtkColorDialogButton);

/** `gdk_rgba_equal` — four exact comparisons, so a write of the same colour is not one. */
export function rgbaEqual(a: GdkRgbaValue, b: GdkRgbaValue): boolean {
    return a.red === b.red && a.green === b.green && a.blue === b.blue && a.alpha === b.alpha;
}

/**
 * `scale_round` (:329-333) — `floor (value * scale + 0.5)`, clamped into 0…scale.
 */
export function scaleRound(value: number, scale: number): number {
    return Math.min(scale, Math.max(0, Math.floor(value * scale + 0.5)));
}

/** `accessible_color_name` (:334-347), with the Alpha clause only while it is translucent. */
export function describeColor(color: GdkRgbaValue): string {
    const parts = [
        `Red ${scaleRound(color.red, 100)}%`,
        `Green ${scaleRound(color.green, 100)}%`,
        `Blue ${scaleRound(color.blue, 100)}%`,
    ];
    if (color.alpha < 1) parts.push(`Alpha ${scaleRound(color.alpha, 100)}%`);
    return parts.join(', ');
}

/** `#rrggbb` for an opaque colour and `rgba(...)` for a translucent one — the two an author writes. */
export function formatHex(color: GdkRgbaValue): string {
    const channel = (value: number) =>
        Math.round(Math.min(1, Math.max(0, value)) * 255)
            .toString(16)
            .padStart(2, '0');
    return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}

function formatCssColor(color: GdkRgbaValue): string {
    const hex = formatHex(color);
    return color.alpha < 1
        ? `${hex}${Math.round(color.alpha * 255)
              .toString(16)
              .padStart(2, '0')}`
        : hex;
}

const CSS_COLOR = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;

/**
 * Any CSS colour the browser understands → a `GdkRGBA`.
 *
 * The PARSE IS THE BROWSER'S, through CSSOM: an unrecognised value leaves
 * `style.color` empty, and a recognised one comes back normalised to `rgb()`/`rgba()`.
 * That is why `#abc`, `hsl()`, `color-mix()` and a named colour all work here without a
 * second parser — and why the one thing that cannot be parsed is refused rather than
 * guessed at, which is what the C's `G_IS_VALUE`/`gdk_rgba_parse` pair does.
 */
export function parseCssColor(value: string): GdkRgbaValue | null {
    const probe = document.createElement('span');
    probe.style.color = '';
    probe.style.color = value.trim();
    const normalized = probe.style.color;
    if (normalized === '') return null;
    const match = CSS_COLOR.exec(normalized);
    if (match === null) return null;
    const alpha = match[4];
    return {
        red: Number(match[1]) / 255,
        green: Number(match[2]) / 255,
        blue: Number(match[3]) / 255,
        alpha: alpha === undefined ? 1 : alpha.endsWith('%') ? Number.parseFloat(alpha) / 100 : Number(alpha),
    };
}
