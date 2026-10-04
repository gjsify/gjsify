// <gtk-frame> — Gtk.Frame: a decorative border with a label embedded in its top edge.
//
// GTK puts the label WIDGET and the child in the same box: the label takes the whole
// width line above the child and the child gets what is left
// (gtkframe.c:554-580, `compute_child_allocation`), which is a flex column. The label is
// NOT stretched — it is measured, clipped to the frame's width and placed at
// `(width - label_width) * label_xalign` (gtkframe.c:519-553), which is `align-self` on
// the label and nothing else. `label-xalign` is mirrored in RTL by GTK itself
// (gtkframe.c:530-533); `flex-start` is direction-aware already, so the mirroring is the
// browser's rather than a second rule.
//
// `label` is the STRING GtkFrame carries, and `gtk_frame_set_label()` turns it into a
// `Gtk.Label` (gtkframe.c:349-358) — so the element builds that label itself and unparents
// it when the string goes away, exactly as `set_label_widget(NULL)` does. An authored
// `label-widget` slot WINS over the string, which is the order GTK's two setters leave it
// in whenever the widget is set last (gtkframe.c:424-444 replaces one with the other).
//
// `gtk_frame_init` sets `GTK_OVERFLOW_HIDDEN` (gtkframe.c:246), and the GIR doc says the
// frame CLIPS its child — so the border can round the child's corners, at the cost of
// cutting its shadows off. `overflow: hidden` is that, in `_frame.scss`.
//
// A11Y: `role="group"`, GtkFrame's own accessible role (gtkframe.c:209). GTK also wires
// LABELLED_BY from the frame to its child (gtkframe.c:389-398); the browser form of that
// is the child's `aria-labelledby`, which belongs to whoever authors the child.
//
// Reference: refs/gtk/gtk/gtkframe.c:170-209, :245-257, :519-580
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss:4-15
// Copyright (c) The GTK Team. LGPLv2.1+.
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { glibClamp, labelYalignAlignItems } from '@gjsify/adwaita-core';

import { bindSlottedChildren } from '../slotted-children.js';

/** `Gtk.Frame:label-xalign`'s pspec default (gtkframe.c:180-183, and `:253`). */
const LABEL_XALIGN_DEFAULT = 0;

/** The float `label_xalign` is held in: clamped to the pspec's 0…1, unparseable is the default. */
function normalizeLabelXalign(value: string | null): number {
    const parsed = Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? glibClamp(parsed, 0, 1) : LABEL_XALIGN_DEFAULT;
}

export class GtkFrame extends HTMLElement {
    private _mutations: MutationObserver | null = null;

    static get observedAttributes() {
        return ['label', 'label-xalign'];
    }

    /** The element's own `<gtk-label>`, built from `label` — null while no string is set. */
    private _labelEl: HTMLElement | null = null;

    /** True while {@link _sync} writes `label` onto that widget, so its notify does not escape. */
    private _writingLabel = false;

    /** `Gtk.Frame:label` — the frame's label text, or null when it carries no label. */
    get label(): string | null {
        return this.getAttribute('label');
    }

    set label(value: string | null) {
        if (value === null) this.removeAttribute('label');
        else this.setAttribute('label', value);
    }

    /**
     * `Gtk.Frame:label-xalign` — where the label sits across the frame's width.
     * `0` (the pspec default) puts it at the start, `1` at the end, `0.5` centred.
     */
    get labelXalign(): number {
        return normalizeLabelXalign(this.getAttribute('label-xalign'));
    }

    set labelXalign(value: number) {
        this.setAttribute('label-xalign', String(value));
    }

    /** The child in GTK's `label-widget` slot — the widget drawn in place of the text. */
    get labelWidget(): HTMLElement | null {
        const named = this.querySelector<HTMLElement>('[slot="label-widget"]');
        if (named !== null) return named;
        // A label that has been unparented is not this frame's label any more, and GTK's
        // getter reads the SLOT (gtkframe.c:412-420) rather than the string it came from.
        return this._labelEl?.parentNode === this ? this._labelEl : null;
    }

    set labelWidget(value: HTMLElement | null) {
        const current = this.querySelector('[slot="label-widget"]');
        if (current !== null) {
            current.removeAttribute('slot');
            // `gtk_frame_set_label_widget` UNPARENTS whatever it replaces (gtkframe.c:424-437).
            current.remove();
        }
        if (value === null) return;
        value.setAttribute('slot', 'label-widget');
        // FIRST, because GTK stacks the label above the child (gtkframe.c:558-563).
        this.prepend(value);
        this._sync();
    }

    connectedCallback() {
        // The two NAMES, so an authored tree may address them; nothing is ROUTED, because
        // the label is GTK's FIRST child either way and the child is everything else. The
        // string label is built here and cannot arrive through a slot.
        bindSlottedChildren(this, [
            { name: 'child', into: this },
            { name: 'label-widget', into: this },
        ]);
        // The label is an ELEMENT the element owns, and an author who replaces the frame's
        // children — `frame.innerHTML = …`, which is how a renderer re-renders a subtree —
        // takes it with them. One observer puts it back, the same "evaluated once at connect
        // time" repair `<adw-clamp>` makes for its children's widths.
        this._mutations = new MutationObserver(() => this._sync());
        this._mutations.observe(this, { childList: true });
        this.setAttribute('role', 'group');
        this._sync();
    }

    disconnectedCallback() {
        this._mutations?.disconnect();
        this._mutations = null;
    }

    attributeChangedCallback(name: string, old: string | null, value: string | null) {
        this._sync();
        if (!this.isConnected) return;
        const next = name === 'label-xalign' ? String(normalizeLabelXalign(value)) : value;
        const before = name === 'label-xalign' ? String(normalizeLabelXalign(old)) : old;
        if (next === before) return;
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: next } }));
    }

    private _sync(): void {
        // An authored `label-widget` and the string are mutually exclusive in GTK: the last
        // setter unparents the other (gtkframe.c:424-444). Markup states both at once, so
        // the widget wins and the string is the fallback — stated here because the reverse
        // would silently drop an author's child.
        const authored = this.querySelector<HTMLElement>('[slot="label-widget"]');
        const wanted = this.getAttribute('label');
        if (authored === null && wanted !== null) {
            if (this._labelEl === null) {
                this._labelEl = document.createElement('gtk-label');
                // The label WIDGET is the frame's own, built from the `label` STRING, and GTK
                // notifies on the FRAME alone (gtkframe.c:519-537) — there is no label widget
                // an author reaches through `gtk_frame_set_label()`. Its own `notify::label`
                // bubbles by default, so a listener on the frame saw the same change twice:
                // once from the child and once from the frame. Suppressed ONLY for a write
                // this method made, so a listener on the label widget itself still hears an
                // author who sets `label` on it directly.
                this._labelEl.addEventListener('notify::label', (event) => {
                    if (this._writingLabel) event.stopPropagation();
                });
            }
            this._writingLabel = true;
            this._labelEl.setAttribute('label', wanted);
            this._writingLabel = false;
            // FIRST, because GTK stacks the label above the child (gtkframe.c:558-563).
            if (this._labelEl.parentNode !== this) this.prepend(this._labelEl);
        } else if (this._labelEl?.parentNode === this) {
            this._labelEl.remove();
        }

        const label = this.labelWidget;
        // `flex: none` and the 4px inset are the widget's own, in `_frame.scss`; only the
        // placement is per-instance, so it is the only thing written here.
        if (label === null) return;
        label.classList.add('adw-frame-label');
        label.style.alignSelf = labelYalignAlignItems(this.labelXalign);
    }
}

customElements.define('gtk-frame', GtkFrame);
