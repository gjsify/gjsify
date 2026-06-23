// Browser port of the Window Title story. Shares metadata with window-title.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { windowTitleMeta } from '../../presentation/window-title.meta.js';

export class WindowTitleWebStory extends StoryElement {
    private _windowTitle: HTMLElement | null = null;

    constructor() {
        super(WindowTitleWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return windowTitleMeta;
    }

    initialize(): void {
        this._windowTitle = document.createElement('adw-window-title');
        this._sync();
        this.addContent(this._windowTitle);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._windowTitle) return;
        this._windowTitle.setAttribute('title', this.args.title as string);
        this._windowTitle.setAttribute('subtitle', this.args.subtitle as string);
    }
}

export const WindowTitleWebStories: WebStoryModule = { stories: [WindowTitleWebStory] };
