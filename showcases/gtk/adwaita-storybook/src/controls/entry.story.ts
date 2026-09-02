// Gtk.Entry — the single-line text field the Adwaita stylesheet dresses.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { entryMeta } from './entry.meta.js';

/** Story: a Gtk.Entry with placeholder text and an editable toggle. */
export class EntryStory extends StoryWidget {
    private _entry: Gtk.Entry | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookEntry' }, EntryStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(EntryStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...entryMeta, component: Gtk.Entry.$gtype };
    }

    initialize(): void {
        this._entry = new Gtk.Entry({ widthRequest: 280, halign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._entry);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._entry) return;
        this._entry.text = this.args.text as string;
        this._entry.placeholderText = this.args.placeholder as string;
        // `editable` false keeps the entry focusable and selectable, which is what
        // GtkEditable:editable means — NOT `sensitive`, which would grey it out.
        this._entry.editable = this.args.editable as boolean;
    }
}

GObject.type_ensure(EntryStory.$gtype);

export const EntryStories: StoryModule = { stories: [EntryStory] };
