// Adw.Dialog — the generic dialog: arbitrary content over a scrim.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { dialogMeta } from './dialog.meta.js';

/**
 * The meta's `presentation` NICK → the enum member, spelled out rather than cast.
 *
 * `Adw.DialogPresentationMode` is a GIR enum and the control carries a string, so
 * `as Adw.DialogPresentationMode` would be a lie the compiler cannot see: it hands the
 * property the string `"bottom-sheet"`. Every renderer of this story reads the SAME
 * nick out of the shared meta, and this table is where GTK turns it back into a number.
 */
const DIALOG_PRESENTATION: Record<string, Adw.DialogPresentationMode> = {
    auto: Adw.DialogPresentationMode.AUTO,
    floating: Adw.DialogPresentationMode.FLOATING,
    'bottom-sheet': Adw.DialogPresentationMode.BOTTOM_SHEET,
};

/** Story: Adw.Dialog presented from a button, holding a preferences page as its child. */
export class DialogStory extends StoryWidget {
    private _button: Gtk.Button | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookDialog' }, DialogStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(DialogStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...dialogMeta, component: Adw.Dialog.$gtype };
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
        // ONE child, and it is a property (`Adw.Dialog:child`), not a pack: this is the
        // dialog the specialised ones are written as subclasses of.
        const group = new Adw.PreferencesGroup({ title: 'Appearance' });
        group.add(new Adw.SwitchRow({ title: 'Dark style', subtitle: 'Use a dark colour scheme', active: true }));

        const page = new Adw.PreferencesPage({ title: 'General' });
        page.add(group);

        const dialog = new Adw.Dialog({
            title: this.args.title as string,
            child: page,
            presentation_mode: DIALOG_PRESENTATION[this.args.presentation as string],
        });

        dialog.present(this);
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }
}

GObject.type_ensure(DialogStory.$gtype);

export const DialogStories: StoryModule = { stories: [DialogStory] };
