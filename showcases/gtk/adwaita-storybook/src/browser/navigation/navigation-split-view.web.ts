// Browser port of the Navigation Split View story. Shares metadata with
// navigation-split-view.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { navigationSplitViewMeta } from '../../navigation/navigation-split-view.meta.js';

/** GTK symbolic name (e.g. "folder-symbolic") → adwaita-web icon class. */
function iconClass(gtkName: string): string {
    return `gtk-image adw-icon--${gtkName.replace(/-symbolic$/, '')}`;
}

export class NavigationSplitViewWebStory extends StoryElement {
    private _view: HTMLElement | null = null;

    constructor() {
        super(NavigationSplitViewWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return navigationSplitViewMeta;
    }

    /** A boxed-list of mailboxes inside a toolbar view — the sidebar page. */
    private buildSidebar(): HTMLElement {
        const group = document.createElement('adw-preferences-group');
        for (const [title, subtitle, icon] of [
            ['All Mail', '128 messages', 'mail-unread-symbolic'],
            ['Starred', '6 messages', 'starred-symbolic'],
            ['Drafts', '2 messages', 'document-edit-symbolic'],
            ['Archive', '512 messages', 'folder-symbolic'],
        ] as const) {
            const row = document.createElement('adw-action-row');
            row.setAttribute('title', title);
            row.setAttribute('subtitle', subtitle);
            row.setAttribute('activatable', '');

            const image = document.createElement('span');
            image.setAttribute('slot', 'prefix');
            image.className = iconClass(icon);
            row.appendChild(image);

            group.appendChild(row);
        }

        const header = document.createElement('adw-header-bar');
        header.setAttribute('slot', 'top');
        const title = document.createElement('adw-window-title');
        title.setAttribute('slot', 'center');
        title.setAttribute('title', 'Mailboxes');
        header.appendChild(title);

        const toolbarView = document.createElement('adw-toolbar-view');
        toolbarView.setAttribute('slot', 'sidebar');
        toolbarView.append(header, group);
        return toolbarView;
    }

    /** A status page inside a toolbar view — the content page. */
    private buildContent(): HTMLElement {
        const status = document.createElement('adw-status-page');
        status.setAttribute('icon', 'mail-unread-symbolic');
        status.setAttribute('title', 'All Mail');
        status.setAttribute('description', 'Select a conversation from the list to read it here.');

        const header = document.createElement('adw-header-bar');
        header.setAttribute('slot', 'top');
        const title = document.createElement('adw-window-title');
        title.setAttribute('slot', 'center');
        title.setAttribute('title', 'All Mail');
        header.appendChild(title);

        const toolbarView = document.createElement('adw-toolbar-view');
        toolbarView.setAttribute('slot', 'content');
        toolbarView.append(header, status);
        return toolbarView;
    }

    initialize(): void {
        this._view = document.createElement('adw-navigation-split-view');
        this._view.style.width = '480px';
        this._view.style.height = '340px';
        this._view.append(this.buildSidebar(), this.buildContent());

        this._sync();
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._view) return;
        this._view.toggleAttribute('show-content', this.args.showContent as boolean);
        this._view.toggleAttribute('collapsed', this.args.collapsed as boolean);
    }
}

export const NavigationSplitViewWebStories: WebStoryModule = { stories: [NavigationSplitViewWebStory] };
