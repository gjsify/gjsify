// <gtk-spinner> — GTK's icon-size busy indicator: a faint ring with a bright QUARTER
// arc turning around it. It is not `<adw-spinner>`, which breathes a variable-length
// arc from `@gjsify/adwaita-core`'s `spinnerArc`; this is the older GTK picture and it
// is the one `Gtk.Spinner` draws.
//
// THE PICTURE, FROM THE ICON GTK LOADS. `ensure_paintable` picks
// `/org/gtk/libgtk/icons/process-working.gpa` and asks the SVG loader to play it
// (gtkspinner.c:158-171). That file is a full circle stroked at `stroke-opacity 0.2`
// plus one 90° arc from (1,8) to (8,1) on a radius-7 circle centred at (8,8) — a
// quarter arc, exactly as the header claims. Both are drawn here with `currentColor`,
// the track at 20% opacity, which is what the icon's `url(#gpa:foreground)` resolves
// to inside a widget.
//
// `:checked` IS THE SPINNING STATE. GTK puts the `:checked` pseudoclass on the node
// while `spinning` is set (gtkspinner.c:59-63, `update_state_flags` :99-108), so
// libadwaita can paint the two apart. In a browser the element is its own node and the
// `spinning` ATTRIBUTE is the state, so `[spinning]` selects the same rule `:checked`
// would.
//
// UNDER REDUCED MOTION GTK SWAPS THE ICON, and so does this. `ensure_paintable` reads
// `gtk-interface-reduced-motion` and loads `sand-watch.svg` — a STATIC hourglass —
// instead of the rotating arc (gtkspinner.c:145-161). The browser has no icon loader,
// so the equivalent is a rule that holds the arc still. This is deliberately the
// opposite of `<adw-spinner>`, which keeps turning on purpose
// (`adw-spinner-paintable.c:537`).
//
// `start()` / `stop()` ARE NOT ALIASES FOR THE PROPERTY ALONE. Both also set
// `GTK_ACCESSIBLE_STATE_BUSY` (gtkspinner.c:373-383, :391-400), so `aria-busy` rides
// on the same call — the `spinning` property is what the `:checked` class is built on,
// `aria-busy` is what a screen reader is told.
//
// SIZE IS CSS, not a property. `GtkSpinner` has exactly one property, `spinning`; the
// size comes from the `icon-size` CSS property, measured as minimum AND natural
// (gtkspinner.c:110-123), so the element carries an icon-size default box and lets a
// rule size it.
//
// A11Y: `role="progressbar"` — GtkSpinner's declared role (gtkspinner.c:345) — with no
// value range, because there is no fraction to report.
//
// Reference: refs/gtk/gtk/gtkspinner.c
// Reference: refs/gtk/gtk/icons/process-working-symbolic.svg
// Reference: refs/gtk/gtk/icons/sand-watch.svg
// Reference: refs/libadwaita/src/stylesheet/widgets/_spinner.scss:1-3 (the disabled rule)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The radius-7 ring `process-working-symbolic.svg` traces through (1,8)…(15,8). */
const RADIUS = 7;

export class GtkSpinner extends HTMLElement {
    private _initialized = false;

    static get observedAttributes() {
        return ['spinning', 'disabled'];
    }

    /** `Gtk.Spinner:spinning` — whether the animation runs. Defaults to FALSE (:338-340). */
    get spinning(): boolean {
        return this.hasAttribute('spinning');
    }

    set spinning(v: boolean) {
        this.toggleAttribute('spinning', !!v);
    }

    /** `gtk_spinner_start` (gtkspinner.c:373-383): spin, and announce the busy state. */
    start(): void {
        this.spinning = true;
        this.setAttribute('aria-busy', 'true');
    }

    /** `gtk_spinner_stop` (gtkspinner.c:391-400). */
    stop(): void {
        this.spinning = false;
        this.setAttribute('aria-busy', 'false');
    }

    connectedCallback() {
        if (this._initialized) {
            this._render();
            return;
        }
        this._initialized = true;

        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('class', 'adw-spinner-ring');

        const track = document.createElementNS(SVG_NS, 'circle');
        track.setAttribute('cx', '8');
        track.setAttribute('cy', '8');
        track.setAttribute('r', String(RADIUS));
        track.setAttribute('class', 'adw-spinner-track');

        // The 180°→270° quarter of the same circle, as an arc: from (1,8) up to (8,1).
        const arc = document.createElementNS(SVG_NS, 'path');
        arc.setAttribute('d', `M ${8 - RADIUS} 8 A ${RADIUS} ${RADIUS} 0 0 1 8 ${8 - RADIUS}`);
        arc.setAttribute('class', 'adw-spinner-arc');

        svg.append(track, arc);
        this.replaceChildren(svg);

        this.setAttribute('role', 'progressbar');
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        this._render();
        if (name === 'spinning') {
            this.dispatchEvent(
                new CustomEvent('notify::spinning', { bubbles: true, detail: { spinning: this.spinning } }),
            );
        }
    }

    private _render(): void {
        // `update_state_flags` (gtkspinner.c:99-108) — the `:checked` pseudoclass, which
        // libadwaita and this package's own stylesheet both spell `.checked`.
        this.classList.toggle('checked', this.spinning);
    }
}

customElements.define('gtk-spinner', GtkSpinner);
