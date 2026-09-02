// Adw.ShortcutLabel — an accelerator drawn as keycaps. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { SHORTCUT_LABEL_LEVELS, shortcutLabelLevelsMeta, shortcutLabelMeta } from './shortcut-label.meta.js';

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

/** Story: every grammar level stacked, so the rules are legible side by side. */
export class ShortcutLabelLevelsStory extends StoryWidget {
    private _widgets: Adw.ShortcutLabel[] = [];

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookShortcutLabelLevels' }, ShortcutLabelLevelsStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ShortcutLabelLevelsStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...shortcutLabelLevelsMeta, component: Adw.ShortcutLabel.$gtype };
    }

    initialize(): void {
        // A grid rather than a box per row: the shortcuts line up in one column
        // only if they share it, and the comparison is the point of this story.
        const grid = new Gtk.Grid({ row_spacing: 12, column_spacing: 24 });

        for (const [row, level] of SHORTCUT_LABEL_LEVELS.entries()) {
            const name = new Gtk.Label({ label: level.label, halign: Gtk.Align.START });
            name.add_css_class('dimmed');
            grid.attach(name, 0, row, 1, 1);

            const widget = new Adw.ShortcutLabel({
                accelerator: level.accelerator,
                disabledText: this.args.disabledText as string,
                halign: Gtk.Align.END,
                hexpand: true,
            });
            grid.attach(widget, 1, row, 1, 1);
            this._widgets.push(widget);
        }

        this.addContent(grid);
    }

    updateArgs(_args: StoryArgs): void {
        for (const widget of this._widgets) {
            widget.disabledText = this.args.disabledText as string;
        }
    }
}

GObject.type_ensure(ShortcutLabelLevelsStory.$gtype);

export const ShortcutLabelStories: StoryModule = { stories: [ShortcutLabelStory, ShortcutLabelLevelsStory] };
