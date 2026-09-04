// NativeScript port of the Switch Row story. Shares metadata with the GTK
// switch-row.story.ts and browser switch-row.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { switchRowMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class SwitchRowNsStory extends StoryView {
    private _row: Adw.SwitchRow | null = null;

    constructor() {
        super(SwitchRowNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return switchRowMeta;
    }

    initialize(): void {
        this._row = new Adw.SwitchRow();
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
        this._row.subtitle = this.args.subtitle as string;
        this._row.active = this.args.active as boolean;
    }
}

export const SwitchRowNsStories: NsStoryModule = { stories: [SwitchRowNsStory] };
