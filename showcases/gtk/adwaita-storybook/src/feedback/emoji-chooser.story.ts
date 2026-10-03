// Gtk.EmojiChooser — the emoji popover a text widget opens, with a search entry.
//
// The story shows the half that is easy to get wrong: the SEARCH. A term matches when it
// prefixes a word of the emoji's name or of one of its keywords, a section with no match at
// all disappears heading and all, and a search that empties every section shows the "No
// Results Found" page instead of the list.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { emojiChooserMeta } from './emoji-chooser.meta.js';

/** Story: an entry with an emoji chooser attached to its prefix button. */
export class EmojiChooserStory extends StoryWidget {
    private _button: Gtk.Button | null = null;
    private _entry: Gtk.Entry | null = null;
    private _chooser: Gtk.EmojiChooser | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookEmojiChooser' }, EmojiChooserStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(EmojiChooserStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...emojiChooserMeta, component: Gtk.EmojiChooser.$gtype };
    }

    initialize(): void {
        this._entry = new Gtk.Entry({
            placeholderText: 'Type a message…',
            halign: Gtk.Align.CENTER,
        });
        this._entry.add_css_class('card');

        this._chooser = Gtk.EmojiChooser.new();
        this._chooser.connect('emoji-picked', (_chooser: Gtk.EmojiChooser, text: string) => {
            if (this._entry === null) return;
            // The signal carries the Unicode SEQUENCE, which is what an entry inserts.
            this._entry.set_text(this._entry.get_text() + text);
        });

        this._button = new Gtk.Button({
            iconName: 'face-smile-symbolic',
            tooltipText: 'Insert an emoji',
            valign: Gtk.Align.CENTER,
        });
        this._button.add_css_class('flat');
        this._button.add_css_class('circular');
        // The popover's anchor is the widget it is a child of, and the button is the entry's
        // prefix — which is the arrangement GtkEntry's own emoji completion uses.
        this._chooser.set_parent(this._button);
        this._entry.add_prefix(this._button);

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        box.appendChild(this._entry);
        this.addContent(box);
        this._applySearch(this.args.search as string);
    }

    /**
     * The chooser's search entry.
     *
     * `GtkEmojiChooser` declares NO properties at all — the search is a `GtkSearchEntry`
     * inside its template (`ui/gtkemojichooser.ui`), not a property of the widget — so the
     * only way to drive it is to find it.
     */
    private _searchEntry(): Gtk.SearchEntry | null {
        let child: Gtk.Widget | null = this._chooser?.get_first_child() ?? null;
        while (child !== null) {
            if (child instanceof Gtk.SearchEntry) return child;
            child = child.get_first_child();
        }
        return null;
    }

    private _applySearch(text: string): void {
        this._searchEntry()?.set_text(text);
    }

    updateArgs(args: StoryArgs): void {
        if (typeof args.search === 'string') this._applySearch(args.search);
    }
}

GObject.type_ensure(EmojiChooserStory.$gtype);

export const EmojiChooserStories: StoryModule = { stories: [EmojiChooserStory] };
