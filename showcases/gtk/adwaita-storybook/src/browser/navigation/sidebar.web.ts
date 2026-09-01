// Browser port of the Sidebar story. Shares metadata with sidebar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { sidebarMeta } from '../../navigation/sidebar.meta.js';

export class SidebarWebStory extends StoryElement {
    private _sidebar: HTMLElement | null = null;
    private _status: HTMLElement | null = null;

    private readonly items: readonly { title: string; subtitle: string; icon: string }[] = [
        { title: 'Inbox', subtitle: '3 unread', icon: 'mail-unread-symbolic' },
        { title: 'Starred', subtitle: 'Favourites', icon: 'starred-symbolic' },
        { title: 'Sent', subtitle: 'Outgoing mail', icon: 'mail-send-symbolic' },
        { title: 'Archive', subtitle: 'Older mail', icon: 'folder-symbolic' },
    ];

    constructor() {
        super(SidebarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return sidebarMeta;
    }

    initialize(): void {
        const section = document.createElement('adw-sidebar-section');
        section.setAttribute('title', 'Mailboxes');
        for (const entry of this.items) {
            const item = document.createElement('adw-sidebar-item');
            item.setAttribute('title', entry.title);
            item.setAttribute('subtitle', entry.subtitle);
            item.setAttribute('icon-name', entry.icon);
            section.append(item);
        }

        this._sidebar = document.createElement('adw-sidebar');
        this._sidebar.setAttribute('mode', this.args.mode as string);
        this._sidebar.setAttribute('selected', String(this.args.selected as number));
        this._sidebar.style.width = '220px';
        this._sidebar.append(section);
        this._sidebar.addEventListener('notify::selected', () => this._syncContent());

        this._status = document.createElement('adw-status-page');
        this._status.style.flex = '1 1 auto';

        const box = document.createElement('div');
        box.style.display = 'flex';
        box.style.width = '480px';
        box.style.height = '340px';
        box.style.border = '1px solid var(--card-shade-color)';
        box.style.borderRadius = 'var(--card-radius, 12px)';
        box.style.overflow = 'hidden';

        const separator = document.createElement('div');
        separator.style.width = '1px';
        separator.style.alignSelf = 'stretch';
        separator.style.backgroundColor = 'var(--separator-color, var(--card-shade-color))';

        box.append(this._sidebar, separator, this._status);

        this._syncContent();
        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._sidebar) return;
        this._sidebar.setAttribute('mode', this.args.mode as string);
        this._sidebar.setAttribute('selected', String(this.args.selected as number));
        this._syncContent();
    }

    private _syncContent(): void {
        if (!this._sidebar || !this._status) return;
        const selected = Number((this._sidebar as unknown as { selected: number }).selected);
        const item = this.items[selected] ?? this.items[0];
        this._status.setAttribute('title', item.title);
        // adw-status-page's `icon` attribute is a plain symbolic name (it strips
        // -symbolic and builds the gtk-image class itself).
        this._status.setAttribute('icon', item.icon.replace(/-symbolic$/, ''));
        this._status.setAttribute('description', item.subtitle);
    }
}

export const SidebarWebStories: WebStoryModule = { stories: [SidebarWebStory] };
