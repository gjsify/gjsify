// Adw.ViewSwitcherSidebar — an Adw.Sidebar driven by an Adw.ViewStack, beside the stack
// it controls. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { VIEW_SWITCHER_SIDEBAR_PAGES, viewSwitcherSidebarMeta } from './view-switcher-sidebar.meta.js';

/** Story: an Adw.ViewSwitcherSidebar with two sections over a six-page Adw.ViewStack. */
export class ViewSwitcherSidebarStory extends StoryWidget {
    private _switcher: Adw.ViewSwitcherSidebar | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookViewSwitcherSidebar' }, ViewSwitcherSidebarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ViewSwitcherSidebarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...viewSwitcherSidebarMeta, component: Adw.ViewSwitcherSidebar.$gtype };
    }

    initialize(): void {
        const stack = new Adw.ViewStack({ vexpand: true });
        for (const spec of VIEW_SWITCHER_SIDEBAR_PAGES) {
            const content = new Adw.StatusPage({
                iconName: spec.icon,
                title: spec.title,
                vexpand: true,
            });
            stack.add_titled(content, spec.name, spec.title);
        }

        // The page properties come BEFORE the switcher exists: `set_stack` populates the
        // sidebar once, and the only signals it later follows are the page list's and the
        // selection's — a section or a badge set afterwards reaches nothing.
        const pages = stack.get_pages();
        for (let i = 0; i < pages.get_n_items(); i++) {
            const page = pages.get_item(i) as Adw.ViewStackPage;
            const spec = VIEW_SWITCHER_SIDEBAR_PAGES.find((candidate) => candidate.name === page.name);
            if (!spec?.sectionTitle) continue;
            page.startsSection = true;
            page.sectionTitle = spec.sectionTitle;
            if (spec.badgeNumber) page.badgeNumber = spec.badgeNumber;
            if (spec.needsAttention) page.needsAttention = true;
        }

        const switcher = new Adw.ViewSwitcherSidebar({ stack });
        this._switcher = switcher;

        const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, widthRequest: 480, heightRequest: 340 });
        box.append(switcher);
        box.append(stack);
        this.addContent(box);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._switcher) return;
        this._switcher.mode = (this.args.mode as boolean) ? Adw.SidebarMode.PAGE : Adw.SidebarMode.SIDEBAR;
    }
}

GObject.type_ensure(ViewSwitcherSidebarStory.$gtype);

export const ViewSwitcherSidebarStories: StoryModule = { stories: [ViewSwitcherSidebarStory] };
