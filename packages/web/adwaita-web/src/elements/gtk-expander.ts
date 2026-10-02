// <gtk-expander> — a title the user clicks to reveal or hide the child below it.
//
// The CSS node tree is the specification, and it is a five-node one (gtkexpander.c:95-109):
//
//   expander-widget
//   ╰── box
//       ├── title
//       │   ├── expander          the disclosure arrow
//       │   ╰── <label widget>
//       ╰── <child>
//
// so the element builds a box with a title row above a content row, exactly as
// `gtk_expander_init` does (gtkexpander.c:413-423), and the arrow is its OWN node carrying
// `:checked` when the child is showing — "The arrow of an expander that is showing its child
// gets the `:checked` pseudoclass set on it", which `gtk_expander_set_expanded` does in both
// directions (gtkexpander.c:897-900). Here the pseudoclass is the `.checked` class the rest
// of this stylesheet already stands in for it with, and `_expander.scss` swaps the glyph.
//
// FIVE attributes:
//
//   expanded        the disclosure itself. `toggleAttribute` is idempotent, so "notify only
//                   on a real change" needs no guard — and `gtk_expander_set_expanded`
//                   returns early when nothing changed (gtkexpander.c:892-894), which is the
//                   same statement.
//   label           TEXT, and GTK makes a real `GtkLabel` out of it
//                   (gtkexpander.c:974-979), with `use-underline` and `use-markup` forwarded
//                   to it. So `label` becomes a `<gtk-label>` carrying the same two, and
//                   `labelDisplayText` — the one derivation this package already shares with
//                   the NativeScript port — is what reduces markup and mnemonic markers, as
//                   `<gtk-label>` does for itself.
//   use-markup      forwarded to the label.
//   use-underline   forwarded to the label, AND it is what makes `Alt`+the marked character
//                   activate the expander — `gtk_expander_new_with_mnemonic`'s documented
//                   contract (gtkexpander.c:856-860) and `update_accessible_mnemonic`
//                   (:811-831), which also publishes `Alt+X` as the widget's KEY_SHORTCUTS.
//   resize-toplevel whether to ask the window to grow with the disclosure. Observed and
//                   reflected to a `.resize-toplevel` class, because
//                   `gtk_expander_resize_toplevel` (gtkexpander.c:737-750) can only call
//                   `gtk_widget_queue_resize` on a `GtkWindow` — a browser document already
//                   reflows itself around a box that changed height, so the flag is the whole
//                   of what this side can act on.
//
// `label-widget` is a SLOT rather than an attribute: it is `GTK_TYPE_WIDGET`
// (gtkexpander.c:351-353), and a string cannot carry one. `label` and a `slot="label"` child
// are mutually exclusive — `gtk_expander_set_label` NULLS the label widget
// (gtkexpander.c:969-970) and `set_label_widget` takes it (:1099-1142) — and GTK's precedence
// is the one kept here: the widget wins.
//
// The 500ms `expand_timer` drag-hover auto-expansion (gtkexpander.c:136, :240-257) is NOT
// ported, and it is a gesture rather than a property, so there is no KNOWN_GAPS entry for
// it: it hangs off a `GtkDropControllerMotion` reacting to a drag passing over the expander,
// and a browser has no drag-over-a-widget event to put a timer on. `pointerenter` is not
// that gesture, and pretending it is would expand on a hover the C never honours.
//
// A11Y: GTK gives the widget `GTK_ACCESSIBLE_ROLE_BUTTON` (gtkexpander.c:393) and keeps
// `GTK_ACCESSIBLE_STATE_EXPANDED` on it in step with the flag (:927-929). The role, the
// `aria-expanded` state and the Tab stop go on the TITLE rather than on the host, because
// the title is what the pointer presses and what `gtk_expander_focus` cycles through as its
// own site; `<adw-expander-row>` took the same decision for its header. `aria-controls`
// names the content row, which is GTK's `GTK_ACCESSIBLE_RELATION_CONTROLS` set when the
// child is parented and reset when it is unparented (gtkexpander.c:913-921, :1236-1244).
//
// Reference: refs/gtk/gtk/gtkexpander.c (every property, the node tree, activate, focus)
// Reference: refs/libadwaita/src/stylesheet/widgets/_expanders.scss
// Copyright (c) The GTK Team. LGPLv2.1+.
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { labelDisplayText } from '@gjsify/adwaita-core';

