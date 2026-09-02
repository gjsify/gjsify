// Adw.ActionRow — a boxed-list row pairing a title/subtitle with prefix/suffix
// widgets, optionally activatable. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { actionRowMeta } from './action-row.meta.js';

/** Story: Adw.ActionRow with a prefix icon and a suffix button inside a boxed list. */
export class ActionRowStory extends StoryWidget {
    private _row: Adw.ActionRow | null = null;
    private _icon: Gtk.Image | null = null;
    private _button: Gtk.Button | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookActionRow' }, ActionRowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ActionRowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...actionRowMeta, component: Adw.ActionRow.$gtype };
    }

    initialize(): void {
        this._row = new Adw.ActionRow({
            title: this.args.title as string,
            subtitle: this.args.subtitle as string,
        });

        this._icon = new Gtk.Image({ iconName: this.args.iconName as string });
        this._row.add_prefix(this._icon);

        this._button = new Gtk.Button({ iconName: 'go-next-symbolic', valign: Gtk.Align.CENTER });
        this._button.add_css_class('flat');
        this._row.add_suffix(this._button);

        this._row.activatableWidget = this._button;
        this._row.activatable = this.args.activatable as boolean;

        const group = new Adw.PreferencesGroup();
        group.add(this._row);

        const clamp = new Adw.Clamp({ maximumSize: 400, child: group });
        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._row || !this._icon) return;
        this._row.title = this.args.title as string;
        this._row.subtitle = this.args.subtitle as string;
        this._icon.iconName = this.args.iconName as string;
        this._row.activatable = this.args.activatable as boolean;
    }
}

GObject.type_ensure(ActionRowStory.$gtype);

export const ActionRowStories: StoryModule = { stories: [ActionRowStory] };
