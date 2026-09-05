// NativeScript port of the Combo Row story. Shares metadata with the GTK
// combo-row.story.ts and browser combo-row.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { COMBO_ROW_OPTIONS, comboRowMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class ComboRowNsStory extends StoryView {
    private _row: Adw.ComboRow | null = null;

    constructor() {
        super(ComboRowNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return comboRowMeta;
    }

    initialize(): void {
        this._row = new Adw.ComboRow();
        // Adw.ComboRow expects {label, value} options; the shared metadata ships
        // plain strings, so map each to an identical label/value pair.
        this._row.model = [...COMBO_ROW_OPTIONS];
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
        this._row.selected = this.args.selected as number;
    }
}

export const ComboRowNsStories: NsStoryModule = { stories: [ComboRowNsStory] };
