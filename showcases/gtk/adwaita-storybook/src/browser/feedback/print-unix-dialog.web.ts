// Browser port of the Print Dialog story. Shares metadata with print-unix-dialog.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { printUnixDialogMeta } from '../../feedback/print-unix-dialog.meta.js';

/** The plain-data `PageSetup` the element's property takes. */
interface PageSetupData {
    paperSize: string;
    orientation: string;
    margins: { top: number; bottom: number; left: number; right: number };
}

/** The imperative half of `<gtk-print-unix-dialog>`. */
interface PrintDialogElement extends HTMLElement {
    currentPage: number;
    /** Not a property of `Gtk.PrintUnixDialog`: which range button the dialog shows. */
    range: 'all' | 'current' | 'selection' | 'pages';
    supportSelection: boolean;
    hasSelection: boolean;
    manualCapabilities: string[];
    embedPageSetup: boolean;
    pageSetup: PageSetupData;
    printSettings: Record<string, string>;
    printers: Array<{ name: string; location?: string; acceptsJobs?: boolean; capabilities?: string[] }>;
    present(): void;
}

/** The two printers the story offers — GTK's list comes from a print backend. */
const PRINTERS = [
    { name: 'Office Laser', location: 'Building A, floor 2', acceptsJobs: true },
    { name: 'Lobby Printer', location: 'Building A, ground floor', acceptsJobs: false },
];

const MARGINS = { top: 6.35, bottom: 14.224, left: 6.35, right: 6.35 };

export class PrintUnixDialogWebStory extends StoryElement {
    private _dialog: PrintDialogElement | null = null;

    constructor() {
        super(PrintUnixDialogWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return printUnixDialogMeta;
    }

    initialize(): void {
        const center = document.createElement('div');
        center.style.display = 'flex';
        center.style.alignItems = 'center';
        center.style.justifyContent = 'center';
        center.style.minHeight = '160px';

        const button = document.createElement('button');
        button.textContent = 'Print…';
        button.setAttribute('pill', '');
        button.setAttribute('suggested', '');
        button.addEventListener('click', () => this._present());
        center.appendChild(button);

        this._dialog = document.createElement('gtk-print-unix-dialog') as PrintDialogElement;
        document.body.appendChild(this._dialog);

        this.addContent(center);
    }

    private _present(): void {
        const dialog = this._dialog;
        if (dialog === null) return;
        // The application half of the capability mask, spelled the way the GIR's nick set
        // is: `|`-separated nicks.
        dialog.manualCapabilities = String(this.args.capabilities ?? '')
            .split('|')
            .map((nick) => nick.trim())
            .filter((nick) => nick.length > 0);
        dialog.currentPage = 2;
        // Which of the four range buttons is active. The element keeps it as a property
        // because a radio group's value is not an attribute in the C either — the C's is
        // whatever `dialog_get_page_range` reads off the four check buttons.
        dialog.range = (this.args.range as 'all' | 'current' | 'selection' | 'pages') ?? 'all';
        dialog.supportSelection = true;
        dialog.hasSelection = true;
        // The paper size and orientation drop downs are insensitive until the page setup is
        // embedded (gtk_print_unix_dialog_set_embed_page_setup), and the story embeds it so
        // the Page Setup page has something to show.
        dialog.embedPageSetup = true;
        dialog.pageSetup = {
            paperSize: 'iso_a4',
            orientation: 'portrait',
            margins: MARGINS,
        };
        dialog.printSettings = {
            copies: String(this.args.copies ?? 1),
            collate: '0',
            reverse: '0',
        };
        dialog.printers = PRINTERS;
        dialog.present();
    }

    updateArgs(_args: StoryArgs): void {
        // The dialog reads the latest args each time it is presented; nothing to mutate live.
    }

    teardown(): void {
        if (this._dialog?.parentNode) this._dialog.parentNode.removeChild(this._dialog);
        this._dialog = null;
    }
}

export const PrintUnixDialogWebStories: WebStoryModule = { stories: [PrintUnixDialogWebStory] };
