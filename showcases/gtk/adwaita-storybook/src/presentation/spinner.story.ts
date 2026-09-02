// Adw.Spinner — a determinate-free loading indicator that animates while
// shown. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { spinnerMeta } from './spinner.meta.js';

/** Story: Adw.Spinner sized via width/height requests. */
export class SpinnerStory extends StoryWidget {
    private _spinner: Adw.Spinner | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookSpinner' }, SpinnerStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(SpinnerStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...spinnerMeta, component: Adw.Spinner.$gtype };
    }

    initialize(): void {
        const size = this.args.size as number;
        this._spinner = new Adw.Spinner({
            widthRequest: size,
            heightRequest: size,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        this.addContent(this._spinner);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._spinner) return;
        const size = this.args.size as number;
        this._spinner.widthRequest = size;
        this._spinner.heightRequest = size;
    }
}

GObject.type_ensure(SpinnerStory.$gtype);

export const SpinnerStories: StoryModule = { stories: [SpinnerStory] };
