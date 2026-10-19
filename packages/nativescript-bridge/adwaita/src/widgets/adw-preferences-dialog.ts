// AdwPreferencesDialog — a Libadwaita-style preferences dialog for NativeScript.
//
// An `AdwDialog`, as `AdwPreferencesDialog` is one in libadwaita: the scrim, the card,
// `present (parent)`, `close` / `force_close`, `can-close`, `content-width` /
// `content-height` and `presentation-mode` are the base class's. What this adds is the
// dialog's own child — a titled header with a close button over a body that hosts
// `AdwPreferencesPage`s — and `add(page)`. Mirrors `Adw.PreferencesDialog`: `add(page)`,
// `present()` / `close()`, `title`. `content-width` starts at 640, as the class template
// (adw-preferences-dialog.ui) sets it.
//
// FIDELITY: approximated. COMPROMISES: no backdrop blur / drop shadow / slide-in animation
// (CSS subset has none), and no view switcher: libadwaita shows one page at a time, this
// body gives every page a share of the height. Each page scrolls itself, so the body is a
// grid with a star row per page — a vertical stack would offer a page unbounded height and
// the page would never scroll.
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
import { GridLayout, ItemSpec, Label } from '@nativescript/core';
import { windowCloseSymbolic } from '@gjsify/adwaita-icons/ui';
import type { SearchPreferencesOptions } from '@gjsify/adwaita-core';
import { AdwDialog, ADW_DIALOG_CLOSED } from './adw-dialog.js';
import { AdwImageButton } from './adw-image-button.js';
import { searchNsPreferences, type NsPreferencesSearchResult, type NsSearchablePage } from './preferences-search.js';
import { xmlBoolean } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

/** Event name emitted when the dialog is closed. */
export const CLOSED = ADW_DIALOG_CLOSED;

/** `content-width` of the class template, adw-preferences-dialog.ui. */
const PREFERENCES_DIALOG_CONTENT_WIDTH = 640;

export class AdwPreferencesDialog extends AdwDialog {
    static override readonly GTypeName: string = 'AdwPreferencesDialog';

    protected readonly _headerBox: GridLayout;
    protected readonly _titleLabel: Label;
    protected readonly _body: GridLayout;

    constructor(props?: ConstructProps<AdwPreferencesDialog>) {
        super();
        this._card.className = 'adw-preferences-dialog-card';

        // The dialog's child: rows `auto, *` — a header bar and the page body.
        const content = new GridLayout();
        content.addColumn(new ItemSpec(1, 'star'));
        content.addRow(new ItemSpec(1, 'auto'));
        content.addRow(new ItemSpec(1, 'star'));

        // Header: title (col 0) + close button (col 1).
        const header = new GridLayout();
        header.className = 'adw-preferences-dialog-header';
        header.addColumn(new ItemSpec(1, 'star'));
        header.addColumn(new ItemSpec(1, 'auto'));
        header.addRow(new ItemSpec(1, 'auto'));
        GridLayout.setRow(header, 0);
        content.addChild(header);
        this._headerBox = header;

        const titleLabel = new Label();
        titleLabel.className = 'adw-preferences-dialog-title';
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

        const body = new GridLayout();
        body.className = 'adw-preferences-dialog-body';
        body.addColumn(new ItemSpec(1, 'star'));
        GridLayout.setRow(body, 1);
        content.addChild(body);
        this._body = body;

        this.child = content;
        this.title = 'Preferences';
        this.contentWidth = PREFERENCES_DIALOG_CONTENT_WIDTH;
        applyConstructProps(this, props);
    }

    protected override get _ownClass(): string {
        return 'adw-preferences-dialog';
    }

    /** `AdwDialog:title`, shown in the header. */
    override get title(): string {
        return super.title;
    }

    override set title(value: string | null) {
        super.title = value;
        this._titleLabel.text = super.title;
    }

    /** Add an `AdwPreferencesPage` (or any view) to the dialog body. */
    add(view: View): void {
        this._body.addChild(view);
        this._layoutBody();
    }

    /**
     * An XML child is a page in the dialog BODY, not the dialog's `child` — which is
     * where `AdwDialog`'s inherited `_addChildFromBuilder` would have put it, in place of
     * the header and the body.
     */
    override _addChildFromBuilder(_name: string, view: View): void {
        this.add(view);
    }

    /** Remove a previously-added page from the body. */
    remove(view: View): void {
        this._body.removeChild(view);
        this._layoutBody();
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

    /** Whether the dialog is currently shown; writing it presents or closes. */
    override get open(): boolean {
        return super.open;
    }

    set open(value: boolean | string) {
        if (xmlBoolean(value, false)) this.present();
        else this.close();
    }

    /** The body that hosts the preferences pages. */
    get body(): GridLayout {
        return this._body;
    }

    /** One star row per page, in add order. */
    private _layoutBody(): void {
        const body = this._body;
        body.removeRows();
        const count = body.getChildrenCount();
        for (let index = 0; index < count; index++) {
            body.addRow(new ItemSpec(1, 'star'));
            GridLayout.setRow(body.getChildAt(index), index);
        }
    }
}
