// Gtk.PasswordEntry — the masked field, its peek button and its Caps Lock warning.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { passwordEntryMeta } from './password-entry.meta.js';

/**
 * Story: a Gtk.PasswordEntry with its peek button, its placeholder and its sensitivity.
 *
 * The two states a reader cannot reach from a control are reached from the keyboard and the
 * mouse instead, which is where they live in C as well: the reveal is the peek button
 * (`gtk_password_entry_toggle_peek`) and the Caps Lock warning is read off the device
 * (`gdk_device_get_caps_lock_state`), with no `Gtk.PasswordEntry` property behind either.
 */
export class PasswordEntryStory extends StoryWidget {
    private _entry: Gtk.PasswordEntry | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookPasswordEntry' }, PasswordEntryStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(PasswordEntryStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...passwordEntryMeta, component: Gtk.PasswordEntry.$gtype };
    }

    initialize(): void {
        this._entry = new Gtk.PasswordEntry({ showPeekIcon: true, widthRequest: 240, halign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._entry);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._entry) return;
        this._entry.show_peek_icon = this.args.showPeekIcon as boolean;
        this._entry.placeholder_text = this.args.placeholderText as string;
        // `sensitive`, not `editable`: a sensitive widget greys out, which is what the
        // browser rendering spells `disabled` — the same divergence the Entry story records.
        this._entry.sensitive = !(this.args.disabled as boolean);
    }
}

GObject.type_ensure(PasswordEntryStory.$gtype);

export const PasswordEntryStories: StoryModule = { stories: [PasswordEntryStory] };
