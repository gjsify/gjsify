// <adw-print-unix-dialog> — the browser counterpart of `GtkPrintUnixDialog`: the Unix
// print dialog, a notebook of General / Page Setup / Job / Image Quality / Color /
// Finishing / Advanced over a printer list, with the conflicts action bar and the
// Preview / Cancel / Print action area (gtkprintunixdialog.ui).
//
// THE REPLICA PRINTS NOTHING. A browser has no print backend, no CUPS over D-Bus and no
// spooler — `gtk_print_backend_load_modules` (:1274-1310) is what GTK reaches for, and
// none of it exists here. What this element ports is the DIALOG: its layout, its page
// set, and every derivation the C runs over a printer's capabilities and options. The
// buttons behave as GTK's do with no printer: Preview is hidden (no PREVIEW capability),
// Print is INSENSITIVE (`gtk_dialog_set_response_sensitive (…, GTK_RESPONSE_OK, FALSE)`
// is what `selected_printer_changed` :1842-1874 sets until a printer that accepts jobs is
// chosen), and the four option pages are the EMPTY grids the C leaves them in when
// `_gtk_printer_get_options` has no printer to ask.
//
// The DIALOG CHROME IS `<adw-dialog>`'s — this element extends it, so the scrim, the
// sheet, `present()`/`close()`, `can-close`, Escape, the Tab trap and the return-focus are
// the ones `adw-dialog.ts` owns, and there is no `aria-modal` below.
//
// WHAT IS PORTED FROM `gtkprintunixdialog.c`
//
//   · `update_dialog_from_capabilities` (:1563-1592): every sensitive control is gated on
//     `manual_capabilities | printer_capabilities`, `collate` additionally needs a copies
//     count above 1 (`atoi (copies) > 1`), and the Preview button is VISIBLE — not merely
//     insensitive — only with the PREVIEW capability;
//   · `set_current_page` (:3059-3073): "Current Page" is sensitive only for a page that is
//     not -1;
//   · `set_support_selection` / `set_has_selection` (:3325-3405): the Selection radio is
//     VISIBLE only when the application supports printing a selection, and sensitive only
//     when it also HAS one;
//   · `update_page_range_entry_sensitivity` (:1962-1972) and
//     `page_range_entry_focus_changed` (:1951-1960): picking "Pages:" focuses the entry,
//     and focusing the entry picks "Pages:";
//   · `update_print_at_entry_sensitivity` (:1974-1989): the same pair for "At:";
//   · `update_collate_icon` (:1920-1949): the four page thumbnails' NUMBERS depend on
//     collate and reverse, and the second COLUMN is visible only when the copies count is
//     above 1 — which is the one piece of the print dialog that explains itself;
//   · `selected_printer_changed` (:1821-1915): choosing a printer that accepts jobs makes
//     Print sensitive, and its capabilities become the second half of every gate above;
//   · `gtk_print_unix_dialog_new` (:2961-2972): a NULL title means "Print";
//   · `draw_page` (:2283-2681) for the Page Setup preview: the sheet scaled to
//     `EXAMPLE_PAGE_AREA_SIZE` (110px), divided by the number-up grid — 1, 2, 4, 6, 9 or 16
//     pages, flipping for 2 and 6 — and each cell numbered in the number-up ORDER. The
//     ruler and its two dimension captions the C draws around it are the part not painted
//     here: they are decoration outside the sheet, and the mm caption is on the label.
//
// Attributes (the GObject property names, hyphenated): `current-page`, `embed-page-setup`,
// `has-selection`, `manual-capabilities`, `support-selection`, plus `title`, `open`,
// `can-close`, `content-width`, `content-height`, `presentation-mode`, `show-header` from
// the chrome. `manual-capabilities` takes the nick SET the GIR generates, `|`-separated —
// `manual-capabilities="page-set|copies|collate|reverse|scale|preview"`.
//
// Properties with no attribute form: `pageSetup` and `printSettings` (`GtkPageSetup` /
// `GtkPrintSettings` OBJECTS, carried as the plain data `src/page-setup.ts` defines),
// `printerOptions` (the per-printer option widgets GTK fills from the backend — see the
// header), and `printers` (the list a backend would have discovered; an INPUT here).
// `selectedPrinter` is read-only, as in the C.
//
// Events: the base class's `notify::open` (`{ open }`) and `closed`, plus `response`
// (detail `{ responseId }`) — GTK_RESPONSE_APPLY (-10, "Pre_view"), GTK_RESPONSE_CANCEL
// (-6) and GTK_RESPONSE_OK (-5, "_Print"), the three `gtk_dialog_add_buttons` passes.
//
// A11y: role `dialog` from `AdwModalSurface`; the notebook is a tab list over `tabpanel`
// roles, the printer rows are radios, and every control has the label the `.ui` gives it.
//
// Reference: refs/gtk/gtk/print/gtkprintunixdialog.c (every rule above, by line)
// Reference: refs/gtk/gtk/print/ui/gtkprintunixdialog.ui (the notebook, the groups,
//   the group headings, the radio labels, the action area)
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialogs.scss:9-34
//   (`window.print:not(.ssd-frame)`: the `drawing` node, white `paper` with
//   `background-clip: padding-box` and a 1px `$border_color` border, a FLAT titlebar and
//   a `.view` `.dialog-action-box`)
// Copyright (c) 2006-2024 Red Hat, Inc. / The GTK authors. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the page setup is
// the plain data of packages/web/adwaita-web/src/page-setup.ts; nothing prints.

