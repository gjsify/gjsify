// Gtk.Stack — one visible child out of many, animated, with a Gtk.StackSwitcher on top.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { STACK_PAGES, stackMeta } from './stack.meta.js';

/**
 * The GIR nicks this story offers, as the C enum members they name. A nick with no member
 * here is `none`, which is also the property's default (gtkstack.c:1038-1044).
 */
const TRANSITIONS: Readonly<Record<string, Gtk.StackTransitionType>> = {
    none: Gtk.StackTransitionType.NONE,
    crossfade: Gtk.StackTransitionType.CROSSFADE,
    'slide-left-right': Gtk.StackTransitionType.SLIDE_LEFT_RIGHT,
    'slide-up-down': Gtk.StackTransitionType.SLIDE_UP_DOWN,
    'over-left-right': Gtk.StackTransitionType.OVER_LEFT_RIGHT,
    'rotate-left-right': Gtk.StackTransitionType.ROTATE_LEFT_RIGHT,
};

/** Story: a Gtk.Stack of three pages under a Gtk.StackSwitcher. */
export class StackStory extends StoryWidget {
    private _stack: Gtk.Stack | null = null;
    private _switcher: Gtk.StackSwitcher | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookStack' }, StackStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(StackStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...stackMeta, component: Gtk.Stack.$gtype };
    }

    initialize(): void {
        this._stack = new Gtk.Stack({ vexpand: true, transitionDuration: 200 });

        for (const page of STACK_PAGES) {
            const label = new Gtk.Label({ label: page.body, vexpand: true });
            label.add_css_class('title-2');
            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                halign: Gtk.Align.CENTER,
                valign: Gtk.Align.CENTER,
                spacing: 6,
            });
            box.append(new Gtk.Label({ label: page.title, cssClasses: ['title-4'] }));
            box.append(label);
            // `add_titled` is the C's own three-argument form (gtkstack.c:1644-1663); the
            // page's `needs-attention` is set afterwards because it is a page PROPERTY,
            // not an argument.
            const info = this._stack.add_titled(box, page.name, page.title);
            info.needs_attention = page.attn;
            info.use_underline = true;
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
        if (!this._stack) return;
        // The ORDER is the C's own: `transition-type` FIRST, because a new type is what
        // `set_visible_child` consults when it resolves a two-way nick through
        // `get_simple_transition_type` (gtkstack.c:1546-1561).
        this._stack.transition_type = TRANSITIONS[this.args.transitionType as string] ?? Gtk.StackTransitionType.NONE;
        this._stack.transition_duration = this.args.transitionDuration as number;
        this._stack.interpolate_size = this.args.interpolateSize as boolean;
        this._stack.hhomogeneous = this.args.hhomogeneous as boolean;
        this._stack.vhomogeneous = this.args.vhomogeneous as boolean;
    }
}

GObject.type_ensure(StackStory.$gtype);

export const StackStories: StoryModule = { stories: [StackStory] };
