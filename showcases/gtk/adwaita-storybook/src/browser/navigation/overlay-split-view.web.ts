// Browser port of the Overlay Split View story. Shares metadata with
// overlay-split-view.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { overlaySplitViewMeta } from '../../navigation/overlay-split-view.meta.js';

/**
 * Sidebar rows — title plus the symbolic icon shown as the row prefix. Icon
 * names mirror the native story's GTK names 1:1 (the `-symbolic` suffix is
 * dropped to form the adwaita-web mask class, as elsewhere in the browser port).
 */
const SIDEBAR_ROWS: ReadonlyArray<readonly [string, string]> = [
    ['Home', 'go-home'],
    ['Discover', 'system-search'],
    ['Library', 'folder-music'],
    ['Settings', 'emblem-system'],
];

export class OverlaySplitViewWebStory extends StoryElement {
    private _view: HTMLElement | null = null;

    constructor() {
        super(OverlaySplitViewWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return overlaySplitViewMeta;
    }

    private buildSidebar(): HTMLElement {
        // A boxed list of activatable rows, each with a leading symbolic icon —
        // the equivalent of the native story's Adw.PreferencesGroup of ActionRows.
        const group = document.createElement('adw-preferences-group');
        for (const [title, icon] of SIDEBAR_ROWS) {
            const row = document.createElement('adw-action-row');
            row.setAttribute('title', title);
            row.setAttribute('activatable', '');

            const iconEl = document.createElement('span');
            iconEl.setAttribute('slot', 'prefix');
            iconEl.className = `adw-icon adw-icon--${icon}`;
            row.appendChild(iconEl);

            group.appendChild(row);
        }

        // Toolbar view with a title-less header bar, framing the boxed list.
        // `sidebar` styling mirrors the native add_css_class('sidebar').
        const toolbarView = document.createElement('adw-toolbar-view');
        toolbarView.classList.add('sidebar');

        const header = document.createElement('adw-header-bar');
        header.setAttribute('slot', 'top');
        toolbarView.appendChild(header);
        toolbarView.appendChild(group);

        return toolbarView;
    }

    private buildContent(): HTMLElement {
        const status = document.createElement('adw-status-page');
        status.setAttribute('icon', 'folder-music');
        status.setAttribute('title', 'Your Library');
        status.setAttribute(
            'description',
            'Toggle the sidebar to browse sections. Collapse it to overlay the content.',
        );

        const toolbarView = document.createElement('adw-toolbar-view');
        const header = document.createElement('adw-header-bar');
        header.setAttribute('slot', 'top');
        toolbarView.appendChild(header);
        toolbarView.appendChild(status);

        return toolbarView;
    }

    initialize(): void {
        this._view = document.createElement('adw-overlay-split-view');
        this._view.style.width = '480px';
        this._view.style.height = '340px';

        const sidebar = this.buildSidebar();
        sidebar.setAttribute('slot', 'sidebar');

        const content = this.buildContent();
        content.setAttribute('slot', 'content');

        this._view.append(sidebar, content);

        this._sync();
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._view) return;
        this._view.toggleAttribute('show-sidebar', this.args.showSidebar as boolean);
        this._view.toggleAttribute('collapsed', this.args.collapsed as boolean);
    }
}

export const OverlaySplitViewWebStories: WebStoryModule = { stories: [OverlaySplitViewWebStory] };
