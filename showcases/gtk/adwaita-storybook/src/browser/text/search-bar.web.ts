// Browser port of the Search Bar story. Shares metadata with search-bar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { searchBarMeta } from '../../text/search-bar.meta.js';

/** The properties the story drives, as `<gtk-search-bar>` spells them. */
interface SearchBarControls {
    searchModeEnabled: boolean;
    showCloseButton: boolean;
}

export class SearchBarWebStory extends StoryElement {
    private _bar: (HTMLElement & SearchBarControls) | null = null;

    constructor() {
        super(SearchBarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return searchBarMeta;
    }

    initialize(): void {
        this._bar = document.createElement('gtk-search-bar') as HTMLElement & SearchBarControls;
        // Any `GtkEditable` is a legal child (gtksearchbar.c:611-625), and a plain entry is
        // the case `reveal_child_changed_cb` has a branch of its own for (:186-191).
        const field = document.createElement('gtk-entry');
        field.setAttribute('placeholder-text', 'Search');
        this._bar.appendChild(field);
        this._apply();
        this.addContent(this._bar);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bar) return;
        this._bar.searchModeEnabled = this.args.searchModeEnabled as boolean;
        this._bar.showCloseButton = this.args.showCloseButton as boolean;
    }
}

export const SearchBarWebStories: WebStoryModule = { stories: [SearchBarWebStory] };
