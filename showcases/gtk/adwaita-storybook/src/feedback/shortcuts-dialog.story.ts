// Adw.ShortcutsDialog — the window that lists an application's shortcuts.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { shortcutsDialogMeta } from './shortcuts-dialog.meta.js';

/** Story: Adw.ShortcutsDialog presented from a button, with two sections of shortcuts. */
export class ShortcutsDialogStory extends StoryWidget {
    private _button: Gtk.Button | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookShortcutsDialog' }, ShortcutsDialogStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ShortcutsDialogStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...shortcutsDialogMeta, component: Adw.ShortcutsDialog.$gtype };
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
        // SECTIONS ARE GObjects, not widgets: each is added with `add(section)`, and an
        // untitled one is the documented way to subdivide a section into groups.
        const general = new Adw.ShortcutsSection({ title: 'General' });
        general.add(new Adw.ShortcutsItem({ title: 'Open Menu', accelerator: 'F10' }));
        general.add(new Adw.ShortcutsItem({ title: 'Preferences', action_name: 'app.preferences' }));
        general.add(new Adw.ShortcutsItem({ title: 'Quit', accelerator: '<Control>q' }));

        // No title: the section below is a continuation of the one above, which is what
        // the class documents an untitled section for.
        const navigation = new Adw.ShortcutsSection();
        navigation.add(
            new Adw.ShortcutsItem({
                title: 'Move Tab Left',
                accelerator: '<Shift><Control>Page_Up',
                direction: Gtk.TextDirection.LTR,
            }),
        );
        navigation.add(
            new Adw.ShortcutsItem({
                title: 'Move Tab Left',
                accelerator: '<Shift><Control>Page_Up',
                direction: Gtk.TextDirection.RTL,
            }),
        );

        const dialog = new Adw.ShortcutsDialog({ title: this.args.title as string });
        dialog.add(general);
        dialog.add(navigation);

        dialog.present(this);
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }
}

GObject.type_ensure(ShortcutsDialogStory.$gtype);

export const ShortcutsDialogStories: StoryModule = { stories: [ShortcutsDialogStory] };
