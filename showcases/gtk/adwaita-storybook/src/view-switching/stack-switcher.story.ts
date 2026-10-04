// Gtk.StackSwitcher — a linked row of toggle buttons switching over a Gtk.Stack.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { STACK_SWITCHER_PAGES, stackSwitcherMeta } from './stack-switcher.meta.js';

/** The nicks this story offers, as the C enum members they name (gtkstack.c:95-121). */
const TRANSITIONS: Readonly<Record<string, Gtk.StackTransitionType>> = {
    none: Gtk.StackTransitionType.NONE,
    crossfade: Gtk.StackTransitionType.CROSSFADE,
    'slide-left-right': Gtk.StackTransitionType.SLIDE_LEFT_RIGHT,
};

/** Story: a four-page Gtk.Stack under a Gtk.StackSwitcher, covering both button shapes. */
export class StackSwitcherStory extends StoryWidget {
    private _stack: Gtk.Stack | null = null;
    private _switcher: Gtk.StackSwitcher | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookStackSwitcher' }, StackSwitcherStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(StackSwitcherStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...stackSwitcherMeta, component: Gtk.StackSwitcher.$gtype };
    }

    initialize(): void {
        this._stack = new Gtk.Stack({ vexpand: true, transitionDuration: 200 });

        for (const page of STACK_SWITCHER_PAGES) {
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

            // The four shapes `rebuild_child` and `update_row` branch on
            // (gtkstackswitcher.c:137-207): title + icon, title only, icon only, and
            // the last page with `needs-attention`.
            if (page.icon) {
                const info = this._stack.add_titled(box, page.name, page.title);
                info.icon_name = page.icon;
                info.needs_attention = page.attn;
                info.use_underline = true;
            } else {
                const info = this._stack.add_titled(box, page.name, page.title);
                info.needs_attention = page.attn;
                info.use_underline = true;
            }
        }

        this._switcher = new Gtk.StackSwitcher({ stack: this._stack, halign: Gtk.Align.CENTER });

        const root = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            widthRequest: 480,
            heightRequest: 320,
        });
        root.append(this._switcher);
        root.append(this._stack);

        this._apply();
        this.addContent(root);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._stack || !this._switcher) return;
        // `transition-type` FIRST: a new type is what `set_visible_child` consults when
        // it resolves a two-way nick (gtkstack.c:1546-1561).
        this._stack.transition_type = TRANSITIONS[this.args.transitionType as string] ?? Gtk.StackTransitionType.NONE;
        // `GtkStackSwitcher` is a GtkOrientable (gtkstackswitcher.c:47).
        this._switcher.orientation =
            (this.args.orientation as string) === 'vertical' ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL;
    }
}

GObject.type_ensure(StackSwitcherStory.$gtype);

export const StackSwitcherStories: StoryModule = { stories: [StackSwitcherStory] };