import {
    type PageOrientation,
    type PageSetup,
    COMMON_PAPER_SIZES,
    defaultMargins,
    defaultPageSetup,
    orientedSize,
    paperSizeOf,
} from '../page-setup.js';

import { AdwDialog } from './adw-dialog.js';
import { createGtkImage } from './gtk-image.js';

/** The three action-area response ids `gtk_dialog_add_buttons` passes. */
const RESPONSE_APPLY = -10;
const RESPONSE_CANCEL = -6;
const RESPONSE_OK = -5;

/** The `GtkPrintCapabilities` nicks, in enum order (the GIR's own spelling). */
const CAPABILITY_NICKS = [
    'collate',
    'copies',
    'generate-pdf',
    'generate-ps',
    'number-up',
    'number-up-layout',
    'page-set',
    'preview',
    'reverse',
    'scale',
] as const;

/** One `GtkPrintCapabilities` nick. */
export type PrintCapability = (typeof CAPABILITY_NICKS)[number];

/** The seven notebook tabs, in the `.ui`'s order. */
const TABS = ['General', 'Page Setup', 'Job', 'Image Quality', 'Color', 'Finishing', 'Advanced'] as const;
type PrintTab = (typeof TABS)[number];

/** `page_set_combo`'s three models, in the `.ui`'s order. */
const PAGE_SET_ITEMS = ['All sheets', 'Even sheets', 'Odd sheets'];

/** `orientation_combo`'s four models, in the `.ui`'s order. */
const ORIENTATION_ITEMS: PageOrientation[] = ['portrait', 'landscape', 'reverse-portrait', 'reverse-landscape'];

/** One row of the printer list — what `GtkPrinter` answers name / location / icon for. */
export interface PrinterInfo {
    readonly name: string;
    readonly location?: string;
    /** The `.ui`'s icon column, from the printer's own `icon-name`. */
    readonly iconName?: string;
    /** `gtk_printer_is_accepting_jobs` — what gates the Print button. */
    readonly acceptsJobs?: boolean;
    /** `gtk_printer_get_capabilities` — the second half of every sensitivity gate. */
    readonly capabilities?: readonly PrintCapability[];
    /** Whether the row passes `is_printer_active` (:1164-1186). */
    readonly active?: boolean;
}

/** The `Gtk.PrintSettings` this dialog carries, in the keys its own UI sets. */
export interface PrintSettingsData {
    /** `format-for-printer` — the printer the settings belong to. */
    readonly 'format-for-printer'?: string;
    /** `copies` — a string, because `GtkPrintSettings` values are all strings. */
    readonly copies?: string;
    /** `collate` / `reverse` — `"0"` or `"1"`, as CUPS writes them. */
    readonly collate?: string;
    readonly reverse?: string;
    /** `page-set` — `all` / `even` / `odd`, the index into `PAGE_SET_ITEMS`. */
    readonly 'page-set'?: string;
    /** `scale` — a percentage, as a string. */
    readonly scale?: string;
    /** `orientation` — `portrait` … `reverse-landscape`. */
    readonly orientation?: string;
    /** `print-at` — an ISO timestamp for the "At:" branch. */
    readonly 'print-at'?: string;
    /** `printer-setting-…` — the per-printer option groups of the Job tab. */
    readonly [key: string]: string | undefined;
}

/**
 * `GtkPrintUnixDialog`'s default settings, from `gtk_print_unix_dialog_init` (:875-905) and
 * `update_dialog_from_settings`: copies 1, collate and reverse off, scale 100, all sheets,
 * portrait, and nothing scheduled.
 */
const DEFAULT_SETTINGS: PrintSettingsData = {
    copies: '1',
    collate: '0',
    reverse: '0',
    'page-set': '0',
    scale: '100',
    orientation: 'portrait',
};

export class GtkPrintUnixDialog extends AdwDialog {
    private _built = false;
    private _printers: PrinterInfo[] = [];
    private _selected: PrinterInfo | null = null;
    private _settings: PrintSettingsData = { ...DEFAULT_SETTINGS };
    private _pageSetup: PageSetup = defaultPageSetup();
    private _printerListEl!: HTMLElement;
    private _switcherEl!: HTMLDivElement;
    private _panelEl!: HTMLElement;
    private _tabPages = new Map<PrintTab, HTMLElement>();
    private _tab: PrintTab = 'General';
    private _currentPage = -1;
    private _supportSelection = false;
    private _hasSelection = false;
    private _manual: Set<PrintCapability> = new Set();
    private _range: 'all' | 'current' | 'selection' | 'pages' = 'all';
    private _printAt: 'now' | 'at' | 'hold' = 'now';
    private _printButton!: HTMLButtonElement;
    private _previewButton!: HTMLButtonElement;
    private _conflictsEl!: HTMLElement;
    private _capabilityControls = new Map<PrintCapability, HTMLElement>();
    private _collateCheck!: HTMLElement & { checked: boolean };
    private _reverseCheck!: HTMLElement & { checked: boolean };
    private _copiesInput!: HTMLInputElement;
    private _paperDrop!: HTMLElement & { selected: number };
    private _orientationDrop!: HTMLElement & { selected: number };
    private _pageRangeInput!: HTMLInputElement;
    private _selectionRadio!: HTMLElement & { checked: boolean };
    private _currentPageRadio!: HTMLElement & { checked: boolean };
    private _rangeRadios = new Map<string, HTMLElement & { checked: boolean }>();
    private _atInput: HTMLInputElement | null = null;

