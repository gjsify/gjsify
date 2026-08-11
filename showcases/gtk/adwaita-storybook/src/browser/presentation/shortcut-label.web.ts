// Browser port of the Shortcut Label story. Shares metadata with shortcut-label.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import {
    SHORTCUT_LABEL_LEVELS,
    shortcutLabelLevelsMeta,
    shortcutLabelMeta,
} from '../../presentation/shortcut-label.meta.js';

export class ShortcutLabelWebStory extends StoryElement {
    private _widget: HTMLElement | null = null;

    constructor() {
        super(ShortcutLabelWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return shortcutLabelMeta;
    }

    initialize(): void {
        this._widget = document.createElement('adw-shortcut-label');
        this._sync();
        this.addContent(this._widget);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    /** `disabled-text` first: an empty accelerator renders the placeholder, so the
     *  placeholder has to be in place before the accelerator triggers the render. */
    private _sync(): void {
        if (!this._widget) return;
        this._widget.setAttribute('disabled-text', this.args.disabledText as string);
        this._widget.setAttribute('accelerator', this.args.accelerator as string);
    }
}

/** Story: every grammar level stacked, so the rules are legible side by side. */
export class ShortcutLabelLevelsWebStory extends StoryElement {
    private _widgets: HTMLElement[] = [];

    constructor() {
        super(ShortcutLabelLevelsWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return shortcutLabelLevelsMeta;
    }

    initialize(): void {
        // A two-column grid, so the shortcuts share one column and line up — the
        // comparison is the point of this story.
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'auto auto';
        grid.style.rowGap = '12px';
        grid.style.columnGap = '24px';
        grid.style.alignItems = 'center';

        for (const level of SHORTCUT_LABEL_LEVELS) {
            const name = document.createElement('span');
            name.className = 'dimmed';
            name.textContent = level.label;
            grid.append(name);

            const widget = document.createElement('adw-shortcut-label');
            widget.style.justifySelf = 'end';
            widget.setAttribute('disabled-text', this.args.disabledText as string);
            widget.setAttribute('accelerator', level.accelerator);
            grid.append(widget);
            this._widgets.push(widget);
        }

        this.addContent(grid);
    }

    updateArgs(_args: StoryArgs): void {
        for (const widget of this._widgets) {
            widget.setAttribute('disabled-text', this.args.disabledText as string);
        }
    }
}

export const ShortcutLabelWebStories: WebStoryModule = {
    stories: [ShortcutLabelWebStory, ShortcutLabelLevelsWebStory],
};
