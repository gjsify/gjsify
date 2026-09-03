// NativeScript port of the Spin Row story. Shares metadata with the GTK
// spin-row.story.ts and browser spin-row.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { spinRowMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class SpinRowNsStory extends StoryView {
    private _row: Adw.SpinRow | null = null;

    constructor() {
        super(SpinRowNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return spinRowMeta;
    }

    initialize(): void {
        this._row = new Adw.SpinRow();
        this._row.min = 0;
        this._row.max = 100;
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
        // Mirror Adw.SpinRow.digits via the step's decimal precision.
        const digits = this.args.digits as number;
        this._row.step = 10 ** -digits;
        this._row.value = this.args.value as number;
    }
}

export const SpinRowNsStories: NsStoryModule = { stories: [SpinRowNsStory] };