    static get observedAttributes(): string[] {
        // The five properties the GIR declares as SCALARS (`:1589` on). `page-setup`,
        // `print-settings` and `selected-printer` are `GtkPageSetup` / `GtkPrintSettings`
        // / `GtkPrinter` objects, which an attribute cannot carry — they are the plain-data
        // properties below, and `check-adwaita-element-properties.mjs` excludes them for
        // exactly that reason.
        return [
            ...AdwDialog.observedAttributes,
            'current-page',
            'embed-page-setup',
            'has-selection',
            'manual-capabilities',
            'support-selection',
        ];
    }

    // ------------------------------------------------------------- properties

    /** `current-page`, in 0-based document pages; -1 disables "Current Page". */
    get currentPage(): number {
        return this._currentPage;
    }

    set currentPage(value: number) {
        this._currentPage = value;
        if (this._built) this._renderPrint();
    }

    /** Whether the page-setup controls are EMBEDDED rather than in their own dialog. */
    get embedPageSetup(): boolean {
        return this.hasAttribute('embed-page-setup');
    }

    set embedPageSetup(value: boolean) {
        this.toggleAttribute('embed-page-setup', value);
        if (this._built) this._renderPrint();
    }

    /** Whether the application has a selection to print. */
    get hasSelection(): boolean {
        return this._hasSelection;
    }

    set hasSelection(value: boolean) {
        this._hasSelection = value;
        if (this._built) this._renderPrint();
    }

    /** Whether the application supports printing a selection. */
    get supportSelection(): boolean {
        return this.hasAttribute('support-selection');
    }

    set supportSelection(value: boolean) {
        this.toggleAttribute('support-selection', value);
        if (this._built) this._renderPrint();
    }

    /** The capabilities the APPLICATION handles, as `GtkPrintCapabilities` nicks. */
    get manualCapabilities(): PrintCapability[] {
        return [...this._manual];
    }

    set manualCapabilities(value: readonly PrintCapability[]) {
        this._manual = new Set(value.filter((capability) => CAPABILITY_NICKS.includes(capability)));
        if (this._built) this._renderPrint();
    }

    /** The chosen printer, or `null` — `gtk_print_unix_dialog_get_selected_printer`. */
    get selectedPrinter(): PrinterInfo | null {
        return this._selected === null ? null : { ...this._selected };
    }

    /** The page setup, as the plain `PageSetup` the value model defines. */
    get pageSetup(): PageSetup {
        return { ...this._pageSetup };
    }

    set pageSetup(value: PageSetup) {
        this._pageSetup = value;
        if (this._built) this._renderPrint();
    }

    /** The print settings, in the keys the dialog's own controls write. */
    get printSettings(): PrintSettingsData {
        return { ...this._settings };
    }

    set printSettings(value: PrintSettingsData) {
        this._settings = { ...DEFAULT_SETTINGS, ...value };
        if (this._built) this._renderPrint();
    }

    /**
     * Which of the four range buttons is active — the radio group the `.ui` calls the
     * Range frame. GTK has no property for it either: the dialog READS whichever of the four
     * `GtkCheckButton`s is active (`dialog_get_page_range`), and that is what this holds.
     */
    get range(): 'all' | 'current' | 'selection' | 'pages' {
        return this._range;
    }

    set range(value: 'all' | 'current' | 'selection' | 'pages') {
        this._range = value;
        if (!this._built) return;
        const radio = this._rangeRadios.get(value);
        if (radio !== undefined) radio.checked = true;
        this._renderPrint();
    }

    /** The printers a print backend would have discovered. An INPUT here — see the header. */
    get printers(): PrinterInfo[] {
        return this._printers.map((printer) => ({ ...printer }));
    }

    set printers(value: readonly PrinterInfo[]) {
        this._printers = value.map((printer) => ({ ...printer }));
        this._selected = null;
        if (this._built) this._renderPrint();
    }

    // ------------------------------------------------------------- lifecycle

    connectedCallback(): void {
        if (this._built) {
            super.connectedCallback();
            return;
        }
        // BEFORE `super.connectedCallback()`, which renders and therefore calls
        // `decorateHeader` — the tab switcher is what that hook installs, as with
        // `<gtk-about-dialog>`.
        this._switcherEl = document.createElement('div');
        this._switcherEl.className = 'adw-print-switcher';
        this._switcherEl.setAttribute('role', 'tablist');
        super.connectedCallback();

        // `gtk_print_unix_dialog_new`: a NULL title means "Print".
        if (!this.hasAttribute('title')) this.setAttribute('title', 'Print');
        this._readManual();

        // The base adopts the author's light-DOM children into `contentArea` on
        // connect; rebuilding around them must keep them, AFTER the dialog's own UI —
        // which is also where children appended later land (`slotted-children.spec.ts`
        // pins the equality, path and index).
        const adopted = [...this.contentArea.childNodes];
        this.contentArea.replaceChildren(this._build());
        for (const node of adopted) this.contentArea.appendChild(node);
        this._renderPrint();
        // `_built` goes last: either `setAttribute` above re-enters through
        // `attributeChangedCallback`, and rendering a half-built dialog throws.
        this._built = true;
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        super.attributeChangedCallback(name, oldValue, newValue);
        if (!this._built || oldValue === newValue) return;
        if (name === 'title') return;
        if (name === 'manual-capabilities') this._readManual();
        this._renderPrint();
    }

