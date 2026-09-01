// Browser port of the Toolbar View story. Shares metadata with toolbar-view.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { toolbarViewMeta } from '../../layout/toolbar-view.meta.js';

export class ToolbarViewWebStory extends StoryElement {
    private _topBar: HTMLElement | null = null;
    private _bottomBar: HTMLElement | null = null;

    constructor() {
        super(ToolbarViewWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return toolbarViewMeta;
    }

    initialize(): void {
        const view = document.createElement('adw-toolbar-view');
        view.style.width = '460px';
        view.style.height = '320px';

        // Top header bar with a window title (matches Adw.HeaderBar + WindowTitle).
        const header = document.createElement('adw-header-bar');
        header.setAttribute('slot', 'top');
        const title = document.createElement('adw-window-title');
        title.setAttribute('slot', 'center');
        title.setAttribute('title', 'Documents');
        title.setAttribute('subtitle', '12 items');
        header.appendChild(title);
        view.appendChild(header);
        this._topBar = header;

        // Scrollable content — a status page sits between the toolbars.
        const content = document.createElement('adw-status-page');
        content.setAttribute('icon', 'folder-documents');
        content.setAttribute('title', 'Your library');
        content.setAttribute('description', 'Content sits between the toolbars and scrolls independently of them.');
        view.appendChild(content);

        // Bottom action bar — flat start buttons, a centered label and an end button
        // (mirrors the native Gtk.ActionBar with pack_start / center / pack_end).
        const bottomBar = document.createElement('div');
        bottomBar.setAttribute('slot', 'bottom');
        bottomBar.className = 'adw-action-bar';
        bottomBar.style.display = 'flex';
        bottomBar.style.alignItems = 'center';
        bottomBar.style.gap = 'var(--spacing-xs, 6px)';
        bottomBar.style.padding = 'var(--spacing-xs, 6px)';
        bottomBar.style.borderTop = '1px solid var(--separator-color, rgba(0, 0, 0, 0.15))';

        const addButton = document.createElement('gtk-button');
        addButton.setAttribute('icon', 'list-add');
        addButton.setAttribute('flat', '');
        addButton.setAttribute('tooltip', 'Add');

        const removeButton = document.createElement('gtk-button');
        removeButton.setAttribute('icon', 'list-remove');
        removeButton.setAttribute('flat', '');
        removeButton.setAttribute('tooltip', 'Remove');

        const selectionLabel = document.createElement('span');
        selectionLabel.textContent = 'Selection: none';
        selectionLabel.style.flex = '1 1 auto';
        selectionLabel.style.textAlign = 'center';

        const shareButton = document.createElement('gtk-button');
        shareButton.setAttribute('icon', 'send-to');
        shareButton.setAttribute('flat', '');
        shareButton.setAttribute('tooltip', 'Share');

        bottomBar.append(addButton, removeButton, selectionLabel, shareButton);
        view.appendChild(bottomBar);
        this._bottomBar = bottomBar;

        this._sync();
        this.addContent(view);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        // The web toolbar view has no reveal properties; mirror revealTopBars /
        // revealBottomBars by collapsing the top/bottom bars themselves.
        if (this._topBar) this._topBar.hidden = !(this.args.revealTopBars as boolean);
        if (this._bottomBar) this._bottomBar.hidden = !(this.args.revealBottomBars as boolean);
    }
}

export const ToolbarViewWebStories: WebStoryModule = { stories: [ToolbarViewWebStory] };
