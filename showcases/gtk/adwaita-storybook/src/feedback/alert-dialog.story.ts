// Adw.AlertDialog — a modal dialog with a heading, body and a row of responses.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { alertDialogMeta } from './alert-dialog.meta.js';

/** Story: Adw.AlertDialog presented from a button, with cancel/destructive responses. */
export class AlertDialogStory extends StoryWidget {
    private _button: Gtk.Button | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookAlertDialog' }, AlertDialogStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(AlertDialogStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...alertDialogMeta, component: Adw.AlertDialog.$gtype };
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
        const dialog = new Adw.AlertDialog({
            heading: this.args.heading as string,
            body: this.args.body as string,
        });

        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('delete', 'Delete');
        dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');

        dialog.present(this);
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }
}

GObject.type_ensure(AlertDialogStory.$gtype);

export const AlertDialogStories: StoryModule = { stories: [AlertDialogStory] };