    /**
     * `manual-capabilities` takes the nick SET the GIR generates, `|`-separated —
     * `manual-capabilities="page-set|copies|collate|reverse|scale|preview"`. Unknown
     * nicks are dropped, which is what the GIR-validated setter does with them.
     */
    private _readManual(): void {
        this._manual = new Set(
            (this.getAttribute('manual-capabilities') ?? '')
                .split('|')
                .map((nick) => nick.trim())
                .filter((nick) => CAPABILITY_NICKS.includes(nick as PrintCapability)) as PrintCapability[],
        );
    }

    protected override decorateHeader(header: HTMLElement): void {
        const title = header.querySelector('.adw-dialog-title');
        if (title !== null) title.replaceWith(this._switcherEl);
        else header.prepend(this._switcherEl);
    }

    // ------------------------------------------------------------- building

    private _build(): HTMLElement {
        const root = document.createElement('div');
        root.className = 'adw-print-root';

        this._panelEl = document.createElement('div');
        this._panelEl.className = 'adw-print-panel';
        this._panelEl.setAttribute('role', 'tabpanel');

        root.append(this._panelEl, this._buildConflicts(), this._buildActions());
        this._renderPanel();
        return root;
    }

    /**
     * Every page of the notebook, built once and hidden but for the visible one —
     * which is what `GtkNotebook` holds: all seven pages exist whether shown or not,
     * so the capability pass can reach every control from the first render.
     */
    private _renderPanel(): void {
        for (const tab of TABS) {
            let page = this._tabPages.get(tab);
            if (page === undefined) {
                page = document.createElement('div');
                page.className = 'adw-print-page';
                page.setAttribute('role', 'tabpanel');
                page.dataset.tab = tab;
                page.appendChild(this._buildTab(tab));
                this._tabPages.set(tab, page);
                this._panelEl.appendChild(page);
            }
            page.hidden = tab !== this._tab;
        }
    }

    private _buildTab(tab: PrintTab): HTMLElement {
        switch (tab) {
            case 'General':
                return this._buildGeneral();
            case 'Page Setup':
                return this._buildPageSetup();
            case 'Job':
                return this._buildJob();
            // The four option pages: a scrolled grid the backend's `GtkPrinterOptionWidget`s
            // go into. With no backend there are none, so they are the EMPTY grids the C
            // leaves them in — the headings above them are what tells the reader why.
            case 'Image Quality':
            case 'Color':
            case 'Finishing':
                return this._buildOptionsPage(tab);
            case 'Advanced':
                return this._buildOptionsPage(tab);
        }
    }

