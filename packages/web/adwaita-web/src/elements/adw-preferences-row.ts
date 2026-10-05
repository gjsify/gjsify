// <adw-preferences-row> — the row every boxed-list row derives from: a
// `Gtk.ListBoxRow` carrying a `title` that `Adw.PreferencesDialog` searches for
// (adw-preferences-row.c:12-23).
//
// FOUR PROPERTIES, AND EVERY ONE OF THEM IS ABOUT THE TITLE LABEL:
// `title` (Pango markup unless `use-markup` is FALSE), `use-markup`, `use-underline`
// (an embedded `_` marks a mnemonic) and `title-selectable` (the user may copy it) —
// the property docs are at adw-preferences-row.c:118-170. Inherited from `GtkWidget`,
// every row also takes `tooltip-text` (`src/row-tooltip.ts`).
//
// ONE DELIBERATE PORT DECISION, named here because C says the opposite in so many
// words: "It doesn't present the title in any way and lets you present the preference
// as you please" (adw-preferences-row.c:20). A browser element has no subclassing
// mechanism, so a base row that presented NOTHING would be an empty box — and three of
// the four properties describe a label this element would not have. It therefore
// presents the title the way every derived row does (`<adw-action-row>` renders the same
// `.adw-row-title` beside its subtitle), keeps `use-markup`/`use-underline` on it through
// the shared `labelDisplayText` reduction rather than an `innerHTML` sink, and lets a
// caller put the preference's own controls beside it through the `child` slot.
//
// MODIFICATION: `use-markup` DEFAULTS TRUE in C (adw-preferences-row.c:166-169) and an
// HTML boolean attribute cannot spell a TRUE default, so the attribute is opt-IN here —
// the arrangement `<adw-tab-view autohide>` and `<adw-navigation-page can-pop>` already
// carry, and for the same reason. What it decides is whether a title written as
// `<b>Dark</b>` Style shows the word `Dark` (markup reduced, C's default) or the literal
// text; either way the string is TEXT in the DOM, never markup.
//
// `activatable` is `GtkListBoxRow`'s, not this class's: the group's list box drives it,
// and the derived rows in this package (`<adw-action-row>`, `<adw-switch-row>`) are where
// it is implemented. So it is neither observed nor listed in KNOWN_GAPS — the property
// check reads the OWN body, and `AdwPreferencesRow` declares only the four above.
//
// A11Y: `role="listitem"`. The row IS a `GtkListBoxRow` inside the group's list, and
// `<adw-preferences-group>` sets `role="group"` on itself for exactly this reason.
//
// KNOWN_GAPS: none — all four scalar properties are observed.
//
// Reference: refs/libadwaita/src/adw-preferences-row.c (the four pspecs and their
//   defaults, `adw_preferences_row_set_title`'s NULL → "" normalisation)
// Reference: refs/libadwaita/src/adw-preferences-dialog.c (row_has_title, make_comparable)
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss (`row`, `list > row`)
// Copyright (c) 2019 Purism SPC / GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { labelDisplayText, stringIsNotEmpty } from '@gjsify/adwaita-core';

import { applyRowTooltip } from '../row-tooltip.js';
import { bindEmptySections } from '../empty-sections.js';
import { bindSlottedChildren } from '../slotted-children.js';

export class AdwPreferencesRow extends HTMLElement {
    private _titleEl!: HTMLSpanElement;
    private _contentEl!: HTMLDivElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'title-selectable', 'use-markup', 'use-underline', 'tooltip-text'];
    }

    /** `Adw.PreferencesRow:title` — Pango markup unless {@link useMarkup} is false. */
    get title(): string {
        // `adw_preferences_row_set_title` normalises NULL to the empty string
        // (adw-preferences-row.c:235), and an absent attribute is exactly that NULL.
        return this.getAttribute('title') ?? '';
    }

    set title(value: string) {
        if (value === '') this.removeAttribute('title');
        else this.setAttribute('title', value);
    }

    /** `Adw.PreferencesRow:title-selectable` — the user may copy the title. Default false. */
    get titleSelectable(): boolean {
        return this.hasAttribute('title-selectable');
    }

    set titleSelectable(value: boolean) {
        this.toggleAttribute('title-selectable', value);
    }

    /** `Adw.PreferencesRow:use-markup` — the title is Pango markup, reduced to its text. */
    get useMarkup(): boolean {
        return this.hasAttribute('use-markup');
    }

    set useMarkup(value: boolean) {
        this.toggleAttribute('use-markup', value);
    }

    /** `Adw.PreferencesRow:use-underline` — `_` marks a mnemonic. Default false. */
    get useUnderline(): boolean {
        return this.hasAttribute('use-underline');
    }

    set useUnderline(value: boolean) {
        this.toggleAttribute('use-underline', value);
    }

    /** `Adw.PreferencesRow:child` (inherited from `Gtk.ListBoxRow`) — the row's content. */
    get child(): Element | null {
        return this._contentEl?.firstElementChild ?? null;
    }

    set child(value: Element | null) {
        this._contentEl?.replaceChildren(...(value === null ? [] : [value]));
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-preferences-row-content';

        // `child` is a widget property, so a `.blp`'s `child: …` authors `slot="child"`
        // and an unnamed child is the same placement (GtkListBoxRow's own buildable).
        bindSlottedChildren(this, [{ name: 'child', into: this._contentEl }]).install(this._titleEl, this._contentEl);
        bindEmptySections(this._contentEl);

        this.setAttribute('role', 'listitem');
        this._render();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        this._render();
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: value } }));
    }

    /**
     * The title label and the copy permission.
     *
     * `labelDisplayText` reduces Pango markup to its text and strips the mnemonic marker
     * in C's order (markup first, `_` second) — the same reduction `<gtk-label>` uses, so
     * a title written once reads the same in both.
     */
    private _render(): void {
        const text = labelDisplayText(this.title, this.useMarkup, this.useUnderline);
        this._titleEl.textContent = text;
        // `string_is_not_empty`, the rule every row's label binding uses: a row with no
        // title shows no line, and `row_has_title` keeps it out of the search too.
        this._titleEl.hidden = !stringIsNotEmpty(text);
        // `Gtk.Label:selectable` puts a label in GTK_SELECTION_TEXT; the DOM's spelling
        // of "this text may be copied" is `user-select: text`.
        this._titleEl.style.userSelect = this.titleSelectable ? 'text' : '';
        applyRowTooltip(this, [this._titleEl, this._contentEl]);
    }
}

customElements.define('adw-preferences-row', AdwPreferencesRow);
