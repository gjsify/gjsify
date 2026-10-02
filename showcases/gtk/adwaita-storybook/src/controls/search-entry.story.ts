// Gtk.SearchEntry — the query field, its clear button and its delayed search-changed.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { searchEntryMeta } from './search-entry.meta.js';

/** Story: a Gtk.SearchEntry with its placeholder, its search delay and the last signal it emitted. */
export class SearchEntryStory extends StoryWidget {
    private _entry: Gtk.SearchEntry | null = null;
    private _label: Gtk.Label | null = null;
    private _handler = 0;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookSearchEntry' }, SearchEntryStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(SearchEntryStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...searchEntryMeta, component: Gtk.SearchEntry.$gtype };
    }

    initialize(): void {
        this._entry = new Gtk.SearchEntry({ widthRequest: 260, halign: Gtk.Align.CENTER });
        this._label = new Gtk.Label({ label: 'search-changed has not fired yet' });
        // The signal is the reason the widget exists, so the story shows that it fires —
        // and at what delay, which is the control above it.
        this._handler = this._entry.connect('search-changed', () => {
            if (this._label) this._label.label = `search-changed: "${this._entry?.text ?? ''}"`;
        });
        this._apply();
        this.addContent(this._entry, this._label);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._entry) return;
        this._entry.search_delay = this.args.searchDelay as number;
        this._entry.placeholder_text = this.args.placeholderText as string;
        // `sensitive`, not `editable`, for the same reason the Password Entry story gives.
        this._entry.sensitive = !(this.args.disabled as boolean);
    }
}

GObject.type_ensure(SearchEntryStory.$gtype);

export const SearchEntryStories: StoryModule = { stories: [SearchEntryStory] };