    /** General: the printer list, then Range and Copies. */
    private _buildGeneral(): HTMLElement {
        const box = document.createElement('div');
        box.className = 'adw-print-columns';

        this._printerListEl = document.createElement('div');
        this._printerListEl.className = 'adw-print-printer-list';
        this._printerListEl.setAttribute('role', 'radiogroup');
        this._printerListEl.setAttribute('aria-label', 'Printer');
        box.appendChild(this._frame(this._printerListEl));

        const right = document.createElement('div');
        right.className = 'adw-print-column';

        // Range
        const rangeGroup = this._group('Range');
        const range = rangeGroup.body;
        for (const [value, label] of [
            ['all', 'All Pages'],
            ['current', 'Current Page'],
            ['selection', 'Selection'],
        ] as Array<['all' | 'current' | 'selection', string]>) {
            const radio = this._radio(label, `adw-print-range-${value}`);
            radio.addEventListener('notify::checked', () => {
                if (radio.checked) {
                    this._range = value;
                    if (value === 'current' || value === 'selection') this._renderPrint();
                }
            });
            if (value === 'current') this._currentPageRadio = radio;
            if (value === 'selection') this._selectionRadio = radio;
            this._rangeRadios.set(value, radio);
            range.appendChild(radio);
        }
        const pagesRadio = this._radio('Pages:', 'adw-print-range-pages');
        pagesRadio.addEventListener('notify::checked', () => {
            if (!pagesRadio.checked) return;
            this._range = 'pages';
            // `update_page_range_entry_sensitivity`: picking "Pages:" grabs the entry.
            this._pageRangeInput.focus();
        });
        this._pageRangeInput = document.createElement('input');
        this._pageRangeInput.type = 'text';
        this._pageRangeInput.className = 'adw-print-page-range-entry';
        this._pageRangeInput.title = 'Specify one or more page ranges, e.g. 1–3, 7, 11';
        this._pageRangeInput.setAttribute('aria-label', 'Pages');
        // `page_range_entry_focus_changed`: focusing the entry picks its radio.
        this._pageRangeInput.addEventListener('focus', () => {
            this._range = 'pages';
            pagesRadio.checked = true;
        });
        this._rangeRadios.set('pages', pagesRadio);
        const pagesRow = document.createElement('div');
        pagesRow.className = 'adw-print-grid-row';
        pagesRow.append(pagesRadio, this._pageRangeInput);
        range.appendChild(pagesRow);
        right.appendChild(rangeGroup.group);

        // Copies
        const copiesGroup = this._group('Copies');
        const copies = copiesGroup.body;
        const copiesRow = document.createElement('div');
        copiesRow.className = 'adw-print-grid-row';
        const copiesLabel = document.createElement('div');
        copiesLabel.className = 'adw-print-label';
        copiesLabel.textContent = 'Copies:';
        this._copiesInput = document.createElement('input');
        this._copiesInput.type = 'number';
        this._copiesInput.min = '1';
        this._copiesInput.className = 'adw-print-copies';
        this._copiesInput.value = this._settings.copies ?? '1';
        this._copiesInput.setAttribute('aria-label', 'Copies');
        // `copies_spin`'s `changed` and `value-changed` both run the capability pass.
        this._copiesInput.addEventListener('input', () => {
            this._settings = { ...this._settings, copies: this._copiesInput.value };
            this._renderPrint();
        });
        copiesRow.append(copiesLabel, this._copiesInput);
        copies.appendChild(copiesRow);

        this._collateCheck = this._check('Collate', 'adw-print-collate');
        this._reverseCheck = this._check('Reverse', 'adw-print-reverse');
        for (const check of [this._collateCheck, this._reverseCheck]) {
            check.addEventListener('notify::checked', () => this._renderPrint());
        }
        copies.append(this._collateCheck, this._reverseCheck);

        const preview = this._buildCollatePreview();
        const previewRow = document.createElement('div');
        previewRow.className = 'adw-print-grid-row';
        previewRow.appendChild(preview);
        copies.appendChild(previewRow);
        right.appendChild(copiesGroup.group);

        box.appendChild(right);
        return box;
    }

    /** `page_collate_preview`: four thumbnails whose NUMBERS show the ordering. */
    private _buildCollatePreview(): HTMLElement {
        const preview = document.createElement('div');
        preview.className = 'adw-print-collate-preview';
        preview.setAttribute('role', 'img');
        preview.setAttribute(
            'aria-label',
            'A visualization of the effect of the collate and reverse options on the page ordering',
        );
        preview.dataset.columnA = '2';
        preview.dataset.columnB = '1';
        return preview;
    }

    /** Page Setup: Layout and Paper beside the sheet preview. */
    private _buildPageSetup(): HTMLElement {
        const box = document.createElement('div');
        box.className = 'adw-print-columns';

        const left = document.createElement('div');
        left.className = 'adw-print-column';

        // Layout
        const layoutGroup = this._group('Layout');
        const layout = layoutGroup.body;
        // `page_set_combo` is the one Layout control `update_dialog_from_capabilities`
        // gates (PAGE_SET); the scale input below is gated by SCALE.
        layout.appendChild(this._labelledRow('Two-sided:', this._dropDown(PAGE_SET_ITEMS, 'Two-sided')));
        const scaleInput = document.createElement('input');
        scaleInput.type = 'number';
        scaleInput.min = '10';
        scaleInput.max = '400';
        scaleInput.className = 'adw-print-scale';
        scaleInput.value = this._settings.scale ?? '100';
        scaleInput.setAttribute('aria-label', 'Scale in percent');
        scaleInput.addEventListener('input', () => {
            this._settings = { ...this._settings, scale: scaleInput.value };
            this._renderPrint();
        });
        this._capabilityControls.set('scale', scaleInput);
        const scaleRow = document.createElement('div');
        scaleRow.className = 'adw-print-grid-row';
        const scaleLabel = document.createElement('div');
        scaleLabel.className = 'adw-print-label';
        scaleLabel.textContent = 'Scale:';
        const percent = document.createElement('span');
        percent.className = 'adw-print-label';
        percent.textContent = '%';
        scaleRow.append(scaleLabel, scaleInput, percent);
        layout.appendChild(scaleRow);
        left.appendChild(layoutGroup.group);

        // Paper. BOTH drop downs are insensitive until `embed-page-setup` is set —
        // `gtk_print_unix_dialog_set_embed_page_setup` (:3415-3427) is what connects their
        // `notify::selected` handlers AND makes them sensitive, in that order.
        const paperGroup = this._group('Paper');
        const paper = paperGroup.body;
        const paperNames = COMMON_PAPER_SIZES.map((size) => size.displayName);
        this._paperDrop = this._dropDown(paperNames, 'Paper size');
        this._orientationDrop = this._dropDown(
            ORIENTATION_ITEMS.map((orientation) => orientation[0]!.toUpperCase() + orientation.slice(1)),
            'Orientation',
        );
        paper.appendChild(this._labelledRow('Paper size:', this._paperDrop));
        paper.appendChild(this._labelledRow('Orientation:', this._orientationDrop));
        left.appendChild(paperGroup.group);

        // The two drop downs react ONLY while the page setup is embedded, which is the
        // other half of `set_embed_page_setup`: connecting a listener and making the
        // control sensitive are one decision there.
        this._paperDrop.addEventListener('notify::selected', () => {
            if (!this.embedPageSetup) return;
            this._paperChanged(this._paperDrop.selected);
        });
        this._orientationDrop.addEventListener('notify::selected', () => {
            if (!this.embedPageSetup) return;
            const orientation = ORIENTATION_ITEMS[this._orientationDrop.selected] ?? 'portrait';
            this._pageSetup = { ...this._pageSetup, orientation };
            this._settings = { ...this._settings, orientation };
            this._renderPrint();
        });

        box.append(left, this._buildSheetPreview());
        return box;
    }

