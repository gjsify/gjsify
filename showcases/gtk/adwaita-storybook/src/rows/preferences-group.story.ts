// Adw.PreferencesGroup — the boxed-list container itself: a titled group with a
// description, a header-suffix button and a set of mixed rows. original
// implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { preferencesGroupMeta } from './preferences-group.meta.js';

/** Story: Adw.PreferencesGroup wrapping several rows, with a header-suffix button. */
export class PreferencesGroupStory extends StoryWidget {
    private _prefsGroup: Adw.PreferencesGroup | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookPreferencesGroup' }, PreferencesGroupStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(PreferencesGroupStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...preferencesGroupMeta, component: Adw.PreferencesGroup.$gtype };
    }

    initialize(): void {
        const headerButton = new Gtk.Button({ label: 'Sign out', valign: Gtk.Align.CENTER });
        headerButton.add_css_class('flat');

        this._prefsGroup = new Adw.PreferencesGroup({
            title: this.args.title as string,
            description: this.args.description as string,
            headerSuffix: headerButton,
        });

        const nameRow = new Adw.EntryRow({ title: 'Display name', text: 'Grace Hopper' });
        this._prefsGroup.add(nameRow);

        const syncRow = new Adw.SwitchRow({
            title: 'Sync over Wi-Fi only',
            subtitle: 'Avoid using mobile data for backups',
            active: true,
        });
        this._prefsGroup.add(syncRow);

        const regionRow = new Adw.ComboRow({
            title: 'Region',
            model: new Gtk.StringList({ strings: ['Europe', 'Americas', 'Asia', 'Oceania'] }),
            selected: 0,
        });
        this._prefsGroup.add(regionRow);

        const clamp = new Adw.Clamp({ maximumSize: 400, child: this._prefsGroup });
        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._prefsGroup) return;
        this._prefsGroup.title = this.args.title as string;
        this._prefsGroup.description = this.args.description as string;
    }
}

GObject.type_ensure(PreferencesGroupStory.$gtype);

export const PreferencesGroupStories: StoryModule = { stories: [PreferencesGroupStory] };
