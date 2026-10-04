// Gtk.ProgressBar — determinate progress, indeterminate pulse, and the .osd variant.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { progressBarMeta } from './progress-bar.meta.js';

/** Story: a Gtk.ProgressBar with fraction, pulse, text and the `.osd` style class. */
export class ProgressBarStory extends StoryWidget {
    private _box: Gtk.Box | null = null;
    private _bar: Gtk.ProgressBar | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookProgressBar' }, ProgressBarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ProgressBarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...progressBarMeta, component: Gtk.ProgressBar.$gtype };
    }

    initialize(): void {
        this._bar = new Gtk.ProgressBar();
        this._box = new Gtk.Box({ spacing: 12, halign: Gtk.Align.CENTER });
        this._box.append(this._bar);
        this._apply();
        this.addContent(this._box);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bar) return;
        // Order is GTK's: setting `fraction` LEAVES activity mode (gtkprogressbar.c:791),
        // `pulse()` enters it, so a pulsing bar is the one that was pulsed last.
        if (this.args.pulsing as boolean) this._bar.pulse();
        else this._bar.set_fraction(this.args.fraction as number);
        this._bar.show_text = this.args.showText as boolean;
        this._bar.inverted = this.args.inverted as boolean;
        if (this.args.osd as boolean) this._bar.add_css_class('osd');
        else this._bar.remove_css_class('osd');
    }
}

GObject.type_ensure(ProgressBarStory.$gtype);

export const ProgressBarStories: StoryModule = { stories: [ProgressBarStory] };