    /**
     * `page_layout_preview` (:2683) + `draw_page` (:2283): the sheet at 110px on its long
     * edge, divided by the number-up grid with each cell numbered in the number-up order.
     * The ruler the C draws around it is decoration outside the sheet and is not painted.
     */
    private _buildSheetPreview(): HTMLElement {
        const preview = document.createElement('div');
        preview.className = 'adw-print-sheet-preview';
        preview.setAttribute('role', 'img');
        preview.setAttribute('aria-label', 'Page layout preview');
        const paper = document.createElement('div');
        paper.className = 'adw-print-paper';
        const size = paperSizeOf(this._pageSetup);
        const landscape =
            this._pageSetup.orientation === 'landscape' || this._pageSetup.orientation === 'reverse-landscape';
        paper.style.aspectRatio = landscape ? `${size.height} / ${size.width}` : `${size.width} / ${size.height}`;
        const grid = document.createElement('div');
        grid.className = 'adw-print-number-up';
        grid.dataset.cells = '1';
        paper.appendChild(grid);
        preview.appendChild(paper);
        const caption = document.createElement('div');
        caption.className = 'adw-print-sheet-caption';
        caption.textContent = `${orientedSize(this._pageSetup).width.toFixed(1)} mm × ${orientedSize(this._pageSetup).height.toFixed(1)} mm`;
        preview.appendChild(caption);
        return preview;
    }

    /** Job: Job Details, Print Document, Add Cover Page. */
    private _buildJob(): HTMLElement {
        const box = document.createElement('div');
        box.className = 'adw-print-column';

        // Job Details — the two printer option widgets the C puts here (`job_prio`,
        // `billing_info`), which exist only for a printer that offers them.
        const detailsGroup = this._group('Job Details');
        detailsGroup.body.appendChild(this._optionsGrid('Job Details'));

        const documentGroup = this._group('Print Document');
        const document_ = documentGroup.body;
        for (const [value, label] of [
            ['now', 'Now'],
            ['at', 'At:'],
            ['hold', 'On hold'],
        ] as Array<['now' | 'at' | 'hold', string]>) {
            const radio = this._radio(label, 'adw-print-at');
            radio.addEventListener('notify::checked', () => {
                if (!radio.checked) return;
                this._printAt = value;
                // `update_print_at_entry_sensitivity`: the entry follows its radio, and
                // picking "At:" grabs it.
                if (this._atInput !== null) this._atInput.disabled = value !== 'at';
                if (value === 'at') this._atInput?.focus();
            });
            document_.appendChild(radio);
            if (value === 'at') {
                this._atInput = document.createElement('input');
                this._atInput.type = 'text';
                this._atInput.className = 'adw-print-at-entry';
                this._atInput.setAttribute('aria-label', 'Print at');
                this._atInput.disabled = true;
                this._atInput.addEventListener('input', () => {
                    this._settings = { ...this._settings, 'print-at': this._atInput!.value };
                });
                const row = document.createElement('div');
                row.className = 'adw-print-grid-row';
                row.appendChild(this._atInput);
                document_.appendChild(row);
            }
        }

        const coverGroup = this._group('Add Cover Page');
        coverGroup.body.appendChild(this._optionsGrid('Cover Page'));

        box.append(detailsGroup.group, documentGroup.group, coverGroup.group);
        return box;
    }

    /**
     * One of the four option pages: the scrolled viewport + grid the C's
     * `GtkPrinterOptionWidget`s are added to. There are none without a backend, so the grid
     * is empty and says so rather than inventing options.
     */
    private _buildOptionsPage(tab: PrintTab): HTMLElement {
        const box = document.createElement('div');
        box.className = 'adw-print-column';
        const grid = this._optionsGrid(tab);
        if (tab === 'Advanced') {
            // The Advanced page is a plain box (`advanced_vbox`), not a grid.
            const advanced = document.createElement('div');
            advanced.className = 'adw-print-advanced';
            advanced.appendChild(grid);
            box.appendChild(advanced);
            return box;
        }
        box.appendChild(grid);
        return box;
    }

    /** The option grid, one row per option group the backend would offer. */
    private _optionsGrid(label: string): HTMLElement {
        const grid = document.createElement('div');
        grid.className = 'adw-print-options-grid';
        grid.setAttribute('role', 'group');
        grid.setAttribute('aria-label', label);
        grid.dataset.empty = 'true';
        return grid;
    }

