// Adw.InlineViewSwitcher — a compact, toolbar-friendly switcher for an Adw.ViewStack.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { inlineViewSwitcherMeta } from './inline-view-switcher.meta.js';

/** Story: Adw.InlineViewSwitcher driving an Adw.ViewStack of three pages. */
export class InlineViewSwitcherStory extends StoryWidget {
    private _switcher: Adw.InlineViewSwitcher | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookInlineViewSwitcher' }, InlineViewSwitcherStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(InlineViewSwitcherStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...inlineViewSwitcherMeta, component: Adw.InlineViewSwitcher.$gtype };
    }

    private buildPage(title: string, icon: string, body: string): Gtk.Widget {
        return new Adw.StatusPage({
            iconName: icon,
            title,
            description: body,
            vexpand: true,
        });
    }

    initialize(): void {
        const stack = new Adw.ViewStack({ vexpand: true });
        stack.add_titled_with_icon(
            this.buildPage('Overview', 'view-grid-symbolic', 'A quick summary of your project.'),
            'overview',
            'Overview',
            'view-grid-symbolic',
        );
        stack.add_titled_with_icon(
            this.buildPage('Activity', 'document-edit-symbolic', 'Recent edits and changes.'),
            'activity',
            'Activity',
            'document-edit-symbolic',
        );
        stack.add_titled_with_icon(
            this.buildPage('Settings', 'emblem-system-symbolic', 'Configure how things behave.'),
            'settings',
            'Settings',
            'emblem-system-symbolic',
        );

        this._switcher = new Adw.InlineViewSwitcher({
            stack,
            displayMode: this.modeFromArg(this.args.displayMode as string),
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

    private modeFromArg(value: string): Adw.InlineViewSwitcherDisplayMode {
        if (value === 'labels') return Adw.InlineViewSwitcherDisplayMode.LABELS;
        if (value === 'icons') return Adw.InlineViewSwitcherDisplayMode.ICONS;
        return Adw.InlineViewSwitcherDisplayMode.BOTH;
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._switcher) return;
        this._switcher.displayMode = this.modeFromArg(this.args.displayMode as string);
    }
}

GObject.type_ensure(InlineViewSwitcherStory.$gtype);

export const InlineViewSwitcherStories: StoryModule = { stories: [InlineViewSwitcherStory] };
