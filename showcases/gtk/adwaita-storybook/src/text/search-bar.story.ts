// Gtk.SearchBar — the strip that reveals a search entry when search starts.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { searchBarMeta } from './search-bar.meta.js';

/** Story: a Gtk.SearchBar over a Gtk.SearchEntry, its two properties bound to args. */
export class SearchBarStory extends StoryWidget {
    private _bar: Gtk.SearchBar | null = null;
    private _entry: Gtk.SearchEntry | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookSearchBar' }, SearchBarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(SearchBarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...searchBarMeta, component: Gtk.SearchBar.$gtype };
    }

    initialize(): void {
        this._entry = new Gtk.SearchEntry({ hexpand: true });
        this._bar = new Gtk.SearchBar({ child: this._entry });
        // The entry is the bar's own child here, which is the case `connect_entry` handles
        // without a call (gtksearchbar.c:611-625).
        this._apply();
        this.addContent(this._bar);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bar) return;
        this._bar.search_mode_enabled = this.args.searchModeEnabled as boolean;
        this._bar.show_close_button = this.args.showCloseButton as boolean;
    }
}

GObject.type_ensure(SearchBarStory.$gtype);

export const SearchBarStories: StoryModule = { stories: [SearchBarStory] };
