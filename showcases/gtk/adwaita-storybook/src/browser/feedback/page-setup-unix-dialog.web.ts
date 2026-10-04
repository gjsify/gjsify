// Browser port of the Page Setup Dialog story. Shares metadata with
// page-setup-unix-dialog.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { pageSetupUnixDialogMeta } from '../../feedback/page-setup-unix-dialog.meta.js';

/** The plain-data `PageSetup` the element's property takes. */
interface PageSetupData {
    paperSize: string;
    orientation: string;
    margins: { top: number; bottom: number; left: number; right: number };
}

/** The imperative half of `<gtk-page-setup-unix-dialog>`. */
interface PageSetupDialogElement extends HTMLElement {
    pageSetup: PageSetupData;
    unit: 'mm' | 'inch';
    present(): void;
}

/** The default margins of a paper size, in millimetres — `gtk_paper_size_get_default_*`. */
const DEFAULT_MARGIN_MM = 0.25 * 25.4;
const TALL_BOTTOM_MARGIN_MM = 0.56 * 25.4;

function marginsFor(paperSize: string): PageSetupData['margins'] {
    const tall = paperSize === 'na_letter' || paperSize === 'na_legal' || paperSize === 'iso_a4';
    return {
        top: DEFAULT_MARGIN_MM,
        bottom: tall ? TALL_BOTTOM_MARGIN_MM : DEFAULT_MARGIN_MM,
        left: DEFAULT_MARGIN_MM,
        right: DEFAULT_MARGIN_MM,
    };
}

export class PageSetupUnixDialogWebStory extends StoryElement {
    private _dialog: PageSetupDialogElement | null = null;

    constructor() {
        super(PageSetupUnixDialogWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return pageSetupUnixDialogMeta;
    }

    initialize(): void {
        const center = document.createElement('div');
        center.style.display = 'flex';
        center.style.alignItems = 'center';
        center.style.justifyContent = 'center';
        center.style.minHeight = '160px';

        const button = document.createElement('button');
        button.textContent = 'Page Setup…';
        button.setAttribute('pill', '');
        button.setAttribute('suggested', '');
        button.addEventListener('click', () => this._present());
        center.appendChild(button);

        // Mounted on the body so the scrim covers the whole viewport, like every dialog here.
        this._dialog = document.createElement('gtk-page-setup-unix-dialog') as PageSetupDialogElement;
        document.body.appendChild(this._dialog);

        this.addContent(center);
    }

    private _present(): void {
        const dialog = this._dialog;
        if (dialog === null) return;
        const paperSize = (this.args.paperSize as string) ?? 'iso_a4';
        // `set_page_setup` selects the matching row and appends the setup when none matches,
        // which is why the margins are spelled out here rather than left to the drop down.
        dialog.pageSetup = {
            paperSize,
            orientation: (this.args.orientation as string) ?? 'portrait',
            margins: marginsFor(paperSize),
        };
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

export const PageSetupUnixDialogWebStories: WebStoryModule = {
    stories: [PageSetupUnixDialogWebStory],
};
