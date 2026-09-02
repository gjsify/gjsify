// Adw.ViewSwitcherBar — the narrow-window switcher, pinned to the bottom.
// original implementation.

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { VIEW_SWITCHER_BAR_PAGES, viewSwitcherBarMeta } from './view-switcher-bar.meta.js';

/** Story: an Adw.ViewSwitcherBar at the bottom of a toolbar view, driving its stack. */
export class ViewSwitcherBarStory extends StoryWidget {
    private _bar: Adw.ViewSwitcherBar | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookViewSwitcherBar' }, ViewSwitcherBarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ViewSwitcherBarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...viewSwitcherBarMeta, component: Adw.ViewSwitcherBar.$gtype };
    }

    initialize(): void {
        const stack = new Adw.ViewStack({ vexpand: true });
        for (const page of VIEW_SWITCHER_BAR_PAGES) {
            const status = new Adw.StatusPage({
                iconName: page.icon,
                title: page.title,
                description: `The ${page.title.toLowerCase()} page.`,
                vexpand: true,
            });
            stack.add_titled_with_icon(status, page.name, page.title, page.icon);
        }

        this._bar = new Adw.ViewSwitcherBar({ stack });
        this._apply();

        // The bar belongs at an edge — a toolbar view is where libadwaita puts it,
        // and it is what makes the story show the bar's real position rather than a
        // widget floating in the middle of the preview.
        const view = new Adw.ToolbarView({ content: stack, widthRequest: 360, heightRequest: 360 });
        view.add_bottom_bar(this._bar);

        this.addContent(view);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bar) return;
        this._bar.reveal = this.args.reveal as boolean;
    }
}

GObject.type_ensure(ViewSwitcherBarStory.$gtype);

export const ViewSwitcherBarStories: StoryModule = { stories: [ViewSwitcherBarStory] };
