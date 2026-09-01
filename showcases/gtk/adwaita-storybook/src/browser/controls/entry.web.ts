// Browser port of the Entry story. Shares metadata with entry.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { entryMeta } from '../../controls/entry.meta.js';

export class EntryWebStory extends StoryElement {
    private _entry: HTMLElement | null = null;

    constructor() {
        super(EntryWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return entryMeta;
    }

    initialize(): void {
        this._entry = document.createElement('gtk-entry');
        this._entry.style.minWidth = '280px';
        this._apply();
        this.addContent(this._entry);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._entry) return;
        this._entry.setAttribute('value', this.args.text as string);
        this._entry.setAttribute('placeholder', this.args.placeholder as string);
        // `<gtk-entry>` has no `editable`: the browser spelling of a field you may
        // read but not change is `disabled`, which also greys it — the one place
        // this rendering cannot match GtkEditable:editable exactly.
        if (this.args.editable as boolean) this._entry.removeAttribute('disabled');
        else this._entry.setAttribute('disabled', '');
    }
}

export const EntryWebStories: WebStoryModule = { stories: [EntryWebStory] };
