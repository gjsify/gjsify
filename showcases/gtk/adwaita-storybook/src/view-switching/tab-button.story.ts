// Adw.TabButton — the page counter for an Adw.TabView.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { tabButtonMeta } from './tab-button.meta.js';

/** Story: an Adw.TabButton bound to a view whose page count the control sets. */
export class TabButtonStory extends StoryWidget {
    private _view: Adw.TabView | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookTabButton' }, TabButtonStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(TabButtonStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...tabButtonMeta, component: Adw.TabButton.$gtype };
    }

    initialize(): void {
        // The view is the counter's data source and is never shown.
        this._view = new Adw.TabView();
        const button = new Adw.TabButton({ view: this._view, halign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(button);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        const view = this._view;
        if (!view) return;
        const wanted = this.args.pages as number;
        while (view.nPages < wanted) view.append(new Gtk.Box()).title = `Page ${view.nPages}`;
        while (view.nPages > wanted) view.close_page(view.get_nth_page(view.nPages - 1));
        for (let i = 0; i < view.nPages; i++) {
            view.get_nth_page(i).needsAttention = (this.args.needsAttention as boolean) && i === view.nPages - 1;
        }
    }
}

GObject.type_ensure(TabButtonStory.$gtype);

export const TabButtonStories: StoryModule = { stories: [TabButtonStory] };
