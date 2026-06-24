// Browser port of the View Switcher story — adw-view-switcher with three
// adw-view-switcher-page children (each an adw-status-page body) and the
// wide/narrow policy. Shares its metadata/controls with the GTK twin
// (view-switcher.story.ts).

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { viewSwitcherMeta } from '../../view-switching/view-switcher.meta.js';

// The three pages, mirroring the native demo (Inbox / Starred / Archive).
const PAGES: ReadonlyArray<{ name: string; title: string; icon: string; description: string }> = [
    { name: 'inbox', title: 'Inbox', icon: 'mail-unread', description: 'You have three unread conversations.' },
    { name: 'starred', title: 'Starred', icon: 'starred', description: 'Messages you have marked as important.' },
    { name: 'archive', title: 'Archive', icon: 'folder', description: 'Older conversations kept for reference.' },
];

export class ViewSwitcherWebStory extends StoryElement {
    private _switcher: HTMLElement | null = null;

    constructor() {
        super(ViewSwitcherWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return viewSwitcherMeta;
    }

    initialize(): void {
        const switcher = document.createElement('adw-view-switcher');
        for (const { name, title, icon, description } of PAGES) {
            const page = document.createElement('adw-view-switcher-page');
            page.setAttribute('name', name);
            page.setAttribute('title', title);
            page.setAttribute('icon-name', icon);

            const status = document.createElement('adw-status-page');
            status.setAttribute('icon', icon);
            status.setAttribute('title', title);
            status.setAttribute('description', description);
            page.appendChild(status);

            switcher.appendChild(page);
        }
        switcher.setAttribute('policy', this.args.policy as string);
        switcher.style.width = '480px';
        this._switcher = switcher;
        this.addContent(switcher);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._switcher) return;
        this._switcher.setAttribute('policy', this.args.policy as string);
    }
}

export const ViewSwitcherWebStories: WebStoryModule = { stories: [ViewSwitcherWebStory] };
