// Browser port of the Button Row story. Shares metadata with button-row.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { buttonRowMeta } from '../../rows/button-row.meta.js';

const STYLE_CLASSES = ['suggested-action', 'destructive-action'];

/** GTK symbolic name (e.g. "list-add-symbolic") → adwaita-web start-icon-name. */
function iconName(gtkName: string): string {
    return gtkName.replace(/-symbolic$/, '');
}

export class ButtonRowWebStory extends StoryElement {
    private _row: HTMLElement | null = null;

    constructor() {
        super(ButtonRowWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return buttonRowMeta;
    }

    initialize(): void {
        this._row = document.createElement('adw-button-row');
        this._syncRow();

        const group = document.createElement('adw-preferences-group');
        group.append(this._row);

        const clamp = document.createElement('adw-clamp');
        clamp.setAttribute('maximum-size', '400');
        clamp.append(group);

        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncRow();
    }

    private _syncRow(): void {
        if (!this._row) return;
        this._row.setAttribute('title', this.args.title as string);

        const icon = iconName(this.args.startIconName as string);
        if (icon) this._row.setAttribute('start-icon-name', icon);
        else this._row.removeAttribute('start-icon-name');

        this._applyStyle(this.args.style as string);
    }

    private _applyStyle(style: string): void {
        if (!this._row) return;
        for (const cls of STYLE_CLASSES) {
            this._row.classList.remove(cls);
        }
        if (style !== 'none') {
            this._row.classList.add(style);
        }
    }
}

export const ButtonRowWebStories: WebStoryModule = { stories: [ButtonRowWebStory] };
