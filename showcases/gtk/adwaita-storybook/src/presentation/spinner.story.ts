// Adw.Spinner — a determinate-free loading indicator that animates while
// shown. original implementation.

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

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
        return {
            title: 'Presentation/Spinner',
            description: 'Adw.Spinner — a lightweight loading indicator that spins continuously while visible.',
            component: Adw.Spinner.$gtype,
            controls: [
                { name: 'size', label: 'Size', type: ControlType.RANGE, min: 16, max: 64, step: 4, defaultValue: 48 },
            ],
        };
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
