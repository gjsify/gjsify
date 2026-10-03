// Gtk.LevelBar — a level over a real interval, continuous or in blocks.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { levelBarMeta } from './level-bar.meta.js';

/** Story: a Gtk.LevelBar with interval, mode, orientation and `inverted` bound to args. */
export class LevelBarStory extends StoryWidget {
    private _box: Gtk.Box | null = null;
    private _bar: Gtk.LevelBar | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookLevelBar' }, LevelBarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(LevelBarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...levelBarMeta, component: Gtk.LevelBar.$gtype };
    }

    initialize(): void {
        this._bar = new Gtk.LevelBar();
        // A horizontal bar has no intrinsic width of its own, so the story gives it one;
        // the vertical one needs a HEIGHT instead, and the box is what decides which.
        this._box = new Gtk.Box({ halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER });
        this._box.append(this._bar);
        this._apply();
        this.addContent(this._box);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bar) return;
        const vertical = this.args.orientation === 'vertical';
        this._bar.orientation = vertical ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL;
        this._bar.widthRequest = vertical ? 0 : 200;
        this._bar.heightRequest = vertical ? 120 : 0;
        // The ORDER is the C's: a new `max-value` drags `value` down and clamps every
        // offset into the new interval (gtklevelbar.c:1229-1234), so `value` goes second.
        this._bar.max_value = this.args.maxValue as number;
        this._bar.mode =
            (this.args.mode as string) === 'discrete' ? Gtk.LevelBarMode.DISCRETE : Gtk.LevelBarMode.CONTINUOUS;
        this._bar.value = this.args.value as number;
        this._bar.inverted = this.args.inverted as boolean;
    }
}

GObject.type_ensure(LevelBarStory.$gtype);

export const LevelBarStories: StoryModule = { stories: [LevelBarStory] };
