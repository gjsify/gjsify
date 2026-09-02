// Adw.ViewSwitcher — a tab-style switcher driving an Adw.ViewStack of pages.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { viewSwitcherMeta } from './view-switcher.meta.js';

/** Story: Adw.ViewSwitcher mounted above an Adw.ViewStack with three pages. */
export class ViewSwitcherStory extends StoryWidget {
    private _switcher: Adw.ViewSwitcher | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookViewSwitcher' }, ViewSwitcherStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ViewSwitcherStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...viewSwitcherMeta, component: Adw.ViewSwitcher.$gtype };
    }

    private buildPage(title: string, icon: string, body: string): Gtk.Widget {
        const status = new Adw.StatusPage({
            iconName: icon,
            title,
            description: body,
            vexpand: true,
        });
        return status;
    }

    initialize(): void {
        const stack = new Adw.ViewStack({ vexpand: true });
        stack.add_titled_with_icon(
            this.buildPage('Inbox', 'mail-unread-symbolic', 'You have three unread conversations.'),
            'inbox',
            'Inbox',
            'mail-unread-symbolic',
        );
        stack.add_titled_with_icon(
            this.buildPage('Starred', 'starred-symbolic', 'Messages you have marked as important.'),
            'starred',
            'Starred',
            'starred-symbolic',
        );
        stack.add_titled_with_icon(
            this.buildPage('Archive', 'folder-symbolic', 'Older conversations kept for reference.'),
            'archive',
            'Archive',
            'folder-symbolic',
        );

        this._switcher = new Adw.ViewSwitcher({
            stack,
            policy: this.policyFromArg(this.args.policy as string),
            halign: Gtk.Align.CENTER,
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            widthRequest: 480,
            heightRequest: 340,
        });
        box.append(this._switcher);
        box.append(stack);

        this.addContent(box);
    }

    private policyFromArg(value: string): Adw.ViewSwitcherPolicy {
        return value === 'narrow' ? Adw.ViewSwitcherPolicy.NARROW : Adw.ViewSwitcherPolicy.WIDE;
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._switcher) return;
        this._switcher.policy = this.policyFromArg(this.args.policy as string);
    }
}

GObject.type_ensure(ViewSwitcherStory.$gtype);

export const ViewSwitcherStories: StoryModule = { stories: [ViewSwitcherStory] };
