// Gtk.CheckButton — a label beside an indicator, and the third "in between" state.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { checkButtonMeta } from './check-button.meta.js';

/** Story: a Gtk.CheckButton with its label, both booleans and `sensitive` bound to args. */
export class CheckButtonStory extends StoryWidget {
    private _box: Gtk.Box | null = null;
    private _button: Gtk.CheckButton | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookCheckButton' }, CheckButtonStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(CheckButtonStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...checkButtonMeta, component: Gtk.CheckButton.$gtype };
    }

    initialize(): void {
        this._button = new Gtk.CheckButton();
        this._box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            halign: Gtk.Align.CENTER,
        });
        this._box.append(this._button);
        this._apply();
        this.addContent(this._box);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._button) return;
        this._button.label = this.args.label as string;
        this._button.active = this.args.checked as boolean;
        // GTK does NOT clear the inconsistent state when the user checks the button; the
        // property's own documentation says turning it off again is the application's job
        // (gtkcheckbutton.c:855-856). The browser element diverges here, and says so.
        this._button.inconsistent = this.args.indeterminate as boolean;
        this._button.sensitive = !(this.args.disabled as boolean);
    }
}

GObject.type_ensure(CheckButtonStory.$gtype);

export const CheckButtonStories: StoryModule = { stories: [CheckButtonStory] };
