// <adw-page-setup-unix-dialog> — the browser counterpart of `GtkPageSetupUnixDialog`:
// the page-setup dialog Unix platforms have instead of a native one, which is a
// two-column grid — "Format for:" and "Paper size:" drop downs, a label that reports the
// chosen sheet's size and margins, and four orientation radios — over the Cancel / Apply
// action area (gtkpagesetupunixdialog.ui).
//
// The DIALOG CHROME IS `<adw-dialog>`'s, not a copy: this element extends it, so the
// scrim, the sheet, `present()`/`close()`, `can-close`, Escape, the Tab trap and the
// return-focus are the ones `adw-dialog.ts` owns. There is no `aria-modal` below for the
// reason `modal-surface.ts` exists.
//
// WHAT IS PORTED FROM `gtkpagesetupunixdialog.c`
//
//   · the twelve `common_paper_sizes` (:121-134) in `fill_paper_sizes_from_printer`
//     (:470-491), each with `gtk_paper_size_set_paper_size_and_default_margins`'s
//     defaults — all of `src/page-setup.ts`, which holds the sizes, the margins and the
//     `double_to_string` munging (:594-628) the label is built from;
//   · `paper_size_changed` (:635-758): selecting a size rewrites the label to
//     `W × H unit` and puts the four margins in its TOOLTIP, and selecting the
//     `Manage Custom Sizes…` row snaps back to the previous setup and opens the custom
//     paper dialog — which is not reachable here (see below), so the row falls back to the
//     previous setup exactly as the C does before it presents anything;
//   · `get_orientation` / `set_orientation` (:788-838): four check buttons in one group,
//     read and written through the same four members;
//   · `set_page_setup` (:823-833) and `get_page_setup` (:840-863): the property is the
//     page setup, and reading it returns the current SELECTION with the orientation the
//     radios hold — the size lookup walks the drop-down's model, which is why setting a
//     setup whose margins no row has appends it (`set_paper_size`, :429-467 with
//     `add_item` TRUE);
//   · `set_print_settings` (:897-931) / `get_print_settings` (:940): the only thing a
//     print settings object does here is select the printer named by its
//     `format-for-printer` key, and `printer_changed_callback` (:557-609) writes that key
//     back whenever the printer changes;
//   · `gtk_page_setup_unix_dialog_new` (:771-786): a NULL title means "Page Setup";
//   · `match_func` (:235-238): a VIRTUAL printer — the "Any Printer" row every dialog
//     starts with — is not a real target, so selecting it falls back to the common paper
//     sizes instead of a printer's own list.
//
// NOT PORTED, and it needs a print subsystem rather than a browser: the printer list. GTK
// builds it from `gtk_print_backend_load_modules` (:397-420), i.e. CUPS over D-Bus. With
// no backends there is exactly the row the C synthesises in code — "Any Printer" / "For
// portable documents" (:281-297) — plus whatever `printers` a caller supplies, which is
// the honest shape for a page: the list is an INPUT here, not a discovery. The
// `Manage Custom Sizes…` row is present and behaves as the C does before it presents the
// custom-paper dialog, which needs the same backends to read and write the user's
// printer's paper list.
//
// Attributes: `title`, `open`, `can-close`, `content-width`, `content-height`,
// `presentation-mode`, `show-header` from the `<adw-dialog>` chrome it extends. The widget
// declares NO GObject properties of its own — `page-setup` and `print-settings` are
// `GtkPageSetup` / `GtkPrintSettings` OBJECTS, which is why they are element properties
// carrying the plain data `src/page-setup.ts` defines.
//
// Properties: `pageSetup` (get/set, the plain `PageSetup`), `printSettings` (get/set, the
// one `format-for-printer` key), `printers` (get/set, `{ name, location }[]`).
//
// Events: the base class's `notify::open` (`{ open }`) and `closed`, plus `response`
// (detail `{ responseId }`) for the action area's two buttons — GTK_RESPONSE_CANCEL (-6)
// and GTK_RESPONSE_OK (-5), the ids `gtk_dialog_add_buttons` passes.
//
// A11y: role `dialog` from `AdwModalSurface`; the two drop downs are labelled by the
// grid labels beside them (`aria-labelledby`), and the four orientation buttons are one
// radio group, as GTK's `group` property makes them.
//
// Reference: refs/gtk/gtk/print/gtkpagesetupunixdialog.c (every rule above, by line)
// Reference: refs/gtk/gtk/print/ui/gtkpagesetupunixdialog.ui (the grid and its labels)
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialogs.scss:36-42
//   (`window.pagesetup:not(.ssd-frame)`: a FLAT titlebar)
// Reference: packages/web/adwaita-web/src/elements/adw-dialog.ts (the chrome reused)
// Copyright (c) 2006-2024 Red Hat, Inc. / Christian Persch / The GTK authors. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the page setup is
// the plain data of packages/web/adwaita-web/src/page-setup.ts.

