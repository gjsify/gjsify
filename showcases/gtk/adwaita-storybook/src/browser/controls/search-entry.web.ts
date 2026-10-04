// Browser port of the Search Entry story. Shares metadata with search-entry.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { searchEntryMeta } from '../../controls/search-entry.meta.js';

export class SearchEntryWebStory extends StoryElement {
    private _entry: HTMLElement | null = null;
    private _label: HTMLElement | null = null;

    constructor() {
        super(SearchEntryWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return searchEntryMeta;
    }

    initialize(): void {
        this._entry = document.createElement('gtk-search-entry');
        this._entry.style.minWidth = '260px';
        this._label = document.createElement('gtk-label');
        this._label.className = 'dimmed';
        this._label.textContent = 'search-changed has not fired yet';
        this._entry.addEventListener('search-changed', (event) => {
            const { value } = (event as CustomEvent).detail as { value: string };
            if (this._label) this._label.textContent = `search-changed: "${value}"`;
        });
        this._apply();
        const box = document.createElement('div');
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        box.style.gap = '12px';
        box.append(this._entry, this._label);
        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._entry) return;
        this._entry.setAttribute('search-delay', String(this.args.searchDelay as number));
        this._entry.setAttribute('placeholder', this.args.placeholderText as string);
        this._entry.toggleAttribute('disabled', this.args.disabled as boolean);
    }
}

export const SearchEntryWebStories: WebStoryModule = { stories: [SearchEntryWebStory] };
