// Gtk.ScaleButton — a button whose press opens a scale.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { scaleButtonMeta } from './scale-button.meta.js';
import { SCALE_BUTTON_ICONS } from './scale-button.meta.js';

/** Story: a Gtk.ScaleButton whose icon follows its value, with the axis and the frame bound. */
export class ScaleButtonStory extends StoryWidget {
    private _button: Gtk.ScaleButton | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookScaleButton' }, ScaleButtonStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ScaleButtonStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...scaleButtonMeta, component: Gtk.ScaleButton.$gtype };
    }

    initialize(): void {
        this._button = new Gtk.ScaleButton({ halign: Gtk.Align.CENTER });
        this._button.icons = SCALE_BUTTON_ICONS;
        this._apply();
        this.addContent(this._button);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._button) return;
        // Orientation before the value: moving the axis does not move the value, and
        // `gtk_scale_button_set_value()` clamps into the adjustment either way.
        this._button.orientation =
            (this.args.orientation as string) === 'horizontal' ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL;
        this._button.hasFrame = this.args.hasFrame as boolean;
        this._button.value = this.args.value as number;
    }
}

GObject.type_ensure(ScaleButtonStory.$gtype);

export const ScaleButtonStories: StoryModule = { stories: [ScaleButtonStory] };
