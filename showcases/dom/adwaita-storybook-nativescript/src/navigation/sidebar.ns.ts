// NativeScript port of the Sidebar story. Shares metadata with the GTK
// sidebar.story.ts and browser sidebar.web.ts (imported from the GTK showcase's
// renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwSidebar, AdwStatusPage, NOTIFY_SIDEBAR_SELECTED } from '@gjsify/adwaita-nativescript';
import { mailSendSymbolic } from '@gjsify/adwaita-icons/actions';
import { folderSymbolic } from '@gjsify/adwaita-icons/places';
import { mailUnreadSymbolic, starredSymbolic } from '@gjsify/adwaita-icons/status';
import { GridLayout, ItemSpec } from '@nativescript/core';
import { sidebarMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class SidebarNsStory extends StoryView {
    private _sidebar: AdwSidebar | null = null;
    private _status: AdwStatusPage | null = null;

    private readonly items: readonly { title: string; subtitle: string; icon: string }[] = [
        { title: 'Inbox', subtitle: '3 unread', icon: mailUnreadSymbolic },
        { title: 'Starred', subtitle: 'Favourites', icon: starredSymbolic },
        { title: 'Sent', subtitle: 'Outgoing mail', icon: mailSendSymbolic },
        { title: 'Archive', subtitle: 'Older mail', icon: folderSymbolic },
    ];

    constructor() {
        super(SidebarNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return sidebarMeta;
    }

    initialize(): void {
        this._sidebar = new AdwSidebar();
        // NS AdwSidebar takes a flat label list (no per-item subtitle/icon slot in
        // this surface), so the row labels carry just the item title.
        this._sidebar.setItems(this.items.map((entry) => entry.title));
        this._sidebar.selected = this.args.selected as number;
        this._sidebar.width = 220;
        this._sidebar.addEventListener(NOTIFY_SIDEBAR_SELECTED, () => this._syncContent());

        this._status = new AdwStatusPage();

        // The native story frames the sidebar beside the content in a 480×340 box.
        const box = new GridLayout();
        box.width = 480;
        box.height = 340;
        box.addRow(new ItemSpec(1, 'star'));
        box.addColumn(new ItemSpec(1, 'auto'));
        box.addColumn(new ItemSpec(1, 'star'));

        GridLayout.setColumn(this._sidebar, 0);
        box.addChild(this._sidebar);
        GridLayout.setColumn(this._status, 1);
        box.addChild(this._status);

        this._syncContent();
        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._sidebar) return;
        // The `mode` arg (sidebar/page) has no NS equivalent — AdwSidebar has no
        // mode switch in this surface, so only the selection is live-bound. Read it
        // so the control stays bound to this rendering too.
        void (this.args.mode as string);
        this._sidebar.selected = this.args.selected as number;
        this._syncContent();
    }

    private _syncContent(): void {
        if (!this._sidebar || !this._status) return;
        const item = this.items[this._sidebar.selected] ?? this.items[0];
        this._status.icon = item.icon;
        this._status.title = item.title;
        this._status.description = item.subtitle;
    }
}

export const SidebarNsStories: NsStoryModule = { stories: [SidebarNsStory] };
