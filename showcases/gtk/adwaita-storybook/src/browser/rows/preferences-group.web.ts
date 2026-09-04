// Browser port of the Preferences Group story. Shares metadata with
// preferences-group.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { preferencesGroupMeta } from '../../rows/preferences-group.meta.js';

const REGION_OPTIONS = ['Europe', 'Americas', 'Asia', 'Oceania'];

export class PreferencesGroupWebStory extends StoryElement {
    private _group: HTMLElement | null = null;

    constructor() {
        super(PreferencesGroupWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return preferencesGroupMeta;
    }

    initialize(): void {
        this._group = document.createElement('adw-preferences-group');

        // Header-suffix: a flat "Sign out" button at the trailing edge of the
        // header — mirrors the native story's `headerSuffix` Gtk.Button.
        const signOut = document.createElement('button');
        signOut.className = 'adw-button flat';
        signOut.textContent = 'Sign out';
        signOut.setAttribute('slot', 'header-suffix');
        this._group.append(signOut);

        const nameRow = document.createElement('adw-entry-row');
        nameRow.setAttribute('title', 'Display name');
        nameRow.setAttribute('text', 'Grace Hopper');
        this._group.append(nameRow);

        const syncRow = document.createElement('adw-switch-row');
        syncRow.setAttribute('title', 'Sync over Wi-Fi only');
        syncRow.setAttribute('subtitle', 'Avoid using mobile data for backups');
        syncRow.setAttribute('active', '');
        this._group.append(syncRow);

        const regionRow = document.createElement('adw-combo-row');
        regionRow.setAttribute('title', 'Region');
        regionRow.setAttribute('model', JSON.stringify(REGION_OPTIONS));
        regionRow.setAttribute('selected', '0');
        this._group.append(regionRow);

        this._syncGroup();

        const clamp = document.createElement('adw-clamp');
        clamp.setAttribute('maximum-size', '400');
        clamp.append(this._group);

        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncGroup();
    }

    private _syncGroup(): void {
        if (!this._group) return;
        this._group.setAttribute('title', this.args.title as string);
        this._group.setAttribute('description', this.args.description as string);
    }
}

export const PreferencesGroupWebStories: WebStoryModule = { stories: [PreferencesGroupWebStory] };
