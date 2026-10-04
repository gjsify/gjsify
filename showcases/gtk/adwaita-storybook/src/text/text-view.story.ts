// Gtk.TextView — the multi-line editor, its Pango layout properties and the buffer's text.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { textViewMeta } from './text-view.meta.js';

/** Story: a Gtk.TextView in a scrolled window, its buffer and layout properties bound to args. */
export class TextViewStory extends StoryWidget {
    private _buffer: Gtk.TextBuffer | null = null;
    private _view: Gtk.TextView | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookTextView' }, TextViewStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(TextViewStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...textViewMeta, component: Gtk.TextView.$gtype };
    }

    initialize(): void {
        // The text is the BUFFER's, not a property of the view's — which is why the browser
        // element takes its text from its light DOM and why this block is refused a static tree.
        this._buffer = new Gtk.TextBuffer();
        this._view = new Gtk.TextView({
            buffer: this._buffer,
            hexpand: true,
            vexpand: false,
            top_margin: 6,
        });
        const scroller = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            hexpand: true,
            vexpand: false,
            child: this._view,
        });
        scroller.set_size_request(320, -1);
        this._apply();
        this.addContent(scroller);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._buffer || !this._view) return;
        const text = this.args.text as string;
        if (this._buffer.text !== text) {
            this._buffer.text = text;
        }
        this._view.wrap_mode = (this.args.wrapMode ?? 'none') as Gtk.WrapMode;
        this._view.justification = (this.args.justification ?? 'left') as Gtk.Justification;
        this._view.monospace = this.args.monospace as boolean;
        this._view.accepts_tab = this.args.acceptsTab as boolean;
        this._view.cursor_visible = this.args.cursorVisible as boolean;
        this._view.top_margin = Number(this.args.topMargin ?? 0);
    }
}

GObject.type_ensure(TextViewStory.$gtype);

export const TextViewStories: StoryModule = { stories: [TextViewStory] };
