// Adw.ShortcutLabel — an accelerator drawn as keycaps. original implementation.

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import GObject from '@girs/gobject-2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { shortcutLabelMeta } from './shortcut-label.meta.js';

/** Story: Adw.ShortcutLabel across the four levels of its accelerator grammar. */
export class ShortcutLabelStory extends StoryWidget {
    private _widget: Adw.ShortcutLabel | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookShortcutLabel' }, ShortcutLabelStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ShortcutLabelStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...shortcutLabelMeta, component: Adw.ShortcutLabel.$gtype };
    }

    initialize(): void {
        this._widget = new Adw.ShortcutLabel({
            accelerator: this.args.accelerator as string,
            disabledText: this.args.disabledText as string,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        this.addContent(this._widget);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._widget) return;
        this._widget.disabledText = this.args.disabledText as string;
        this._widget.accelerator = this.args.accelerator as string;
    }
}

GObject.type_ensure(ShortcutLabelStory.$gtype);

export const ShortcutLabelStories: StoryModule = { stories: [ShortcutLabelStory] };
