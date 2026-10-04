// Gtk.ScrolledWindow — a tall column in a window that scrolls it.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { scrolledWindowMeta } from './scrolled-window.meta.js';

/** `GtkPolicyType`'s four nicks as the constants, and `GtkCornerType`'s four. */
const POLICIES: Record<string, Gtk.PolicyType> = {
    automatic: Gtk.PolicyType.AUTOMATIC,
    always: Gtk.PolicyType.ALWAYS,
    never: Gtk.PolicyType.NEVER,
};
const PLACEMENTS: Record<string, Gtk.CornerType> = {
    'top-left': Gtk.CornerType.TOP_LEFT,
    'top-right': Gtk.CornerType.TOP_RIGHT,
    'bottom-left': Gtk.CornerType.BOTTOM_LEFT,
    'bottom-right': Gtk.CornerType.BOTTOM_RIGHT,
};

/** Story: a Gtk.ScrolledWindow over a column of labels, with every policy bound to args. */
export class ScrolledWindowStory extends StoryWidget {
    private _window: Gtk.ScrolledWindow | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookScrolledWindow' }, ScrolledWindowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ScrolledWindowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...scrolledWindowMeta, component: Gtk.ScrolledWindow.$gtype };
    }

    initialize(): void {
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
        for (let i = 1; i <= 16; i++) {
            box.append(new Gtk.Label({ label: `Row ${i}` }));
        }
        this._window = new Gtk.ScrolledWindow({
            child: box,
            // An allocation, which is what GTK hands this widget and what makes it scroll
            // rather than grow: `min_content_height` is one of the two size requests the C
            // answers with the child's minimum.
            min_content_height: 240,
            halign: Gtk.Align.CENTER,
        });
        this._apply();
        this.addContent(this._window);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        const window = this._window;
        if (!window) return;
        window.set_policy(
            POLICIES[this.args.hPolicy as string] ?? Gtk.PolicyType.AUTOMATIC,
            POLICIES[this.args.vPolicy as string] ?? Gtk.PolicyType.AUTOMATIC,
        );
        window.set_placement(PLACEMENTS[this.args.placement as string] ?? Gtk.CornerType.TOP_LEFT);
        window.has_frame = this.args.frame as boolean;
        window.set_overlay_scrolling(this.args.overlayScrolling as boolean);
    }
}

GObject.type_ensure(ScrolledWindowStory.$gtype);

export const ScrolledWindowStories: StoryModule = { stories: [ScrolledWindowStory] };