    /** The conflicts action bar — hidden until `mark_conflicts` finds one (:3050-3060). */
    private _buildConflicts(): HTMLElement {
        this._conflictsEl = document.createElement('div');
        this._conflictsEl.className = 'adw-print-conflicts';
        this._conflictsEl.hidden = true;
        this._conflictsEl.append(
            createGtkImage('dialog-warning', 'adw-print-conflicts-icon'),
            (() => {
                const label = document.createElement('span');
                label.className = 'adw-print-conflicts-label';
                label.textContent = 'Some of the settings in the dialog conflict';
                return label;
            })(),
        );
        return this._conflictsEl;
    }

    /** Preview / Cancel / Print, in the `.ui`'s order and with its own response ids. */
    private _buildActions(): HTMLElement {
        const actions = document.createElement('div');
        actions.className = 'adw-print-actions';

        this._previewButton = document.createElement('button');
        this._previewButton.type = 'button';
        this._previewButton.className = 'adw-print-preview';
        this._previewButton.textContent = 'Preview';
        this._previewButton.addEventListener('click', () => this._respond(RESPONSE_APPLY));

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'adw-print-cancel';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => this._respond(RESPONSE_CANCEL));

        this._printButton = document.createElement('button');
        this._printButton.type = 'button';
        this._printButton.className = 'adw-print-print suggested-action';
        this._printButton.textContent = 'Print';
        this._printButton.addEventListener('click', () => this._respond(RESPONSE_OK));

