// Browser port of the Action Row story. Shares metadata with action-row.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { actionRowMeta } from '../../rows/action-row.meta.js';

/** GTK symbolic name (e.g. "folder-symbolic") → adwaita-web icon class. */
function iconClass(gtkName: string): string {
    return `gtk-image adw-icon--${gtkName.replace(/-symbolic$/, '')}`;
}

export class ActionRowWebStory extends StoryElement {
    private _row: HTMLElement | null = null;
    private _icon: HTMLElement | null = null;

    constructor() {
        super(ActionRowWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return actionRowMeta;
    }

    initialize(): void {
        this._row = document.createElement('adw-action-row');

        this._icon = document.createElement('span');
        this._icon.setAttribute('slot', 'prefix');
        this._icon.className = iconClass(this.args.iconName as string);

        const button = document.createElement('gtk-button');
        button.setAttribute('slot', 'suffix');
        button.setAttribute('icon', 'go-next');
        button.setAttribute('flat', '');

        this._row.append(this._icon, button);
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
        if (this._icon) this._icon.className = iconClass(this.args.iconName as string);
    }

    private _syncRow(): void {
        if (!this._row) return;
        this._row.setAttribute('title', this.args.title as string);
        this._row.setAttribute('subtitle', this.args.subtitle as string);
        this._row.toggleAttribute('activatable', this.args.activatable as boolean);
    }
}

export const ActionRowWebStories: WebStoryModule = { stories: [ActionRowWebStory] };
