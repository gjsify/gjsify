// Gtk.Scrollbar — one adjustment, drawn as a trough and a slider.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { scrollbarMeta } from './scrollbar.meta.js';

/** Story: a Gtk.Scrollbar over one adjustment, with every adjustment field bound to args. */
export class ScrollbarStory extends StoryWidget {
    private _scrollbar: Gtk.Scrollbar | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookScrollbar' }, ScrollbarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ScrollbarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...scrollbarMeta, component: Gtk.Scrollbar.$gtype };
    }

    initialize(): void {
        // `GtkScrollbar` has no adjustment of its own — unlike `GtkRange`, it makes none — so
        // the construct bag is where one arrives (gtkscrollbar.c:409-420).
        this._scrollbar = new Gtk.Scrollbar({
            adjustment: new Gtk.Adjustment({ step_increment: 10, page_increment: 80 }),
        });
        this._apply();
        this.addContent(this._scrollbar);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        const scrollbar = this._scrollbar;
        if (!scrollbar) return;
        scrollbar.orientation =
            (this.args.orientation as string) === 'horizontal' ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL;
        const adjustment = scrollbar.get_adjustment();
        if (!adjustment) return;
        // `configure` is all six at once, "so that the change notifications are compressed into
        // one" — the GIR's own sentence for the method the C prefers over the setters.
        adjustment.configure(
            Number(this.args.value),
            0,
            Number(this.args.upper),
            adjustment.step_increment,
            adjustment.page_increment,
            Number(this.args.pageSize),
        );
    }
}

GObject.type_ensure(ScrollbarStory.$gtype);

export const ScrollbarStories: StoryModule = { stories: [ScrollbarStory] };