        actions.append(this._previewButton, cancel, this._printButton);
        return actions;
    }

    private _respond(responseId: number): void {
        this.dispatchEvent(new CustomEvent('response', { bubbles: true, detail: { responseId } }));
        if (responseId !== RESPONSE_OK) this.close();
    }

    // ------------------------------------------------------------- fragments

    /**
     * One `frame_templateN`: a BOLD heading over a grid, which is the shape every group in
     * the `.ui` has — `box > box > grid` with the heading's `weight=bold`.
     */
    private _group(title: string): { group: HTMLElement; body: HTMLElement } {
        const group = document.createElement('div');
        group.className = 'adw-print-group';
        const heading = document.createElement('div');
        heading.className = 'adw-print-group-title';
        heading.textContent = title;
        const body = document.createElement('div');
        body.className = 'adw-print-group-body';
        group.append(heading, body);
        return { group, body };
    }

    private _labelledRow(label: string, control: HTMLElement, capability?: PrintCapability): HTMLElement {
        const row = document.createElement('div');
        row.className = 'adw-print-grid-row';
        const text = document.createElement('div');
        text.className = 'adw-print-label';
        text.textContent = label;
        row.append(text, control);
        if (capability !== undefined) this._capabilityControls.set(capability, control);
        return row;
    }

    private _dropDown(items: readonly string[], label: string): HTMLElement & { selected: number } {
        const dropdown = document.createElement('gtk-drop-down') as HTMLElement & { selected: number };
        dropdown.className = 'adw-print-dropdown';
        dropdown.setAttribute('model', JSON.stringify([...items]));
        dropdown.setAttribute('aria-label', label);
        return dropdown;
    }

    private _radio(label: string, name: string): HTMLElement & { checked: boolean } {
        const radio = document.createElement('adw-radio') as HTMLElement & { checked: boolean };
        // The name is the class too, so the Range radios answer to
        // `.adw-print-range-selection` and `.adw-print-range-current`.
        radio.className = name;
        radio.setAttribute('label', label);
        radio.setAttribute('name', name);
        radio.setAttribute('value', label);
        return radio;
    }

    private _check(label: string, name: string): HTMLElement & { checked: boolean } {
        const check = document.createElement('gtk-check-button') as HTMLElement & { checked: boolean };
        // The name is the class too, so Collate and Reverse answer to
        // `.adw-print-collate` and `.adw-print-reverse`.
        check.className = name;
        check.setAttribute('label', label);
        check.setAttribute('name', name);
        return check;
    }

    private _frame(content: HTMLElement): HTMLElement {
        const frame = document.createElement('div');
        frame.className = 'adw-print-frame';
        frame.appendChild(content);
        return frame;
    }

    // ------------------------------------------------------------- rendering

    /** `selected_printer_changed` (:1821-1915) — the list and what selecting does. */
    private _printerChanged(selected: PrinterInfo | null): void {
        this._selected = selected;
        if (selected !== null) {
            // The printer's capabilities replace the previous printer's (:1874), and the
            // settings follow the printer when no explicit page setup was set.
            this._settings = { ...this._settings, 'format-for-printer': selected.name };
        }
        this._renderPrint();
    }

    private _paperChanged(index: number): void {
        const size = COMMON_PAPER_SIZES[index];
        if (size === undefined) return;
        this._pageSetup = { ...this._pageSetup, paperSize: size.name, margins: defaultMargins(size) };
        this._renderPrint();
    }

    /** Every capability the dialog currently has: the manual half OR the printer's. */
    private _capabilities(): Set<PrintCapability> {
        const capabilities = new Set(this._manual);
        for (const capability of this._selected?.capabilities ?? []) capabilities.add(capability);
        return capabilities;
    }

    /** `update_dialog_from_capabilities` (:1563-1592), every line of it. */
    private _renderPrint(): void {
        const capabilities = this._capabilities();
        this._switcherEl.replaceChildren(
            ...TABS.map((tab) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'adw-print-switcher-item';
                button.setAttribute('role', 'tab');
                button.textContent = tab;
                button.classList.toggle('checked', tab === this._tab);
                button.setAttribute('aria-selected', String(tab === this._tab));
                button.addEventListener('click', () => {
                    this._tab = tab;
                    this._renderPanel();
                    this._renderPrint();
                });
                return button;
            }),
        );

        this._printerListEl.replaceChildren(
            ...this._printers.map((printer) => {
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'adw-print-printer-row';
                row.setAttribute('role', 'radio');
                row.setAttribute('aria-checked', String(printer === this._selected));
                row.classList.toggle('checked', printer === this._selected);
                // The `.ui`'s icon column reads each printer's OWN `icon-name`; the
                // default for one that has none is the printer glyph.
                row.appendChild(
                    printer.iconName === undefined
                        ? createGtkImage('printer', 'adw-print-printer-icon')
                        : createGtkImage(printer.iconName, 'adw-print-printer-icon'),
                );
                const text = document.createElement('span');
                text.className = 'adw-print-printer-text';
                const name = document.createElement('span');
                name.className = 'adw-print-printer-name';
                name.textContent = printer.name;
                text.appendChild(name);
                if (printer.location !== undefined) {
                    const location = document.createElement('span');
                    location.className = 'adw-print-printer-location';
                    location.textContent = printer.location;
                    text.appendChild(location);
                }
                row.appendChild(text);
                row.addEventListener('click', () => this._printerChanged(printer));
                return row;
            }),
        );

        // `set_support_selection` (:3325-3343) then `set_has_selection` (:3369-3389): the
        // radio is VISIBLE only with support, and sensitive only with support AND a
        // selection. Both run in that order, so the insensitive case wins.
        this._selectionRadio.hidden = !this.supportSelection;
        this._selectionRadio.classList.toggle('insensitive', !this.supportSelection || !this._hasSelection);
        this._selectionRadio.setAttribute('aria-disabled', String(!this.supportSelection || !this._hasSelection));

        // `set_current_page` (:3059-3073).
        this._currentPageRadio.classList.toggle('insensitive', this._currentPage === -1);
        this._currentPageRadio.setAttribute('aria-disabled', String(this._currentPage === -1));

        for (const [capability, control] of this._capabilityControls) {
            control.toggleAttribute('disabled', !capabilities.has(capability));
        }
        // `can_collate` is `*copies != '\0' && atoi (copies) > 1` (:1570-1571).
        const copies = Number.parseInt(this._copiesInput.value, 10);
        const canCollate = this._copiesInput.value !== '' && Number.isFinite(copies) && copies > 1;
        this._collateCheck.toggleAttribute('disabled', !canCollate || !capabilities.has('collate'));
        this._reverseCheck.toggleAttribute('disabled', !capabilities.has('reverse'));
        this._copiesInput.toggleAttribute('disabled', !capabilities.has('copies'));
        // `set_embed_page_setup` (:3425-3426) is the ONLY thing that makes these two
        // sensitive; with it FALSE they keep the `.ui`'s `sensitive=0` and their handlers
        // are not connected, so a selection cannot reach the page setup.
        this._paperDrop.toggleAttribute('disabled', !this.embedPageSetup);
        this._orientationDrop.toggleAttribute('disabled', !this.embedPageSetup);

        // `update_collate_icon` (:1920-1949): the numbers, and the second column's
        // visibility, which is the copies count and nothing else.
        const collate = this._collateCheck.checked;
        const reverse = this._reverseCheck.checked;
        const preview = this.contentArea.querySelector<HTMLElement>('.adw-print-collate-preview');
        if (preview !== null) {
            preview.dataset.columnA = String(collate ? (reverse ? 1 : 2) : reverse ? 2 : 1);
            preview.dataset.columnB = String(collate ? (reverse ? 2 : 1) : reverse ? 1 : 2);
            preview.dataset.secondColumn = String(canCollate);
        }

        // Print is sensitive only for a printer that accepts jobs (:1842-1876), and Preview
        // is VISIBLE only with the PREVIEW capability (:1587-1588).
        const prints = this._selected !== null && (this._selected.acceptsJobs ?? true);
        this._printButton.toggleAttribute('disabled', !prints);
        this._previewButton.hidden = !capabilities.has('preview');

        // The sheet preview follows the page setup and the two-sided pages per sheet.
        const paper = this.contentArea.querySelector<HTMLElement>('.adw-print-paper');
        if (paper !== null) {
            const size = paperSizeOf(this._pageSetup);
            const reverseLandscape = this._pageSetup.orientation === 'reverse-portrait';
            paper.style.aspectRatio = `${
                this._pageSetup.orientation === 'landscape' || reverseLandscape
                    ? `${size.height} / ${size.width}`
                    : `${size.width} / ${size.height}`
            }`;
        }
        const grid = this.contentArea.querySelector<HTMLElement>('.adw-print-number-up');
        if (grid !== null) grid.dataset.cells = '1';

        this._conflictsEl.hidden = true;
    }
}

customElements.define('gtk-print-unix-dialog', GtkPrintUnixDialog);
