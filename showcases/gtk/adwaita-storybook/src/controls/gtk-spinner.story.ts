// Gtk.Spinner — the GTK busy indicator, sized by its allocation.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { gtkSpinnerMeta } from './gtk-spinner.meta.js';

/** Story: a Gtk.Spinner at a chosen size, spinning or stopped. */
export class GtkSpinnerStory extends StoryWidget {
    private _spinner: Gtk.Spinner | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookGtkSpinner' }, GtkSpinnerStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(GtkSpinnerStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...gtkSpinnerMeta, component: Gtk.Spinner.$gtype };
    }

    initialize(): void {
        this._spinner = new Gtk.Spinner({ halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._spinner);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._spinner) return;
        // `GtkSpinner` has ONE property and no size property of its own: the icon is
        // measured from the `icon-size` CSS property and the widget from its allocation
        // (gtkspinner.c:110-123), so a request is how a story sizes it.
        const size = this.args.size as number;
        this._spinner.widthRequest = size;
        this._spinner.heightRequest = size;
        // `start()` / `stop()`, not the property: both also raise and clear
        // GTK_ACCESSIBLE_STATE_BUSY (gtkspinner.c:373-400).
        if (this.args.spinning as boolean) this._spinner.start();
        else this._spinner.stop();
        this._spinner.sensitive = !(this.args.disabled as boolean);
    }
}

GObject.type_ensure(GtkSpinnerStory.$gtype);

export const GtkSpinnerStories: StoryModule = { stories: [GtkSpinnerStory] };