import {
    COMMON_PAPER_SIZES,
    type PageOrientation,
    type PageSetup,
    type PageUnit,
    defaultMargins,
    defaultPageSetup,
    pageSetupEquals,
    paperMarginsTooltip,
    paperSizeLabel,
    paperSizeOf,
} from '../page-setup.js';

import { AdwDialog } from './adw-dialog.js';

/** `GTK_RESPONSE_CANCEL` / `GTK_RESPONSE_OK` — what `gtk_dialog_add_buttons` passes. */
const RESPONSE_CANCEL = -6;
const RESPONSE_OK = -5;

/** The pseudo printer every dialog starts with (gtkpagesetupunixdialog.c:281-297). */
const ANY_PRINTER = { name: 'Any Printer', location: 'For portable documents' };

/** The last row of the paper-size drop down, and the label it carries. */
const MANAGE_CUSTOM = 'Manage Custom Sizes…';

/** The four orientation check buttons, in the `.ui`'s grid order. */
const ORIENTATIONS: Array<[PageOrientation, string]> = [
    ['portrait', 'Portrait'],
    ['reverse-portrait', 'Reverse portrait'],
    ['landscape', 'Landscape'],
    ['reverse-landscape', 'Reverse landscape'],
];

/** One row of the "Format for:" drop down. */
export interface PrinterInfo {
    /** `gtk_printer_get_name` — what `format-for-printer` is compared against. */
    readonly name: string;
    /** `gtk_printer_get_location`, the dimmed second line of the row. */
    readonly location?: string;
}

/** The one `GtkPrintSettings` key this dialog reads or writes. */
export interface PrintSettingsData {
    /** `format-for-printer` — the printer name the settings belong to. */
    readonly 'format-for-printer'?: string;
}

export class GtkPageSetupUnixDialog extends AdwDialog {
    private _built = false;

    static get observedAttributes(): string[] {
        // `GtkPageSetupUnixDialog` declares NO GObject properties of its own: `page-setup`
        // and `print-settings` are `GtkPageSetup` / `GtkPrintSettings` objects, which an
        // attribute cannot carry, so they are the plain-data properties below. What is
        // observed is the `<adw-dialog>` chrome this element extends.
        return [...AdwDialog.observedAttributes];
    }
    private _printerEl!: HTMLElement & { selected: number };
    private _paperEl!: HTMLElement & { selected: number };
    private _sizeLabelEl!: HTMLDivElement;
    private _radios = new Map<PageOrientation, HTMLElement & { checked: boolean }>();
    private _printers: PrinterInfo[] = [];
    /** The setups in the drop-down, in the order the C appends them. */
    private _setups: PageSetup[] = [];
    /** `last_setup` — the size the drop down is put back to when a row is not a size. */
    private _lastSetup: PageSetup | null = null;
    private _printSettings: PrintSettingsData | null = null;
    private _unit: PageUnit = 'mm';

    /** The unit the two labels speak — `_gtk_print_get_default_user_units` is mm here. */
    get unit(): PageUnit {
        return this._unit;
    }

    set unit(value: PageUnit) {
        this._unit = value;
        if (this._built) this._renderSetup();
    }

    /**
     * The printer list GTK discovers through a print backend. A browser has no CUPS, so
     * this is an INPUT; the row every dialog starts with is added by the element itself.
     */
    get printers(): PrinterInfo[] {
        return this._printers.map((printer) => ({ ...printer }));
    }

    set printers(value: readonly PrinterInfo[]) {
        this._printers = value.map((printer) => ({ ...printer }));
        if (this._built) this._renderSetup();
    }

    /**
     * The current page setup — `gtk_page_setup_unix_dialog_get_page_setup`, which returns
     * the SELECTED setup with the orientation the radios hold.
     */
    get pageSetup(): PageSetup {
        return { ...this._current(), orientation: this._orientation() };
    }

    /**
     * `gtk_page_setup_unix_dialog_set_page_setup`: select the matching row, appending the
     * setup when no row matches (`set_paper_size` with `add_item` TRUE), then set the
     * orientation radios.
     */
    set pageSetup(value: PageSetup) {
        const index = this._setups.findIndex((setup) => pageSetupEquals(setup, value));
        if (index < 0) {
            this._setups.push(value);
            this._paperEl.selected = this._setups.length - 1;
        } else if (this._paperEl.selected !== index) {
            this._paperEl.selected = index;
        }
        this._setOrientation(value.orientation);
        if (this._built) this._renderSetup();
    }

