// Gtk.AspectFrame — one child, given a shape and a place.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { aspectFrameMeta } from './aspect-frame.meta.js';

/** Story: a Gtk.AspectFrame over a box, with its ratio and both alignments bound to args. */
export class AspectFrameStory extends StoryWidget {
    private _frame: Gtk.AspectFrame | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookAspectFrame' }, AspectFrameStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(AspectFrameStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...aspectFrameMeta, component: Gtk.AspectFrame.$gtype };
    }

    initialize(): void {
        this._frame = new Gtk.AspectFrame({
            hexpand: true,
            valign: Gtk.Align.CENTER,
            width_request: 320,
            height_request: 180,
        });
        const body = new Gtk.Label({
            label: 'The frame gives this child the ratio above, and puts it where xalign and yalign say.',
        });
        body.set_margin_top(12);
        body.set_margin_bottom(12);
        body.set_margin_start(12);
        body.set_margin_end(12);
        body.set_vexpand(true);
        this._frame.set_child(body);
        this._apply();
        this.addContent(this._frame);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._frame) return;
        this._frame.ratio = this.args.ratio as number;
        this._frame.xalign = this.args.xalign as number;
        this._frame.yalign = this.args.yalign as number;
        // TRUE makes the child\'s own ratio win and `ratio` inert — set LAST, so the control
        // order above is the order the story reads it in.
        this._frame.obeyChild = this.args.obeyChild as boolean;
    }
}

GObject.type_ensure(AspectFrameStory.$gtype);

export const AspectFrameStories: StoryModule = { stories: [AspectFrameStory] };
