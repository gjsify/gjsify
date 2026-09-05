// NativeScript port of the Preferences Group story. Shares metadata with the
// GTK preferences-group.story.ts and browser preferences-group.web.ts (imported
// from the GTK showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';
import { preferencesGroupMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

const REGION_OPTIONS = ['Europe', 'Americas', 'Asia', 'Oceania'];

export class PreferencesGroupNsStory extends StoryView {
    private _group: Adw.PreferencesGroup | null = null;

    constructor() {
        super(PreferencesGroupNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return preferencesGroupMeta;
    }

    initialize(): void {
        this._group = new Adw.PreferencesGroup();

        const nameRow = new Adw.EntryRow();
        nameRow.title = 'Display name';
        nameRow.text = 'Grace Hopper';
        this._group.addRow(nameRow);

        const syncRow = new Adw.SwitchRow();
        syncRow.title = 'Sync over Wi-Fi only';
        syncRow.subtitle = 'Avoid using mobile data for backups';
        syncRow.active = true;
        this._group.addRow(syncRow);

        const regionRow = new Adw.ComboRow();
        regionRow.title = 'Region';
        regionRow.model = REGION_OPTIONS;
        regionRow.selected = 0;
        this._group.addRow(regionRow);

        // The native story's `headerSuffix` is a flat "Sign out" Gtk.Button in the
        // group header — the NS group now has that slot, so the three renderers
        // present the story identically instead of moving the button into a row.
        const signOut = new Gtk.Button();
        signOut.cssClasses = 'flat';
        signOut.text = 'Sign out';
        this._group.headerSuffix = signOut;

        this._syncGroup();

        const clamp = new Adw.Clamp();
        clamp.maximumSize = 400;
        clamp.setChild(this._group);

        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncGroup();
    }

    private _syncGroup(): void {
        if (!this._group) return;
        this._group.title = this.args.title as string;
        this._group.description = this.args.description as string;
    }
}

export const PreferencesGroupNsStories: NsStoryModule = { stories: [PreferencesGroupNsStory] };
