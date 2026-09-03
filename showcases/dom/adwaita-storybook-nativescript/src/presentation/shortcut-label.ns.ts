// NativeScript port of the Shortcut Label story. Shares metadata with the GTK
// shortcut-label.story.ts and browser shortcut-label.web.ts (imported from the
// GTK showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { GridLayout, ItemSpec, Label, StackLayout } from '@nativescript/core';
import { Adw } from '@gjsify/adwaita-nativescript';
import {
    SHORTCUT_LABEL_LEVELS,
    shortcutLabelLevelsMeta,
    shortcutLabelMeta,
} from '@gjsify/example-gtk-adwaita-storybook/metas';

export class ShortcutLabelNsStory extends StoryView {
    private _widget: Adw.ShortcutLabel | null = null;

    constructor() {
        super(ShortcutLabelNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return shortcutLabelMeta;
    }

    initialize(): void {
        this._widget = new Adw.ShortcutLabel();
        this._sync();
        this.addContent(this._widget);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    /** `disabledText` first: an empty accelerator renders the placeholder, so the
     *  placeholder has to be in place before the accelerator triggers the rebuild. */
    private _sync(): void {
        if (!this._widget) return;
        this._widget.disabledText = this.args.disabledText as string;
        this._widget.accelerator = this.args.accelerator as string;
    }
}

/** Story: every grammar level stacked, so the rules are legible side by side. */
export class ShortcutLabelLevelsNsStory extends StoryView {
    private _widgets: Adw.ShortcutLabel[] = [];

    constructor() {
        super(ShortcutLabelLevelsNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return shortcutLabelLevelsMeta;
    }

    initialize(): void {
        // One GridLayout with `auto, *` columns rather than a StackLayout per row:
        // the shortcuts line up in one column only if they share it, and NS has no
        // subgrid, so per-row grids would each resolve their own `auto` and
        // stagger — the same reason AdwDataGrid is one grid.
        const grid = new GridLayout();
        grid.addColumn(new ItemSpec(1, 'auto'));
        grid.addColumn(new ItemSpec(1, 'star'));

        for (const [row, level] of SHORTCUT_LABEL_LEVELS.entries()) {
            grid.addRow(new ItemSpec(1, 'auto'));

            const name = new Label();
            name.text = level.label;
            name.className = 'dimmed';
            name.verticalAlignment = 'middle';
            name.marginRight = 24;
            name.marginBottom = 12;
            GridLayout.setRow(name, row);
            GridLayout.setColumn(name, 0);
            grid.addChild(name);

            const widget = new Adw.ShortcutLabel();
            widget.disabledText = this.args.disabledText as string;
            widget.accelerator = level.accelerator;
            widget.horizontalAlignment = 'right';
            widget.marginBottom = 12;
            GridLayout.setRow(widget, row);
            GridLayout.setColumn(widget, 1);
            grid.addChild(widget);
            this._widgets.push(widget);
        }

        const host = new StackLayout();
        host.addChild(grid);
        this.addContent(host);
    }

    updateArgs(_args: StoryArgs): void {
        for (const widget of this._widgets) {
            widget.disabledText = this.args.disabledText as string;
        }
    }
}

export const ShortcutLabelNsStories: NsStoryModule = {
    stories: [ShortcutLabelNsStory, ShortcutLabelLevelsNsStory],
};
