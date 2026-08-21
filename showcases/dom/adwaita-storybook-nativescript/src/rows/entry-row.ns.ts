// NativeScript port of the Entry Row story. Shares metadata with the GTK
// entry-row.story.ts and browser entry-row.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwClamp, AdwEntryRow, AdwPreferencesGroup } from '@gjsify/adwaita-nativescript';
import { entryRowMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class EntryRowNsStory extends StoryView {
    private _row: AdwEntryRow | null = null;

    constructor() {
        super(EntryRowNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return entryRowMeta;
    }

    initialize(): void {
        this._row = new AdwEntryRow();
        this._syncRow();

        const group = new AdwPreferencesGroup();
        group.addRow(this._row);

        const clamp = new AdwClamp();
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
        this._row.showApplyButton = this.args.showApplyButton as boolean;
    }
}

export const EntryRowNsStories: NsStoryModule = { stories: [EntryRowNsStory] };
