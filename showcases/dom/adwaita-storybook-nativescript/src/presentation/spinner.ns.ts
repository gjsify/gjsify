// NativeScript port of the Spinner story. Shares metadata with the GTK
// spinner.story.ts and browser spinner.web.ts (imported from the GTK showcase's
// renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { spinnerMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class SpinnerNsStory extends StoryView {
    private _spinner: Adw.Spinner | null = null;

    constructor() {
        super(SpinnerNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return spinnerMeta;
    }

    initialize(): void {
        this._spinner = new Adw.Spinner();
        this._spinner.size = this.args.size as number;
        this.addContent(this._spinner);
    }

    updateArgs(_args: StoryArgs): void {
        if (this._spinner) this._spinner.size = this.args.size as number;
    }
}

export const SpinnerNsStories: NsStoryModule = { stories: [SpinnerNsStory] };
