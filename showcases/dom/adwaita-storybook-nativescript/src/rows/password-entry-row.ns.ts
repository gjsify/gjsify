// NativeScript port of the Password Entry Row story. Shares metadata with the
// GTK password-entry-row.story.ts and browser password-entry-row.web.ts
// (imported from the GTK showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { passwordEntryRowMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class PasswordEntryRowNsStory extends StoryView {
    private _row: Adw.PasswordEntryRow | null = null;

    constructor() {
        super(PasswordEntryRowNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return passwordEntryRowMeta;
    }

    initialize(): void {
        this._row = new Adw.PasswordEntryRow();
        this._syncRow();

        const group = new Adw.PreferencesGroup();
        group.addRow(this._row);

        const clamp = new Adw.Clamp();
        clamp.maximumSize = 400;
        clamp.setChild(group);

        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncRow();
    }

    private _syncRow(): void {
        if (!this._row) return;
        this._row.title = this.args.title as string;
        this._row.text = this.args.text as string;
    }
}

export const PasswordEntryRowNsStories: NsStoryModule = { stories: [PasswordEntryRowNsStory] };
