// Adw.Bin — one child, replaced rather than stacked.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { binMeta } from './bin.meta.js';

/** Story: an Adw.Bin whose child is swapped for another by `set_child`. */
export class BinStory extends StoryWidget {
    private _bin: Adw.Bin | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookBin' }, BinStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(BinStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...binMeta, component: Adw.Bin.$gtype };
    }

    initialize(): void {
        this._bin = new Adw.Bin({ widthRequest: 320 });
        this._apply();
        this.addContent(this._bin);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bin) return;
        const swap = this.args.swap as boolean;
        const label = new Gtk.Label({
            label: swap ? 'The first child was replaced, not stacked.' : (this.args.label as string),
            wrap: true,
            marginTop: 18,
            marginBottom: 18,
            marginStart: 18,
            marginEnd: 18,
        });
        const card = new Gtk.Box();
        card.add_css_class('card');
        card.append(label);
        this._bin.child = card;
    }
}

GObject.type_ensure(BinStory.$gtype);

export const BinStories: StoryModule = { stories: [BinStory] };
