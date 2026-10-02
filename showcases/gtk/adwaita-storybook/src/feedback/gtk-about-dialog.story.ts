// Gtk.AboutDialog — GTK's own about window, presented from a button.
//
// The page-visibility rules are the story's subject: `license-type` picks which licence
// text is on the main page and whether the License page exists at all, and `withCredits`
// decides the third page and the switcher.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { gtkAboutDialogMeta } from './gtk-about-dialog.meta.js';

/** The `Gtk.License` nicks the control offers, in enum order. */
const LICENSES: Record<string, Gtk.License> = {
    unknown: Gtk.License.UNKNOWN,
    custom: Gtk.License.CUSTOM,
    'gpl-3-0': Gtk.License.GPL_3_0,
    'mit-x11': Gtk.License.MIT_X11,
    'bsd-3': Gtk.License.BSD_3,
    'apache-2-0': Gtk.License.APACHE_2_0,
    '0bsd': Gtk.License['0BSD'],
};

/** Story: Gtk.AboutDialog presented from a button, with a licence type and credits. */
export class GtkAboutDialogStory extends StoryWidget {
    private _button: Gtk.Button | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookGtkAboutDialog' }, GtkAboutDialogStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(GtkAboutDialogStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...gtkAboutDialogMeta, component: Gtk.AboutDialog.$gtype };
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
        const dialog = new Gtk.AboutDialog({
            programName: this.args.programName as string,
            version: this.args.version as string,
            logoIconName: 'application-x-executable-symbolic',
            comments: 'An arithmetic calculator for the GNOME desktop.',
            website: 'https://gitlab.gnome.org/World/gnome-calculator',
            websiteLabel: 'GNOME Calculator',
            copyright: '© 2026 The GNOME Project',
            systemInformation: 'GTK 4.24.0\nglibc 2.42\nBuilt with meson 1.6',
        });

        const licenseType = LICENSES[this.args.licenseType as string] ?? Gtk.License.UNKNOWN;
        if (licenseType === Gtk.License.CUSTOM) {
            // A CUSTOM licence is the only one whose text the :license property supplies —
            // set_license_type overwrites it for every other type (gtkaboutdialog.c:2259).
            dialog.set_license('Permission is hereby granted, free of charge, to any person obtaining a copy…');
        }
        dialog.set_license_type(licenseType);

        if (this.args.withCredits as boolean) {
            dialog.set_authors(['Ada Lovelace <ada@example.org>', 'Grace Hopper']);
            dialog.set_documenters(['Barbara Liskov']);
            dialog.set_artists(['Margaret Hamilton']);
            dialog.set_translator_credits('Alan Turing\nKatherine Johnson');
            dialog.add_credit_section('Reviewed by', ['Tony Hoare <tony@example.org>']);
        }

        dialog.present();
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }
}

GObject.type_ensure(GtkAboutDialogStory.$gtype);

export const GtkAboutDialogStories: StoryModule = { stories: [GtkAboutDialogStory] };