    /** `gtk_page_setup_unix_dialog_get_print_settings` — the object, not a copy of it. */
    get printSettings(): PrintSettingsData | null {
        return this._printSettings;
    }

    /** Selects the printer named by `format-for-printer`, as the setter does. */
    set printSettings(value: PrintSettingsData | null) {
        this._printSettings = value;
        const wanted = value?.['format-for-printer'];
        if (wanted === undefined) return;
        const index = this._printerRows().findIndex((printer) => printer.name === wanted);
        if (index >= 0) this._printerEl.selected = index;
    }

    connectedCallback(): void {
        if (this._built) {
            super.connectedCallback();
            return;
        }
        super.connectedCallback();
        // `gtk_page_setup_unix_dialog_new`: a NULL title means "Page Setup".
        if (!this.hasAttribute('title')) this.setAttribute('title', 'Page Setup');

        // The twelve common sizes are what the dialog starts with (`init` fills them
        // from the printer, and with no printer that is the common list) — without
        // them the drop-down holds only the `Manage Custom Sizes…` row.
        this._fillPaperSizes();
        // The base adopts the author's light-DOM children into `contentArea` on
        // connect; rebuilding around them must keep them, AFTER the dialog's own UI —
        // which is also where children appended later land (`slotted-children.spec.ts`
        // pins the equality, path and index).
        const adopted = [...this.contentArea.childNodes];
        this.contentArea.replaceChildren(this._build());
        for (const node of adopted) this.contentArea.appendChild(node);
        this._renderSetup();
        // The dialog opens on the default setup — `gtk_page_setup_new` is A4 — so the
        // drop down selects the row that matches it, not the list's first row. AFTER
        // the render above: setting the model clamps the selection, so selecting first
        // would be clamped away and the label would read the wrong sheet.
        const initial = this._setups.findIndex((setup) => setup.paperSize === defaultPageSetup().paperSize);
        if (initial >= 0 && this._paperEl.selected !== initial) {
            this._paperEl.selected = initial;
            this._renderSetup();
        }
        // `_built` goes last: either `setAttribute` above re-enters through
        // `attributeChangedCallback`, and rendering a half-built dialog throws.
        this._built = true;
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        super.attributeChangedCallback(name, oldValue, newValue);
        if (!this._built || oldValue === newValue) return;
        if (name === 'title') return;
        this._renderSetup();
    }

    // ------------------------------------------------------------- building

    private _build(): HTMLElement {
        const grid = document.createElement('div');
        grid.className = 'adw-page-setup-grid';

        this._printerEl = this._dropDown('printer', '_Format for:');
        this._printerEl.addEventListener('notify::selected', () => this._printerChanged());
        grid.append(this._label('_Format for:'), this._printerEl);

        this._paperEl = this._dropDown('paper', '_Paper size:');
        this._paperEl.addEventListener('notify::selected', () => this._paperChanged());
        grid.append(this._label('_Paper size:'), this._paperEl);

        this._sizeLabelEl = document.createElement('div');
        this._sizeLabelEl.className = 'adw-page-setup-size-label';
        this._sizeLabelEl.setAttribute('aria-live', 'polite');
        grid.append(this._sizeLabelEl);

        grid.append(this._label('_Orientation:'));
        for (const [orientation, label] of ORIENTATIONS) {
            const radio = document.createElement('adw-radio') as HTMLElement & { checked: boolean };
            radio.className = 'adw-page-setup-orientation';
            radio.setAttribute('label', label);
            // One group, as `group: portrait_radio` makes them in the `.ui`.
            radio.setAttribute('name', 'adw-page-setup-orientation');
            radio.setAttribute('value', orientation);
            radio.addEventListener('notify::checked', () => this._orientationChanged());
            this._radios.set(orientation, radio);
            grid.appendChild(radio);
        }

        grid.appendChild(this._actions());
        return grid;
    }

    /** A `GtkDropDown` with its label as the accessible name, `column-span 3`. */
    private _dropDown(kind: 'printer' | 'paper', label: string): HTMLElement & { selected: number } {
        const dropdown = document.createElement('gtk-drop-down') as HTMLElement & { selected: number };
        dropdown.className = `adw-page-setup-${kind}`;
        dropdown.setAttribute('aria-label', label.replace('_', ''));
        return dropdown;
    }

    /** A grid label — right-aligned, `use-underline` in the `.ui`, no keyvals here. */
    private _label(text: string): HTMLElement {
        const label = document.createElement('div');
        label.className = 'adw-page-setup-label';
        label.textContent = text.replace('_', '');
        return label;
    }

