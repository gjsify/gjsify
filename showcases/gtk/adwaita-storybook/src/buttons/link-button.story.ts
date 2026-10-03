// Gtk.LinkButton — a button that follows a URI.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { linkButtonMeta } from './link-button.meta.js';

/** Story: a Gtk.LinkButton with its label, URI and visited state bound to args. */
export class LinkButtonStory extends StoryWidget {
    private _button: Gtk.LinkButton | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookLinkButton' }, LinkButtonStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(LinkButtonStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...linkButtonMeta, component: Gtk.LinkButton.$gtype };
    }

    initialize(): void {
        this._button = new Gtk.LinkButton({ halign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._button);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._button) return;
        const label = this.args.label as string;
        this._button.label = label;
        // `uri` last, because `gtk_link_button_set_uri()` unsets `visited` as a side effect
        // — writing the two the other way round would never show a visited link.
        this._button.uri = this.args.uri as string;
        this._button.visited = this.args.visited as boolean;
    }
}

GObject.type_ensure(LinkButtonStory.$gtype);

export const LinkButtonStories: StoryModule = { stories: [LinkButtonStory] };
