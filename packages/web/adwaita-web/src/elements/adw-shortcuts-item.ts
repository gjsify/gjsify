// <adw-shortcuts-item> — one shortcut row: a title, an optional subtitle and an
// accelerator, drawn as keycaps. The browser counterpart of `AdwShortcutsItem`,
// which upstream is a plain `GObject` (adw-shortcuts-item.c:39) holding four
// strings and a text direction, and is a row rather than a widget — hence a tag
// here, the same shape `<adw-sidebar-item>` and `<adw-toggle>` are.
//
// THE ACCELERATOR IS `<adw-shortcut-label>`'s to draw. The C validates the string
// against `AdwShortcutLabel`'s own grammar (adw-shortcuts-item.c:19-24) and this
// element hands the very same attribute to the very same element, so the parse is
// core's `parseShortcutLabel` once rather than a second grammar that drifts from it.
//
// `action-name` is the OTHER half and the port has nothing to resolve it with: an
// accelerator for an action comes from `Gtk.Application.set_accels_for_action`, and a
// document has no application to ask. So it is kept as an attribute — a reader can
// still see which action a row stands for — and the accelerator beside it is what is
// DRAWN. That is the fallback the class itself documents ("If both are specified, the
// accelerator will be used if the action couldn't be found", adw-shortcuts-item.c:19-23).
//
// `direction` is honoured the way the class means it: a row for a direction the
// document is not in is hidden, which is how one dialog lists both an LTR and an RTL
// accelerator for the same action (adw-shortcuts-item.c:25-28).
//
// Attributes:
//   title        (AdwShortcutsItem:title — the row's name)
//   subtitle     (AdwShortcutsItem:subtitle — the line under it, drawn dimmed and
//     caption-sized, the `.title-box > .subtitle` rule at _shortcuts-dialog.scss:23-26)
//   accelerator  (AdwShortcutsItem:accelerator — `<Control>C`, `<Shift>A Home`; the
//     `<adw-shortcut-label>` grammar)
//   action-name  (AdwShortcutsItem:action-name — resolved on GTK, kept here)
//   direction    (AdwShortcutsItem:direction — `ltr` | `rtl` | `none`; a row for the
//     other direction is hidden)
//
// Properties: `itemType` — whether an accelerator was given, `hasAccelerator`.
//
// Reference: refs/libadwaita/src/adw-shortcuts-item.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_shortcuts-dialog.scss:16-27
// Copyright (c) 2025 GNOME Foundation Inc. (libadwaita). LGPLv2.1+
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/**
 * `AdwShortcutsItem:direction` is a `GtkTextDirection`, so it carries `none` beside the
 * two directions — and `none` is the default, meaning "show this row either way".
 *
 * NOT `AdwTextDirection` from core: that one is the split views' pair (`'ltr' | 'rtl'`,
 * split-view.ts:41), which cannot hold the value the C defaults this property to.
 */
export type AdwShortcutsItemDirection = 'ltr' | 'rtl' | 'none';

const DIRECTIONS: readonly AdwShortcutsItemDirection[] = ['ltr', 'rtl', 'none'];

export class AdwShortcutsItem extends HTMLElement {
    private _initialized = false;
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    private _labelEl!: HTMLElement;

    static get observedAttributes() {
        return ['title', 'subtitle', 'accelerator', 'action-name', 'direction'];
    }

    /** The row's title (AdwShortcutsItem:title). */
    get title(): string {
        return this.getAttribute('title') ?? '';
    }

    set title(value: string) {
        this.setAttribute('title', value);
    }

    /** The row's subtitle (AdwShortcutsItem:subtitle). */
    get subtitle(): string {
        return this.getAttribute('subtitle') ?? '';
    }

    set subtitle(value: string) {
        this.setAttribute('subtitle', value);
    }

    /** The accelerator, in `<adw-shortcut-label>`'s grammar (AdwShortcutsItem:accelerator). */
    get accelerator(): string {
        return this.getAttribute('accelerator') ?? '';
    }

    set accelerator(value: string) {
        if (value) this.setAttribute('accelerator', value);
        else this.removeAttribute('accelerator');
    }

    /** The action this row stands for; resolved by a GtkApplication on GTK. */
    get actionName(): string {
        return this.getAttribute('action-name') ?? '';
    }

    set actionName(value: string) {
        if (value) this.setAttribute('action-name', value);
        else this.removeAttribute('action-name');
    }

    /** The text direction this row belongs to (AdwShortcutsItem:direction). */
    get direction(): AdwShortcutsItemDirection {
        const value = this.getAttribute('direction') as AdwShortcutsItemDirection | null;
        return value && DIRECTIONS.includes(value) ? value : 'none';
    }

    set direction(value: AdwShortcutsItemDirection) {
        this.setAttribute('direction', value);
    }

    /** Whether a row carries an accelerator or stands for an action alone. */
    get hasAccelerator(): boolean {
        return this.accelerator.length > 0;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // `GTK_ACCESSIBLE_ROLE_LIST_ITEM` in spirit: a row in a list of shortcuts, and
        // the accelerator beside it is already `role="img"` with its own name.
        this.setAttribute('role', 'listitem');

        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-shortcuts-item-title';

        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-shortcuts-item-subtitle';

        // The keycaps: the one element that owns the accelerator grammar.
        this._labelEl = document.createElement('adw-shortcut-label');
        this._labelEl.className = 'adw-shortcuts-item-label';

        this.replaceChildren(this._titleEl, this._subtitleEl, this._labelEl);
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'direction' || name === 'accelerator' || name === 'action-name') this._render();
        else if (name === 'title') this._titleEl.textContent = this.title;
        else if (name === 'subtitle') this._renderSubtitle();
    }

    private _render(): void {
        this._titleEl.textContent = this.title;
        this._renderSubtitle();
        this._labelEl.setAttribute('accelerator', this.accelerator);

        // A row that stands for an action alone has nothing to draw on the trailing
        // side — `AdwShortcutLabel` shows its `disabled-text` placeholder for an empty
        // accelerator, which is the wrong picture for a row that never had one.
        this._labelEl.hidden = !this.hasAccelerator;

        // The class's own rule (adw-shortcuts-item.c:25-28): a direction-specific row
        // is shown only in that direction, so one dialog can carry both.
        const direction = this.direction;
        if (direction !== 'none') {
            const ours = getComputedStyle(this).direction;
            this.hidden = ours !== direction;
        } else {
            this.hidden = false;
        }
    }

    private _renderSubtitle(): void {
        const subtitle = this.subtitle;
        this._subtitleEl.textContent = subtitle;
        this._subtitleEl.hidden = subtitle.length === 0;
    }
}

customElements.define('adw-shortcuts-item', AdwShortcutsItem);
