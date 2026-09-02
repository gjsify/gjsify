// Adw.Sidebar — a selectable navigation sidebar built from sections of items.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { sidebarMeta } from './sidebar.meta.js';

/** Story: Adw.Sidebar with a titled Adw.SidebarSection driving a content pane. */
export class SidebarStory extends StoryWidget {
    private _sidebar: Adw.Sidebar | null = null;
    private _status: Adw.StatusPage | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookSidebar' }, SidebarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(SidebarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...sidebarMeta, component: Adw.Sidebar.$gtype };
    }

    private readonly items: readonly { title: string; subtitle: string; icon: string }[] = [
        { title: 'Inbox', subtitle: '3 unread', icon: 'mail-unread-symbolic' },
        { title: 'Starred', subtitle: 'Favourites', icon: 'starred-symbolic' },
        { title: 'Sent', subtitle: 'Outgoing mail', icon: 'mail-send-symbolic' },
        { title: 'Archive', subtitle: 'Older mail', icon: 'folder-symbolic' },
    ];

    private modeFromArg(value: string): Adw.SidebarMode {
        return value === 'page' ? Adw.SidebarMode.PAGE : Adw.SidebarMode.SIDEBAR;
    }

    private syncContent(): void {
        if (!this._sidebar || !this._status) return;
        const item = this.items[this._sidebar.selected] ?? this.items[0];
        this._status.title = item.title;
        this._status.iconName = item.icon;
        this._status.description = item.subtitle;
    }

    initialize(): void {
        const section = new Adw.SidebarSection({ title: 'Mailboxes' });
        for (const entry of this.items) {
            section.append(new Adw.SidebarItem({ title: entry.title, subtitle: entry.subtitle, iconName: entry.icon }));
        }

        this._sidebar = new Adw.Sidebar({
            mode: this.modeFromArg(this.args.mode as string),
            selected: this.args.selected as number,
            widthRequest: 220,
        });
        this._sidebar.append(section);
        this._sidebar.connect('notify::selected', () => this.syncContent());

        this._status = new Adw.StatusPage({ hexpand: true, vexpand: true });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            widthRequest: 480,
            heightRequest: 340,
        });
        box.append(this._sidebar);
        box.append(new Gtk.Separator({ orientation: Gtk.Orientation.VERTICAL }));
        box.append(this._status);

        this.syncContent();
        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._sidebar) return;
        this._sidebar.mode = this.modeFromArg(this.args.mode as string);
        this._sidebar.selected = this.args.selected as number;
        this.syncContent();
    }
}

GObject.type_ensure(SidebarStory.$gtype);

export const SidebarStories: StoryModule = { stories: [SidebarStory] };
