// Gtk.CenterBox — three widgets pinned start, centre, end.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { centerBoxMeta } from './center-box.meta.js';

/** `Gtk.BaselinePosition`'s three members, by the nick the shared meta carries. */
const BASELINE_POSITIONS: Record<string, Gtk.BaselinePosition> = {
    top: Gtk.BaselinePosition.TOP,
    center: Gtk.BaselinePosition.CENTER,
    bottom: Gtk.BaselinePosition.BOTTOM,
};

/** Story: a Gtk.CenterBox whose three slots are filled and whose two properties bind args. */
export class CenterBoxStory extends StoryWidget {
    private _box: Gtk.CenterBox | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookCenterBox' }, CenterBoxStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(CenterBoxStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...centerBoxMeta, component: Gtk.CenterBox.$gtype };
    }

    initialize(): void {
        this._box = new Gtk.CenterBox({ margin_top: 12, margin_bottom: 12, margin_start: 12, margin_end: 12 });
        this._box.set_start_widget(new Gtk.Label({ label: 'Start', hexpand: false }));
        this._box.set_center_widget(new Gtk.Label({ label: 'Centre', hexpand: true }));
        this._box.set_end_widget(new Gtk.Label({ label: 'End', hexpand: false }));
        this._apply();
        this.addContent(this._box);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._box) return;
        this._box.shrinkCenterLast = this.args.shrinkCenterLast as boolean;
        this._box.baselinePosition = BASELINE_POSITIONS[this.args.baselinePosition as string];
    }
}

GObject.type_ensure(CenterBoxStory.$gtype);

export const CenterBoxStories: StoryModule = { stories: [CenterBoxStory] };
