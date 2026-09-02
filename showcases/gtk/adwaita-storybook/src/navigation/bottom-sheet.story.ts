// Adw.BottomSheet — a content area with a sheet that slides up from the bottom.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { bottomSheetMeta } from './bottom-sheet.meta.js';

/** Story: Adw.BottomSheet with a toggleable sheet child. */
export class BottomSheetStory extends StoryWidget {
    private _sheet: Adw.BottomSheet | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookBottomSheet' }, BottomSheetStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(BottomSheetStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...bottomSheetMeta, component: Adw.BottomSheet.$gtype };
    }

    private buildContent(): Gtk.Widget {
        const toggle = new Gtk.Button({
            label: 'Toggle sheet',
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            vexpand: true,
        });
        toggle.add_css_class('pill');
        toggle.add_css_class('suggested-action');
        toggle.connect('clicked', () => {
            if (this._sheet) this._sheet.open = !this._sheet.open;
        });
        return toggle;
    }

    private buildSheet(): Gtk.Widget {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            marginTop: 18,
            marginBottom: 24,
            marginStart: 18,
            marginEnd: 18,
        });
        box.append(new Gtk.Label({ label: 'Share track', halign: Gtk.Align.START, cssClasses: ['title-2'] }));

        const group = new Adw.PreferencesGroup();
        for (const [title, icon] of [
            ['Copy link', 'edit-copy-symbolic'],
            ['Send to a friend', 'mail-send-symbolic'],
            ['Add to playlist', 'list-add-symbolic'],
        ] as const) {
            const row = new Adw.ActionRow({ title });
            row.add_prefix(new Gtk.Image({ iconName: icon }));
            row.activatable = true;
            group.add(row);
        }
        box.append(group);
        return box;
    }

    initialize(): void {
        this._sheet = new Adw.BottomSheet({
            content: this.buildContent(),
            sheet: this.buildSheet(),
            open: this.args.open as boolean,
            modal: this.args.modal as boolean,
            canClose: this.args.canClose as boolean,
            widthRequest: 480,
            heightRequest: 340,
        });
        this.addContent(this._sheet);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._sheet) return;
        this._sheet.open = this.args.open as boolean;
        this._sheet.modal = this.args.modal as boolean;
        this._sheet.canClose = this.args.canClose as boolean;
    }
}

GObject.type_ensure(BottomSheetStory.$gtype);

export const BottomSheetStories: StoryModule = { stories: [BottomSheetStory] };
