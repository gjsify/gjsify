// Adw.AboutDialog — the standard Adwaita "About" window for an application.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { aboutDialogMeta } from './about-dialog.meta.js';

/** Story: Adw.AboutDialog presented from a button, with app metadata + credits. */
export class AboutDialogStory extends StoryWidget {
    private _button: Gtk.Button | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookAboutDialog' }, AboutDialogStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(AboutDialogStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...aboutDialogMeta, component: Adw.AboutDialog.$gtype };
    }

    initialize(): void {
        this._button = new Gtk.Button({
            label: 'Show dialog',
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        this._button.add_css_class('pill');
        this._button.add_css_class('suggested-action');
        this._button.connect('clicked', () => this._present());

        this.addContent(this._button);
    }

    private _present(): void {
        const dialog = new Adw.AboutDialog({
            applicationName: this.args.applicationName as string,
            applicationIcon: 'application-x-executable-symbolic',
            developerName: 'A GJSify Project',
            version: this.args.version as string,
            comments: 'A live catalogue of native GTK and Adwaita widgets, rendered under GJS.',
            website: 'https://github.com/gjsify/gjsify',
            issueUrl: 'https://github.com/gjsify/gjsify/issues',
            licenseType: Gtk.License.MIT_X11,
            developers: ['Ada Lovelace', 'Grace Hopper'],
            designers: ['Margaret Hamilton'],
            copyright: '© 2026 The GJSify Project',
        });

        dialog.present(this);
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }
}

GObject.type_ensure(AboutDialogStory.$gtype);

export const AboutDialogStories: StoryModule = { stories: [AboutDialogStory] };
