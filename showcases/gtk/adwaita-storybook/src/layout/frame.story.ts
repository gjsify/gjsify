// Gtk.Frame — a 1px border with a label in its top edge.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { frameMeta } from './frame.meta.js';

/** Story: a Gtk.Frame with its label text and label alignment bound to args. */
export class FrameStory extends StoryWidget {
    private _frame: Gtk.Frame | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookFrame' }, FrameStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(FrameStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...frameMeta, component: Gtk.Frame.$gtype };
    }

    initialize(): void {
        this._frame = new Gtk.Frame({ halign: Gtk.Align.CENTER });
        const body = new Gtk.Label({ label: 'A framed region: the label sits in the top edge of the border.' });
        body.set_margin_top(12);
        body.set_margin_bottom(12);
        body.set_margin_start(12);
        body.set_margin_end(12);
        this._frame.set_child(body);
        this._apply();
        this.addContent(this._frame);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._frame) return;
        this._frame.label = this.args.label as string;
        // `gtk_frame_set_label_align` clamps to 0…1, exactly as the pspec does.
        this._frame.set_label_align(this.args.labelXalign as number);
    }
}

GObject.type_ensure(FrameStory.$gtype);

export const FrameStories: StoryModule = { stories: [FrameStory] };