    /**
     * The `.dialog-action-area` row: `_Cancel` (GTK_RESPONSE_CANCEL) and `_Apply`
     * (GTK_RESPONSE_OK), which is the label `gtk_dialog_add_buttons` gives the OK response
     * in this dialog. Escape is the close action the base class already binds.
     */
    private _actions(): HTMLElement {
        const actions = document.createElement('div');
        actions.className = 'adw-page-setup-actions';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'adw-page-setup-cancel';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => this._respond(RESPONSE_CANCEL));

        const apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'adw-page-setup-apply suggested-action';
        apply.textContent = 'Apply';
        apply.addEventListener('click', () => this._respond(RESPONSE_OK));

        actions.append(cancel, apply);
        return actions;
    }

    private _respond(responseId: number): void {
        this.dispatchEvent(new CustomEvent('response', { bubbles: true, detail: { responseId } }));
        this.close();
    }

    // ------------------------------------------------------------- rendering

    /** The drop-down's rows: the pseudo printer first, then the caller's. */
    private _printerRows(): PrinterInfo[] {
        return [ANY_PRINTER, ...this._printers];
    }

    /**
     * `fill_paper_sizes_from_printer` (:470-491): with no printer — which includes the
     * "Any Printer" row, because `printer_changed_callback` clears it before the call
     * (:576-580) — the list is the twelve common sizes. A REAL printer would bring its
     * own `gtk_printer_list_papers`, which needs the backend this port has not.
     */
    private _fillPaperSizes(): void {
        this._setups = COMMON_PAPER_SIZES.map((size) => ({
            paperSize: size.name,
            orientation: 'portrait' as PageOrientation,
            margins: defaultMargins(size),
        }));
    }

    /** The selected setup, before the radios' orientation is folded in. */
    private _current(): PageSetup {
        return this._setups[this._paperEl.selected] ?? defaultPageSetup();
    }

    private _orientation(): PageOrientation {
        for (const [orientation, radio] of this._radios) if (radio.checked) return orientation;
        return 'portrait';
    }

    private _setOrientation(orientation: PageOrientation): void {
        const radio = this._radios.get(orientation);
        if (radio !== undefined) radio.checked = true;
    }

    private _renderSetup(): void {
        const printers = this._printerRows();
        this._printerEl.setAttribute('model', JSON.stringify(printers.map((printer) => printer.name)));
        if (this._printerEl.selected >= printers.length) this._printerEl.selected = 0;

        const labels = [...this._setups.map((setup) => paperSizeOf(setup).displayName), MANAGE_CUSTOM];
        this._paperEl.setAttribute('model', JSON.stringify(labels));
        if (this._paperEl.selected >= labels.length) this._paperEl.selected = 0;

        const setup = this._current();
        this._sizeLabelEl.textContent = paperSizeLabel(setup, this._unit);
        this._sizeLabelEl.title = paperMarginsTooltip(setup, this._unit);
    }

    /** `printer_changed_callback` (:557-609): the paper list follows the printer. */
    private _printerChanged(): void {
        const selected = this._printerRows()[this._printerEl.selected];
        // "Any Printer" is not a target: `match_func` (:235) filters virtual printers out
        // of the list, and `printer_changed_callback` clears the row before refilling.
        if (selected === undefined || selected.name === ANY_PRINTER.name) this._fillPaperSizes();
        this._renderSetup();
        // The `format-for-printer` key is written on every printer change, but only if the
        // dialog was GIVEN a print settings object — the C guards it with
        // `if (dialog->print_settings)` (:597), and a dialog that never had one keeps none.
        if (this._printSettings !== null) this._printSettings = { 'format-for-printer': selected?.name };
    }

    /** `paper_size_changed` (:635-758). */
    private _paperChanged(): void {
        const selected = this._paperEl.selected;
        if (selected >= this._setups.length) {
            // The `Manage Custom Sizes…` row: the C puts the drop down back to the
            // previous setup and THEN presents the custom paper dialog, which needs the
            // print backends this port has not. The put-back is the half that is here.
            const fallback = this._lastSetup ?? defaultPageSetup();
            this._setups.push(fallback);
            this._paperEl.selected = this._setups.length - 1;
            this._renderSetup();
            return;
        }
        this._lastSetup = this._setups[selected] ?? null;
        this._renderSetup();
    }

    /** The radios' side of `get_orientation` — the label follows them. */
    private _orientationChanged(): void {
        if (!this._built) return;
        this._setups[this._paperEl.selected] = {
            ...this._current(),
            orientation: this._orientation(),
        };
        this._renderSetup();
    }
}

customElements.define('gtk-page-setup-unix-dialog', GtkPageSetupUnixDialog);
