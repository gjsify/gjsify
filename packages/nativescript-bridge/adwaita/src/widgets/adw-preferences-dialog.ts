// AdwPreferencesDialog — a Libadwaita-style preferences dialog for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` overlay holding a titled card with a
// close button over a scrollable body that hosts `AdwPreferencesPage`s. Mirrors
// `Adw.PreferencesDialog`: `add(page)`, `present()` / `close()`, `title`.
//
// FIDELITY: approximated, same model as {@link AdwAboutDialog}. This is an in-page
// modal overlay the consumer adds to their root layout and reveals on demand — NOT
// a separate OS window. COMPROMISES: no backdrop blur / drop shadow / slide-in
// animation (CSS subset has none). The titled-card-over-scrim LOOK and the
// page-hosting + present/close are faithful; an `AdwPreferencesPage` dropped in
// renders exactly as it does standalone.
//
// `search(query)` implements the dialog's headline feature — "the preferences
// are searchable by the user", the first paragraph of the C class docs. The
// pipeline (case fold, markup parse, the three corpus filters, the
// `page → group` subtitles) is `@gjsify/adwaita-core`'s, so this dialog and the
// browser one answer identically for the same tree. A search UI (the toggle
// button, the entry, the results list) is not built yet; the model is, and it is
// what a UI would bind to.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-preferences-dialog`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_preferences.scss (preferencespage/group)
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialogs.scss (AdwDialog sheet + dimming)
// Reference: refs/libadwaita/src/adw-preferences-dialog.c (add/remove, search)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { GridLayout, ItemSpec, Label, StackLayout, type EventData } from '@nativescript/core';
import { windowCloseSymbolic } from '@gjsify/adwaita-icons/ui';
import type { SearchPreferencesOptions } from '@gjsify/adwaita-core';
import { AdwImageButton } from './adw-image-button.js';
import { searchNsPreferences, type NsPreferencesSearchResult, type NsSearchablePage } from './preferences-search.js';
import { xmlBoolean } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

/** Event name emitted when the dialog is closed. */
export const CLOSED = 'closed';

export class AdwPreferencesDialog extends GridLayout {
    protected readonly _card: GridLayout;
    protected readonly _headerBox: GridLayout;
    protected readonly _titleLabel: Label;
    protected readonly _body: StackLayout;

    constructor(props?: ConstructProps<AdwPreferencesDialog>) {
        super();

        this.className = 'adw-preferences-dialog';
        this.visibility = 'collapse';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));

        // Card: rows `auto, *` — a header bar and a scroll-stack body.
        const card = new GridLayout();
        card.className = 'adw-preferences-dialog-card';
        card.verticalAlignment = 'middle';
        card.horizontalAlignment = 'center';
        card.addColumn(new ItemSpec(1, 'star'));
        card.addRow(new ItemSpec(1, 'auto'));
        card.addRow(new ItemSpec(1, 'star'));
        GridLayout.setColumn(card, 0);
        GridLayout.setRow(card, 0);
        this.addChild(card);
        this._card = card;

        // Header: title (col 0) + close button (col 1).
        const header = new GridLayout();
        header.className = 'adw-preferences-dialog-header';
        header.addColumn(new ItemSpec(1, 'star'));
        header.addColumn(new ItemSpec(1, 'auto'));
        header.addRow(new ItemSpec(1, 'auto'));
        GridLayout.setRow(header, 0);
        card.addChild(header);
        this._headerBox = header;

        const titleLabel = new Label();
        titleLabel.className = 'adw-preferences-dialog-title';
        titleLabel.text = 'Preferences';
        GridLayout.setColumn(titleLabel, 0);
        header.addChild(titleLabel);
        this._titleLabel = titleLabel;

        // Circular flat close button with a REAL window-close symbolic icon —
        // matching Adw.PreferencesDialog's header close (not a `✕` glyph).
        const closeButton = new AdwImageButton();
        closeButton.iconName = windowCloseSymbolic;
        closeButton.className = `${closeButton.className} adw-preferences-dialog-close`.trim();
        closeButton.addEventListener('tap', () => this.close());
        GridLayout.setColumn(closeButton, 1);
        header.addChild(closeButton);

        // Body: a vertical stack the consumer adds AdwPreferencesPages to.
        const body = new StackLayout();
        body.orientation = 'vertical';
        body.className = 'adw-preferences-dialog-body';
        GridLayout.setRow(body, 1);
        card.addChild(body);
        this._body = body;

        applyConstructProps(this, props);
    }

    /** The dialog title. */
    get title(): string {
        return this._titleLabel.text ?? '';
    }

    set title(value: string) {
        this._titleLabel.text = value ?? 'Preferences';
    }

    /** Add an `AdwPreferencesPage` (or any view) to the dialog body. */
    add(view: View): void {
        this._body.addChild(view);
    }

    /**
     * An XML child is a page in the dialog BODY, not a child of the grid the dialog
     * builds its header and scroller in — which is where `LayoutBase`'s inherited
     * `_addChildFromBuilder` would have put it, on top of the title bar.
     */
    _addChildFromBuilder(_name: string, view: View): void {
        this.add(view);
    }

    /** Remove a previously-added page from the body. */
    remove(view: View): void {
        this._body.removeChild(view);
    }

    /**
     * The pages this dialog searches, in add order.
     *
     * Reads the live body children, so a page added or removed after the dialog
     * was built is indexed without an invalidation step. A plain view dropped
     * into the body is not a page and contributes nothing.
     */
    get searchPages(): readonly NsSearchablePage[] {
        const pages: NsSearchablePage[] = [];
        const count = this._body.getChildrenCount();
        for (let index = 0; index < count; index++) {
            const child = this._body.getChildAt(index) as unknown as Partial<NsSearchablePage>;
            if (typeof child.searchGroups === 'function') pages.push(child as NsSearchablePage);
        }
        return pages;
    }

    /**
     * The preferences search (`filter_search_results` +
     * `create_search_row_subtitle`) over this dialog's live pages.
     *
     * An empty query returns the WHOLE corpus, which is what C does and what
     * keeps a results list populated before the user types.
     */
    search(query: string, options?: SearchPreferencesOptions): NsPreferencesSearchResult[] {
        return searchNsPreferences(this.searchPages, query, options);
    }

    /** Reveal the preferences overlay. */
    present(): void {
        this.visibility = 'visible';
    }

    /** Hide the preferences overlay and emit `closed`. */
    close(): void {
        this.visibility = 'collapse';
        const data: EventData = { eventName: CLOSED, object: this };
        this.notify(data);
    }

    /** Whether the dialog is currently shown. */
    get open(): boolean {
        return this.visibility === 'visible';
    }

    set open(value: boolean | string) {
        if (xmlBoolean(value, false)) this.present();
        else this.close();
    }

    /** The scrollable body that hosts the preferences pages. */
    get body(): StackLayout {
        return this._body;
    }
}
