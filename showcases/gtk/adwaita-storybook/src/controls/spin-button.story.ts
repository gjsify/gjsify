// Gtk.SpinButton — the number field with its two arrows.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { spinButtonMeta } from './spin-button.meta.js';

/** Story: a Gtk.SpinButton over 0…10, with its numeric/snap/wrap/policy switches bound to args. */
export class SpinButtonStory extends StoryWidget {
    private _spin: Gtk.SpinButton | null = null;
    private _adjustment: Gtk.Adjustment | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookSpinButton' }, SpinButtonStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(SpinButtonStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...spinButtonMeta, component: Gtk.SpinButton.$gtype };
    }

    initialize(): void {
        this._adjustment = new Gtk.Adjustment({ value: 5, lower: 0, upper: 10, stepIncrement: 1, pageIncrement: 2 });
        this._spin = new Gtk.SpinButton({ adjustment: this._adjustment, digits: 0, halign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._spin);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._spin || !this._adjustment) return;
        this._spin.orientation =
            this.args.orientation === 'vertical' ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL;
        this._spin.digits = this.args.digits as number;
        this._spin.numeric = this.args.numeric as boolean;
        this._spin.snap_to_ticks = this.args.snapToTicks as boolean;
        this._spin.wrap = this.args.wrap as boolean;
        this._spin.update_policy =
            this.args.updatePolicy === 'if-valid'
                ? Gtk.SpinButtonUpdatePolicy.IF_VALID
                : Gtk.SpinButtonUpdatePolicy.ALWAYS;
        this._adjustment.set_value(this.args.value as number);
    }
}

GObject.type_ensure(SpinButtonStory.$gtype);

export const SpinButtonStories: StoryModule = { stories: [SpinButtonStory] };
