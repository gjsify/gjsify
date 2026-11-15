// GtkSearchEntry — a field for typing a query, for NativeScript: a magnifying glass while it
// is empty, a clear button once it is not, and a `search-changed` signal that waits until the
// user STOPS typing.
//
// It EXTENDS `GtkEntry` (C's `GtkSearchEntry` is a sibling implementing `GtkEditable`; the
// browser element extends `<gtk-entry>` for the same reason this one does: `GtkEntry` owns the
// field and the declared properties).
//
// MEASURED ON GTK 4.22: css-classes `search`, css name `entry`; `search-delay` defaults to 150
// and notifies only when it changes; `set_text ('a')` emits `changed`, `notify::text`, and
// `search-changed` once the delay has elapsed; `set_text ('')` emits `changed`, then
// `search-changed` IMMEDIATELY, then `notify::text` — an empty query is not a filter, and
// waiting would make the results flash (gtksearchentry.c:785-792). Each non-empty change
// REPLACES the queue (`reset_timeout`, :765-774). Writing `search-delay` does not touch a
// timer that is already running.
//
// DIFFERENCES: `stop-search`, `next-match`, `previous-match` and `search-started` are declared
// so a handler connects, but nothing emits them — they are the hardware keyboard's Escape,
// Ctrl+G and type-to-search, which a phone form has no use for. `key-capture-widget` is left
// out with them. The clear button is an `AdwImageButton`, the one tap target the port has.
//
// Reference: refs/gtk gtk/gtksearchentry.c (GtkSearchEntry)
// Reference: web/adwaita-web/src/elements/gtk-search-entry.ts
// Copyright (c) The GTK Team. LGPLv2.1+.

import { GridLayout, ItemSpec } from '@nativescript/core';
import { editClearSymbolic, editFindSymbolic } from '@gjsify/adwaita-icons/actions';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { AdwImageButton } from './adw-image-button.js';
import { GtkEntry, CHANGED } from './gtk-entry.js';
import { GtkImage } from './gtk-image.js';
import { withProperties } from './signals.js';

/** `Gtk.SearchEntry::search-changed`, `::stop-search`, `::next-match`, `::previous-match`. */
export const SEARCH_CHANGED = 'search-changed';

export class GtkSearchEntry extends withProperties(GtkEntry, {
    GTypeName: 'GtkSearchEntry',
    Properties: {
        'search-delay': {
            kind: 'uint',
            default: 150,
            blurb: 'The delay in milliseconds from last keypress to the search-changed signal',
        },
    },
    Signals: {
        'search-changed': {},
        'stop-search': {},
        'next-match': {},
        'previous-match': {},
    },
}) {
    static readonly GTypeName: string = 'GtkSearchEntry';

    /** `Gtk.SearchEntry:search-delay` — milliseconds from the last change to `search-changed`. */
    declare searchDelay: number;

    private readonly _clearButton: AdwImageButton;
    private _timer: ReturnType<typeof setTimeout> | null = null;

    constructor(props?: ConstructProps<GtkSearchEntry>) {
        super();

        // `search` is the css class GTK gives the entry; a plain `GridLayout` base has no
        // class list, so it joins the one className.
        this.className = 'adw-entry adw-search-entry search';

        // The base built one star column around the field; the icons need a column each side.
        this.removeColumns();
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addColumn(new ItemSpec(1, 'star'));
        this.addColumn(new ItemSpec(1, 'auto'));
        GridLayout.setColumn(this._field, 1);

        const finder = new GtkImage();
        finder.className = 'gtk-image adw-search-entry-icon';
        finder.iconName = editFindSymbolic;
        GridLayout.setColumn(finder, 0);
        this.addChild(finder);

        const clear = new AdwImageButton();
        clear.className = `${clear.className} adw-search-entry-clear`.trim();
        clear.iconName = editClearSymbolic;
        clear.visibility = 'collapse';
        clear.addEventListener('tap', () => {
            this.text = '';
        });
        GridLayout.setColumn(clear, 2);
        this.addChild(clear);
        this._clearButton = clear;

        this.connect(CHANGED, () => this._onChanged());
        // A pending query must not fire into a widget that is gone.
        this.addEventListener('unloaded', () => this._cancel());

        applyConstructProps(this, props);
    }

    /** `gtk_search_entry_new`. */
    static new_(): GtkSearchEntry {
        return new GtkSearchEntry();
    }

    /** `gtk_search_entry_get_search_delay`. */
    get_search_delay(): number {
        return this.searchDelay;
    }

    /** `gtk_search_entry_set_search_delay`. */
    set_search_delay(delay: number): void {
        this.searchDelay = delay;
    }

    private _cancel(): void {
        if (this._timer === null) return;
        clearTimeout(this._timer);
        this._timer = null;
    }

    /** `gtk_search_entry_changed`: empty goes out at once, anything else waits and replaces the queue. */
    private _onChanged(): void {
        const empty = this.text === '';
        this._clearButton.visibility = empty ? 'collapse' : 'visible';
        this._cancel();
        if (empty) {
            this.emit(SEARCH_CHANGED);
            return;
        }
        this._timer = setTimeout(() => {
            this._timer = null;
            this.emit(SEARCH_CHANGED);
        }, this.searchDelay);
    }
}