import { bindEmptySections } from '../empty-sections.js';
import { bindSlottedChildren } from '../slotted-children.js';
import { createGtkImage } from './gtk-image.js';
import { attachRowActivation } from './row-activation.js';

// SIDE-EFFECT import, deliberately separate from the type import below — see the same note
// in `adw-expander-row.ts`: `import { GtkLabel }` used only in type position would be
// elided by TypeScript and take the `customElements.define` with it.
import './gtk-label.js';
import type { GtkLabel } from './gtk-label.js';

/** `expander { -gtk-icon-source: -gtk-icontheme('pan-end-symbolic') }` (_expanders.scss). */
const ARROW_ICON = 'pan-end';

/** Stable ids for the `aria-controls` relation, which GTK sets on the child itself. */
let labelChildCounter = 0;

export class GtkExpander extends HTMLElement {
    private _box!: HTMLDivElement;
    private _titleEl!: HTMLDivElement;
    private _arrowEl!: HTMLElement;
    private _labelEl!: GtkLabel;
    private _labelSection!: HTMLDivElement;
    private _contentEl!: HTMLDivElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['expanded', 'label', 'use-markup', 'use-underline', 'resize-toplevel'];
    }

    /** `Gtk.Expander:expanded` — whether the child is revealed. */
    get expanded(): boolean {
        return this.hasAttribute('expanded');
    }

    set expanded(value: boolean) {
        this.toggleAttribute('expanded', !!value);
    }

    /** `Gtk.Expander:label` — the title TEXT, or `null` when a label widget is in its place. */
    get label(): string | null {
        return this.labelWidget === null ? this.getAttribute('label') : null;
    }

    set label(value: string | null) {
        if (value === null) this.removeAttribute('label');
        else this.setAttribute('label', value);
    }

    /** `Gtk.Expander:use-markup` — whether the label is Pango markup. */
    get useMarkup(): boolean {
        return this.hasAttribute('use-markup');
    }

    set useMarkup(value: boolean) {
        this.toggleAttribute('use-markup', !!value);
    }

    /** `Gtk.Expander:use-underline` — whether `_` in the label marks a mnemonic. */
    get useUnderline(): boolean {
        return this.hasAttribute('use-underline');
    }

    set useUnderline(value: boolean) {
        this.toggleAttribute('use-underline', !!value);
    }

    /** `Gtk.Expander:resize-toplevel` — reflected, because a document reflows itself. */
    get resizeToplevel(): boolean {
        return this.hasAttribute('resize-toplevel');
    }

    set resizeToplevel(value: boolean) {
        this.toggleAttribute('resize-toplevel', !!value);
    }

    /** `Gtk.Expander:child` — the light-DOM node in the content row. */
    get child(): Element | null {
        return this._contentEl?.firstElementChild ?? null;
    }

    /** `Gtk.Expander:label-widget` — the light-DOM node standing in for the label text. */
    get labelWidget(): Element | null {
        return this._labelSection?.firstElementChild ?? null;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._arrowEl = createGtkImage(ARROW_ICON, 'adw-expander-arrow');
        this._labelEl = document.createElement('gtk-label') as GtkLabel;
        this._labelSection = document.createElement('div');
        this._labelSection.className = 'adw-expander-label';

        this._titleEl = document.createElement('div');
        this._titleEl.className = 'adw-expander-title';
        // The title is the button: GTK gives the widget the button role, and the title is
        // what its gesture (gtkexpander.c:430-439) and its focus sites act on.
        this._titleEl.setAttribute('role', 'button');
        this._titleEl.append(this._arrowEl, this._labelEl, this._labelSection);

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-expander-content';

        this._box = document.createElement('div');
        this._box.className = 'adw-expander-box';
        this._box.append(this._titleEl, this._contentEl);

        // `label-widget` is the GIR name of the slot and `label` is GtkBuildable's legacy
        // spelling for it (`gtk_expander_buildable_add_child`, gtkexpander.c:454-457), so
        // both are accepted; the bare child is the disclosed `child`.
        bindSlottedChildren(this, [
            { name: 'label-widget', into: this._labelSection },
            { name: 'label', into: this._labelSection },
            { name: 'child', into: this._contentEl },
            { into: this._contentEl },
        ]).install(this._box);

        // AFTER the routing, for the reason `adw-expander-row` gives: this derives once
        // synchronously, so a section the routing has not filled yet would be hidden by a
        // declared label that had already earned its place.
        bindEmptySections(this._labelSection);

        this._titleEl.addEventListener('click', () => this._activate());
        attachRowActivation({ row: this._titleEl, activatable: () => true });
        // `update_accessible_mnemonic` binds the FIRST marked character only
        // (gtk_label_get_mnemonic_keyval), and `Alt`+it activates the widget.
        this._titleEl.addEventListener('keydown', this._onKeyDown);

        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        this._render();
        this.dispatchEvent(
            new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: this._detail(name) } }),
        );
    }

    private _detail(name: string): unknown {
        switch (name) {
            case 'expanded':
                return this.expanded;
            case 'label':
                return this.label;
            case 'use-markup':
                return this.useMarkup;
            case 'use-underline':
                return this.useUnderline;
            default:
                return this.resizeToplevel;
        }
    }

    /** `gtk_expander_activate` (gtkexpander.c:786-792) — the one thing the widget does. */
    private _activate(): void {
        this.expanded = !this.expanded;
        this.dispatchEvent(new CustomEvent('activate', { bubbles: true, detail: { expanded: this.expanded } }));
    }

    /**
     * `Alt`+the marked character, as `gtk_expander_new_with_mnemonic` documents
     * (gtkexpander.c:856-860): "Pressing Alt and that key activates the button."
     */
    private readonly _onKeyDown = (event: KeyboardEvent): void => {
        if (!this.useUnderline || !event.altKey || event.ctrlKey || event.metaKey) return;
        const mnemonic = this._mnemonic();
        // `gdk_keyval_name (gdk_keyval_to_upper (keyval))` — the marked character, so the
        // binding is the letter and not the keycode.
        if (mnemonic === null || (event.key.length === 1 ? event.key.toUpperCase() : '') !== mnemonic) return;
        event.preventDefault();
        this._activate();
    };

    /**
     * The single character `use-underline` marks, or `null` when none does.
     *
     * The walk is `stripMnemonic`'s, for the reason that function gives: a `_` takes the
     * character after it and is itself removed, `__` is an escaped literal underscore and
     * marks nothing, and a trailing marker has no character to take.
     */
    private _mnemonic(): string | null {
        const characters = [...(this.getAttribute('label') ?? '')];
        for (let index = 0; index < characters.length; index += 1) {
            if (characters[index] !== '_') continue;
            const next = characters[index + 1];
            if (next === undefined) return null;
            index += 1;
            if (next === '_') continue;
            return next.toUpperCase();
        }
        return null;
    }

    private _render(): void {
        // `gtk_expander_set_expanded` puts the state on the ARROW node, not on the widget.
        this._arrowEl.classList.toggle('checked', this.expanded);
        this.classList.toggle('expanded', this.expanded);
        this._titleEl.setAttribute('aria-expanded', String(this.expanded));
        // The C parents the child into the box only while expanded and unparents it when
        // not (gtkexpander.c:909-923), so a collapsed expander neither lays out nor
        // allocates it.
        this._contentEl.hidden = !this.expanded;

        // GTK's precedence: `set_label` NULLS the label widget (gtkexpander.c:969-970) and
        // `set_label_widget` takes it, so the two are mutually exclusive.
        const widget = this.labelWidget;
        this._labelEl.hidden = widget !== null || this.label === null;
        if (widget === null) {
            // The very reduction `<gtk-label>` applies to its own `label`, so the two agree on
            // what the same string displays.
            this._labelEl.setAttribute('label', labelDisplayText(this.label ?? '', this.useMarkup, this.useUnderline));
            this._labelEl.toggleAttribute('use-markup', this.useMarkup);
            this._labelEl.toggleAttribute('use-underline', this.useUnderline);
        }

        const child = this.child;
        if (child === null) {
            this._titleEl.removeAttribute('aria-controls');
        } else if (this._titleEl.getAttribute('aria-controls') === null) {
            if (child.id === '') child.id = `gtk-expander-content-${labelChildCounter++}`;
            this._titleEl.setAttribute('aria-controls', child.id);
        }

        this.classList.toggle('resize-toplevel', this.resizeToplevel);
    }
}

customElements.define('gtk-expander', GtkExpander);
