// Gtk.HeaderBar — GTK's own titlebar widget, with its three children, its derived title
// label and the two window-control groups it creates.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { gtkHeaderBarMeta } from './gtk-header-bar.meta.js';

/** Story: a Gtk.HeaderBar inside a Gtk.Window, with args driving layout and decorations. */
export class HeaderBarStory extends StoryWidget {
    private _bar: Gtk.HeaderBar | null = null;
    private _titleLabel: Gtk.Label | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookHeaderBar' }, HeaderBarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(HeaderBarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...gtkHeaderBarMeta, component: Gtk.HeaderBar.$gtype };
    }

    initialize(): void {
        this._bar = new Gtk.HeaderBar();

        // `pack_end` PREPENDS (gtkheaderbar.c:843-861), so the order below is the order the
        // buttons read in from the edge inwards: search, then the primary menu.
        const menu = new Gtk.Button({ icon_name: 'open-menu-symbolic' });
        menu.add_css_class('flat');
        this._bar.pack_end(menu);
        const search = new Gtk.Button({ icon_name: 'system-search-symbolic' });
        search.add_css_class('flat');
        this._bar.pack_end(search);

        const back = new Gtk.Button({ label: '‹' });
        back.add_css_class('flat');
        this._bar.pack_start(back);

        this._titleLabel = new Gtk.Label({ label: 'Mailboxes', css_classes: ['title'] });

        this.addContent(this._bar);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bar) return;
        this._bar.decoration_layout = this.args.decorationLayout as string;
        this._bar.show_title_buttons = this.args.showTitleButtons as boolean;
        // The either/or of `gtk_header_bar_set_title_widget` (gtkheaderbar.c:313-341): the
        // centre bin goes empty for the widget, and NULL hands the derived label back.
        if ((this.args.titleWidget as string) === 'custom') this._bar.title_widget = this._titleLabel;
        else this._bar.title_widget = null;
    }
}

GObject.type_ensure(HeaderBarStory.$gtype);

export const HeaderBarStories: StoryModule = { stories: [HeaderBarStory] };
