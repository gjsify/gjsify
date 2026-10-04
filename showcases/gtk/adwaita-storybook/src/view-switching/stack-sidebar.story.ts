// Gtk.StackSidebar — a list of a Gtk.Stack's pages beside the stack itself.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { STACK_SIDEBAR_PAGES, stackSidebarMeta } from './stack-sidebar.meta.js';

/** The nicks this story offers, as the C enum members they name (gtkstack.c:95-121). */
const TRANSITIONS: Readonly<Record<string, Gtk.StackTransitionType>> = {
    none: Gtk.StackTransitionType.NONE,
    crossfade: Gtk.StackTransitionType.CROSSFADE,
    'slide-left-right': Gtk.StackTransitionType.SLIDE_LEFT_RIGHT,
};

/** Story: a four-page Gtk.Stack with a Gtk.StackSidebar down its left-hand side. */
export class StackSidebarStory extends StoryWidget {
    private _stack: Gtk.Stack | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookStackSidebar' }, StackSidebarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(StackSidebarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...stackSidebarMeta, component: Gtk.StackSidebar.$gtype };
    }

    initialize(): void {
        this._stack = new Gtk.Stack({ vexpand: true, transitionDuration: 200 });

        for (const page of STACK_SIDEBAR_PAGES) {
            const label = new Gtk.Label({ label: page.body });
            label.add_css_class('title-2');
            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                halign: Gtk.Align.CENTER,
                valign: Gtk.Align.CENTER,
                spacing: 6,
            });
            box.append(new Gtk.Label({ label: page.title || page.name, cssClasses: ['title-4'] }));
            box.append(label);

            // The last page carries an icon and NO title, which is the page a sidebar row
            // cannot represent: `update_row` reads title, needs-attention and visible, and
            // never `icon-name` (gtkstacksidebar.c:178-184).
            const info = this._stack.add_titled(box, page.name, page.title);
            info.icon_name = page.icon;
            info.needs_attention = page.attn;
            info.use_underline = true;
        }

        const sidebar = new Gtk.StackSidebar({ stack: this._stack });

        // The pane a sidebar belongs in, which is where GTK puts one too.
        const pane = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
        pane.append(sidebar);

        const root = new Gtk.Paned({ orientation: Gtk.Orientation.HORIZONTAL, widthRequest: 480, heightRequest: 320 });
        root.set_start_child(pane);
        root.set_end_child(this._stack);
        root.set_position(180);

        this._apply();
        this.addContent(root);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._stack) return;
        // `transition-type` FIRST: a new type is what `set_visible_child` consults when
        // it resolves a two-way nick (gtkstack.c:1546-1561).
        this._stack.transition_type = TRANSITIONS[this.args.transitionType as string] ?? Gtk.StackTransitionType.NONE;
    }
}

GObject.type_ensure(StackSidebarStory.$gtype);

export const StackSidebarStories: StoryModule = { stories: [StackSidebarStory] };
