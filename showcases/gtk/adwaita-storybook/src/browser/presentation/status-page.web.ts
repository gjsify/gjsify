// Browser port of the Status Page story. Shares metadata with status-page.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { statusPageMeta } from '../../presentation/status-page.meta.js';

export class StatusPageWebStory extends StoryElement {
    private _page: HTMLElement | null = null;

    constructor() {
        super(StatusPageWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return statusPageMeta;
    }

    initialize(): void {
        this._page = document.createElement('adw-status-page');

        // Suggested-action pill button, matching the native story's child.
        const button = document.createElement('gtk-button');
        button.setAttribute('label', 'New Document');
        button.setAttribute('pill', '');
        button.setAttribute('suggested', '');
        this._page.appendChild(button);

        this._sync();
        this.addContent(this._page);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._page) return;
        this._page.setAttribute('icon', (this.args.iconName as string).replace(/-symbolic$/, ''));
        this._page.setAttribute('title', this.args.title as string);
        this._page.setAttribute('description', this.args.description as string);
    }
}

export const StatusPageWebStories: WebStoryModule = { stories: [StatusPageWebStory] };
