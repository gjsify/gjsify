// NativeScript port of the Entry story. Shares metadata with the GTK
// entry.story.ts and browser entry.web.ts (imported from the GTK showcase's
// renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Gtk } from '@gjsify/adwaita-nativescript';
import { entryMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class EntryNsStory extends StoryView {
    private _entry: Gtk.Entry | null = null;

    constructor() {
        super(EntryNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return entryMeta;
    }

    initialize(): void {
        this._entry = new Gtk.Entry();
        this._apply();
        this.addContent(this._entry);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._entry) return;
        this._entry.text = this.args.text as string;
        this._entry.placeholderText = this.args.placeholder as string;
        this._entry.editable = this.args.editable as boolean;
    }
}

export const EntryNsStories: NsStoryModule = { stories: [EntryNsStory] };
