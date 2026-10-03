// Gtk.ToggleButton — a button that stays pressed.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { toggleButtonMeta } from './toggle-button.meta.js';

/** Story: a Gtk.ToggleButton with its label, state and the flat style class bound to args. */
export class ToggleButtonStory extends StoryWidget {
    private _button: Gtk.ToggleButton | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookToggleButton' }, ToggleButtonStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ToggleButtonStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...toggleButtonMeta, component: Gtk.ToggleButton.$gtype };
    }

    initialize(): void {
        this._button = new Gtk.ToggleButton({ halign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._button);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._button) return;
        this._button.label = this.args.label as string;
        this._button.active = this.args.active as boolean;
        if (this.args.flat as boolean) this._button.add_css_class('flat');
        else this._button.remove_css_class('flat');
    }
}

GObject.type_ensure(ToggleButtonStory.$gtype);

export const ToggleButtonStories: StoryModule = { stories: [ToggleButtonStory] };
