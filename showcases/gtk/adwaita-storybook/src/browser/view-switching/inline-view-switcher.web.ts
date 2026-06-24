// Browser port of the Inline View Switcher story — adw-inline-view-switcher
// driving a stack of three adw-view-stack-page children, with the display-mode
// control (labels / icons / both). Shares its metadata/controls with the GTK
// twin (inline-view-switcher.story.ts).

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { inlineViewSwitcherMeta } from '../../view-switching/inline-view-switcher.meta.js';

// The three pages, mirroring the native demo (Overview / Activity / Settings).
const PAGES: ReadonlyArray<{ id: string; title: string; icon: string; body: string }> = [
    { id: 'overview', title: 'Overview', icon: 'view-grid', body: 'A quick summary of your project.' },
    { id: 'activity', title: 'Activity', icon: 'document-edit', body: 'Recent edits and changes.' },
    { id: 'settings', title: 'Settings', icon: 'emblem-system', body: 'Configure how things behave.' },
];

export class InlineViewSwitcherWebStory extends StoryElement {
    private _switcher: HTMLElement | null = null;

    constructor() {
        super(InlineViewSwitcherWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return inlineViewSwitcherMeta;
    }

    initialize(): void {
        const switcher = document.createElement('adw-inline-view-switcher');
        for (const { id, title, icon, body } of PAGES) {
            const page = document.createElement('adw-view-stack-page');
            page.setAttribute('title', title);
            page.setAttribute('icon-name', icon);

            // A status-page body per page (mirrors the native Adw.StatusPage pages).
            const status = document.createElement('adw-status-page');
            status.id = id;
            status.setAttribute('icon', icon);
            status.setAttribute('title', title);
            status.setAttribute('description', body);
            page.appendChild(status);

            switcher.appendChild(page);
        }
        switcher.setAttribute('display-mode', this.args.displayMode as string);
        this._switcher = switcher;
        this.addContent(switcher);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._switcher) return;
        this._switcher.setAttribute('display-mode', this.args.displayMode as string);
    }
}

export const InlineViewSwitcherWebStories: WebStoryModule = { stories: [InlineViewSwitcherWebStory] };
