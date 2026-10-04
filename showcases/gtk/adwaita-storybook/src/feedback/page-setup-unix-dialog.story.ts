// Gtk.PageSetupUnixDialog — the Unix page setup dialog, presented from a button.
//
// The subject is what the dialog REPORTS: the chosen sheet's size in the user's unit, with
// the four margins in the label's tooltip, and the four orientation buttons that read back
// into the page setup.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { pageSetupUnixDialogMeta } from './page-setup-unix-dialog.meta.js';

/** The `Gtk.PageOrientation` nicks the control offers, in enum order. */
const ORIENTATIONS: Record<string, Gtk.PageOrientation> = {
    portrait: Gtk.PageOrientation.PORTRAIT,
    landscape: Gtk.PageOrientation.LANDSCAPE,
    'reverse-portrait': Gtk.PageOrientation.REVERSE_PORTRAIT,
    'reverse-landscape': Gtk.PageOrientation.REVERSE_LANDSCAPE,
};

/** Story: the page setup dialog with a paper size and an orientation. */
export class PageSetupUnixDialogStory extends StoryWidget {
    private _button: Gtk.Button | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookPageSetupUnixDialog' }, PageSetupUnixDialogStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(PageSetupUnixDialogStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...pageSetupUnixDialogMeta, component: Gtk.PageSetupUnixDialog.$gtype };
    }

    initialize(): void {
        this._button = new Gtk.Button({
            label: 'Page Setup…',
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        this._button.add_css_class('pill');
        this._button.add_css_class('suggested-action');
        this._button.connect('clicked', () => this._present());

        this.addContent(this._button);
    }

    private _present(): void {
        const dialog = Gtk.PageSetupUnixDialog.new('Page Setup', null);
        // A page setup the dialog takes its values from. `set_page_setup` selects the
        // matching row — appending it when no row matches, which is why the margins come
        // from the paper size's own defaults here.
        const setup = new Gtk.PageSetup();
        setup.set_paper_size_and_default_margins(Gtk.PaperSize.new(this.args.paperSize as string));
        setup.set_orientation(ORIENTATIONS[this.args.orientation as string] ?? Gtk.PageOrientation.PORTRAIT);
        dialog.set_page_setup(setup);
        dialog.present();
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }
}

// Unix-only widget: GTK's Windows build has no page setup dialog, so the module contributes no story.
const available = 'PageSetupUnixDialog' in Gtk;
if (available) GObject.type_ensure(PageSetupUnixDialogStory.$gtype);

export const PageSetupUnixDialogStories: StoryModule = { stories: [...(available ? [PageSetupUnixDialogStory] : [])] };
