// NativeScript port of the Wrap Box story. Shares metadata with the GTK
// wrap-box.story.ts and browser wrap-box.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';
import { wrapBoxMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

const TAGS = ['Design', 'Adwaita', 'GNOME', 'GTK', 'Typescript', 'Storybook', 'Wrapping', 'Layout'];

export class WrapBoxNsStory extends StoryView {
    private _wrap: Adw.WrapBox | null = null;

    constructor() {
        super(WrapBoxNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return wrapBoxMeta;
    }

    initialize(): void {
        this._wrap = new Adw.WrapBox();
        this._wrap.width = 460;

        for (const tag of TAGS) {
            const chip = new Gtk.Button();
            chip.text = tag;
            chip.cssClasses = 'pill';
            this._wrap.add(chip);
        }

        this._syncWrap();
        this.addContent(this._wrap);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncWrap();
    }

    private _syncWrap(): void {
        if (!this._wrap) return;
        this._wrap.childSpacing = this.args.childSpacing as number;
        this._wrap.lineSpacing = this.args.lineSpacing as number;
    }
}

export const WrapBoxNsStories: NsStoryModule = { stories: [WrapBoxNsStory] };
