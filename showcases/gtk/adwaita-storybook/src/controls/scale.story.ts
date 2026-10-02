// Gtk.Scale — the slider, with its adjustment, its value text and the properties that
// shape both.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { scaleMeta } from './scale.meta.js';

/** Story: a Gtk.Scale over 0…100, with the value text, the digits and the origin bound to args. */
export class ScaleStory extends StoryWidget {
    private _scale: Gtk.Scale | null = null;
    private _adjustment: Gtk.Adjustment | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookScale' }, ScaleStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ScaleStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...scaleMeta, component: Gtk.Scale.$gtype };
    }

    initialize(): void {
        this._adjustment = new Gtk.Adjustment({ value: 40, lower: 0, upper: 100, stepIncrement: 1, pageIncrement: 10 });
        this._scale = new Gtk.Scale({
            adjustment: this._adjustment,
            digits: 0,
            drawValue: true,
            widthRequest: 260,
            valign: Gtk.Align.CENTER,
        });
        this._apply();
        this.addContent(this._scale);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._scale || !this._adjustment) return;
        this._scale.orientation =
            this.args.orientation === 'vertical' ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL;
        // `Gtk.PositionType` is an enum, so the nick the meta offers is translated here.
        const positions: Record<string, Gtk.PositionType> = {
            top: Gtk.PositionType.TOP,
            bottom: Gtk.PositionType.BOTTOM,
            left: Gtk.PositionType.LEFT,
            right: Gtk.PositionType.RIGHT,
        };
        this._scale.value_pos = positions[this.args.valuePos as string] ?? Gtk.PositionType.TOP;
        this._scale.draw_value = this.args.drawValue as boolean;
        this._scale.digits = this.args.digits as number;
        this._scale.inverted = this.args.inverted as boolean;
        this._scale.has_origin = this.args.hasOrigin as boolean;
        this._adjustment.set_value(this.args.value as number);
    }
}

GObject.type_ensure(ScaleStory.$gtype);

export const ScaleStories: StoryModule = { stories: [ScaleStory] };
