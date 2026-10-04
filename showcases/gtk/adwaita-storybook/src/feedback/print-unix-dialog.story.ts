// Gtk.PrintUnixDialog — the Unix print dialog, presented from a button.
//
// The story is about the CAPABILITIES: `manual-capabilities` is the half of the mask the
// APPLICATION can handle, and every control on the General and Page Setup pages is gated on
// it — copies, collate (which also needs a count above one), reverse, scale, the two-sided
// sheet picker, and whether Preview appears at all. The printer list is empty here because
// GTK's comes from a print backend, and a story has none.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { printUnixDialogMeta } from './print-unix-dialog.meta.js';

/** The nicks of `GtkPrintCapabilities`, in enum order. */
const CAPABILITIES: Record<string, Gtk.PrintCapabilities> = {
    collate: Gtk.PrintCapabilities.COLLATE,
    copies: Gtk.PrintCapabilities.COPIES,
    'generate-pdf': Gtk.PrintCapabilities.GENERATE_PDF,
    'generate-ps': Gtk.PrintCapabilities.GENERATE_PS,
    'number-up': Gtk.PrintCapabilities.NUMBER_UP,
    'number-up-layout': Gtk.PrintCapabilities.NUMBER_UP_LAYOUT,
    'page-set': Gtk.PrintCapabilities.PAGE_SET,
    preview: Gtk.PrintCapabilities.PREVIEW,
    reverse: Gtk.PrintCapabilities.REVERSE,
    scale: Gtk.PrintCapabilities.SCALE,
};

/** Story: the print dialog with the capabilities the application declares it can handle. */
export class PrintUnixDialogStory extends StoryWidget {
    private _button: Gtk.Button | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookPrintUnixDialog' }, PrintUnixDialogStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(PrintUnixDialogStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...printUnixDialogMeta, component: Gtk.PrintUnixDialog.$gtype };
    }

    initialize(): void {
        this._button = new Gtk.Button({
            label: 'Print…',
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        this._button.add_css_class('pill');
        this._button.add_css_class('suggested-action');
        this._button.connect('clicked', () => this._present());

        this.addContent(this._button);
    }

    private _present(): void {
        const dialog = Gtk.PrintUnixDialog.new('Print', null);
        const mask = String(this.args.capabilities)
            .split('|')
            .map((nick) => CAPABILITIES[nick.trim()] ?? 0)
            .reduce((caps, capability) => caps | capability, 0);
        dialog.set_manual_capabilities(mask);

        // The range group and the copies count, the two controls whose state decides what
        // the dialog itself lets a user do (update_dialog_from_capabilities).
        dialog.set_current_page(2);
        dialog.set_support_selection(true);
        dialog.set_has_selection(true);
        const settings = new Gtk.PrintSettings();
        settings.set_n_copies(Number(this.args.copies));
        settings.set_collate(this.args.range === 'all');
        settings.set_print_pages(this.args.range === 'current' ? Gtk.PrintPages.CURRENT : Gtk.PrintPages.ALL);
        dialog.set_settings(settings);

        dialog.present();
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }
}

GObject.type_ensure(PrintUnixDialogStory.$gtype);

export const PrintUnixDialogStories: StoryModule = { stories: [PrintUnixDialogStory] };
