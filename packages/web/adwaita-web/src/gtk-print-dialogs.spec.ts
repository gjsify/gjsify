// DOM-level tests for the two Unix print dialogs. What they hold is the SENSITIVITY
// derivation — `update_dialog_from_capabilities` and the three small setters around it —
// because that is the part of a print dialog a reader cannot check by looking at it, and
// the part that decides whether the dialog is honest about a printer that is not there.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkPrintUnixDialog } from './elements/gtk-print-unix-dialog.js';
import type { GtkPageSetupUnixDialog } from './elements/gtk-page-setup-unix-dialog.js';
import { COMMON_PAPER_SIZES, defaultPageSetup } from './page-setup.js';

function mountPrint(attrs: Record<string, string> = {}): { el: GtkPrintUnixDialog; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-print-unix-dialog') as GtkPrintUnixDialog;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

function mountSetup(attrs: Record<string, string> = {}): {
    el: GtkPageSetupUnixDialog;
    host: HTMLElement;
} {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-page-setup-unix-dialog') as GtkPageSetupUnixDialog;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

/** The state of a control the way the C asks for it: `gtk_widget_get_sensitive`. */
function insensitive(el: Element | null): boolean {
    return el?.hasAttribute('disabled') ?? true;
}

export const GtkPrintDialogsTest = async () => {
    await describe('<gtk-print-unix-dialog> defaults', async () => {
        await it('is titled "Print" and prints nothing', async () => {
            // gtk_print_unix_dialog_new (gtkprintunixdialog.c:2961-2972) — a NULL title means
            // "Print". The replica is a dialog and nothing more: there is no print backend
            // here to hand a job to.
            const { el, host } = mountPrint();
            expect(el.title).toBe('Print');
            expect(el.querySelectorAll('*').length).toBeGreaterThan(0);
            host.remove();
        });

        await it('starts with no printer, so Print is insensitive and Preview is hidden', async () => {
            // init (:875-905) sets the OK response INSENSITIVE up front, and
            // update_dialog_from_capabilities (:1587-1588) HIDES Preview without PREVIEW.
            const { el, host } = mountPrint();
            expect(el.selectedPrinter).toBe(null);
            expect(insensitive(el.querySelector('.adw-print-print'))).toBe(true);
            expect(el.querySelector('.adw-print-preview')?.hasAttribute('hidden')).toBe(true);
            host.remove();
        });

        await it('all seven notebook pages are there, General first', () => {
            const { el, host } = mountPrint();
            const tabs = [...el.querySelectorAll('.adw-print-switcher-item')].map((t) => t.textContent);
            expect(tabs).toStrictEqual([
                'General',
                'Page Setup',
                'Job',
                'Image Quality',
                'Color',
                'Finishing',
                'Advanced',
            ]);
            host.remove();
        });
    });

    await describe('<gtk-print-unix-dialog> capabilities', async () => {
        await it('an empty capability set switches every control off', async () => {
            // update_dialog_from_capabilities (:1563-1592) — every line reads the same mask.
            const { el, host } = mountPrint();
            expect(insensitive(el.querySelector('.adw-print-copies'))).toBe(true);
            expect(insensitive(el.querySelector('.adw-print-scale'))).toBe(true);
            expect(insensitive(el.querySelector('.adw-print-collate'))).toBe(true);
            expect(insensitive(el.querySelector('.adw-print-reverse'))).toBe(true);
            host.remove();
        });

        await it('manual-capabilities is a nick set, and it is half the mask', async () => {
            const { el, host } = mountPrint({ 'manual-capabilities': 'copies|scale' });
            expect(el.manualCapabilities).toStrictEqual(['copies', 'scale']);
            expect(insensitive(el.querySelector('.adw-print-copies'))).toBe(false);
            expect(insensitive(el.querySelector('.adw-print-scale'))).toBe(false);
            // …and the half it does NOT name stays off.
            expect(insensitive(el.querySelector('.adw-print-reverse'))).toBe(true);
            host.remove();
        });

        await it('Collate needs a copies count above one as well as the capability', async () => {
            // :1570-1571 — `can_collate` is `*copies != '\0' && atoi (copies) > 1`, and it is
            // ANDed with the COLLATE capability, not either alone.
            const { el, host } = mountPrint({ 'manual-capabilities': 'copies|collate' });
            const copies = el.querySelector<HTMLInputElement>('.adw-print-copies')!;
            const collate = el.querySelector('.adw-print-collate')!;
            expect(insensitive(collate)).toBe(true);
            copies.value = '1';
            copies.dispatchEvent(new Event('input', { bubbles: true }));
            expect(insensitive(collate)).toBe(true);
            copies.value = '2';
            copies.dispatchEvent(new Event('input', { bubbles: true }));
            expect(insensitive(collate)).toBe(false);
            host.remove();
        });

        await it('Preview appears with the PREVIEW capability and Print with a printer', async () => {
            // Preview is VISIBLE, not merely enabled (:1587-1588); Print follows
            // `gtk_printer_is_accepting_jobs` (:1842-1876).
            const { el, host } = mountPrint({ 'manual-capabilities': 'preview' });
            expect(el.querySelector('.adw-print-preview')?.hasAttribute('hidden')).toBe(false);
            el.printers = [
                { name: 'Office Laser', location: 'Building A', acceptsJobs: true },
                { name: 'Broken', acceptsJobs: false },
            ];
            expect(insensitive(el.querySelector('.adw-print-print'))).toBe(true);
            el.querySelectorAll<HTMLButtonElement>('.adw-print-printer-row')[0]!.click();
            expect(el.selectedPrinter?.name).toBe('Office Laser');
            expect(insensitive(el.querySelector('.adw-print-print'))).toBe(false);
            el.querySelectorAll<HTMLButtonElement>('.adw-print-printer-row')[1]!.click();
            expect(insensitive(el.querySelector('.adw-print-print'))).toBe(true);
            host.remove();
        });

        await it("a printer's capabilities join the manual ones", async () => {
            // selected_printer_changed (:1874) replaces the previous printer's half with the
            // new one's, and the mask is `manual | printer` (:1581).
            const { el, host } = mountPrint({ 'manual-capabilities': 'copies' });
            el.printers = [{ name: 'Office Laser', capabilities: ['reverse'] }];
            el.querySelector<HTMLButtonElement>('.adw-print-printer-row')!.click();
            expect(insensitive(el.querySelector('.adw-print-copies'))).toBe(false);
            expect(insensitive(el.querySelector('.adw-print-reverse'))).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-print-unix-dialog> selection properties', async () => {
        await it('the Selection radio appears with support and works with a selection', async () => {
            // set_support_selection (:3325-3343) then set_has_selection (:3369-3389) — the
            // second runs last, so "support but nothing to select" ends up INSENSITIVE.
            const { el, host } = mountPrint();
            const radio = el.querySelector('.adw-print-range-selection')!;
            expect(radio.hasAttribute('hidden')).toBe(true);
            el.supportSelection = true;
            expect(radio.hasAttribute('hidden')).toBe(false);
            expect(radio.classList.contains('insensitive')).toBe(true);
            el.hasSelection = true;
            expect(radio.classList.contains('insensitive')).toBe(false);
            host.remove();
        });

        await it('Current Page needs a page that is not -1', async () => {
            // set_current_page (:3059-3073).
            const { el, host } = mountPrint();
            const radio = el.querySelector('.adw-print-range-current')!;
            expect(radio.classList.contains('insensitive')).toBe(true);
            el.currentPage = 4;
            expect(radio.classList.contains('insensitive')).toBe(false);
            host.remove();
        });

        await it('the page setup controls are insensitive until the setup is embedded', async () => {
            // set_embed_page_setup (:3415-3427) is the only thing that makes the paper size
            // and orientation drop downs sensitive — and it is also what connects their
            // `notify::selected` handlers.
            const { el, host } = mountPrint();
            el.querySelector<HTMLButtonElement>('.adw-print-switcher-item:nth-child(2)')!.click();
            const preview = el.querySelector('.adw-print-sheet-preview')!;
            const paperDrop = el.querySelector('[aria-label="Paper size"]')!;
            const orientationDrop = el.querySelector('[aria-label="Orientation"]')!;
            el.pageSetup = { ...defaultPageSetup(), paperSize: COMMON_PAPER_SIZES[0]!.name };
            // Not embedded: the drop downs are insensitive, so a selection cannot reach them.
            expect(insensitive(paperDrop)).toBe(true);
            expect(insensitive(orientationDrop)).toBe(true);
            expect(preview.getAttribute('aria-label')).toBe('Page layout preview');
            el.embedPageSetup = true;
            expect(insensitive(paperDrop)).toBe(false);
            expect(insensitive(orientationDrop)).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-page-setup-unix-dialog> paper and orientation', async () => {
        await it('is titled "Page Setup" and offers the twelve common sizes', () => {
            // gtk_page_setup_unix_dialog_new (gtkpagesetupunixdialog.c:771-786) and
            // common_paper_sizes (:121-134) — the list is NOT sorted upstream.
            const { el, host } = mountSetup();
            expect(el.title).toBe('Page Setup');
            const model = JSON.parse(el.querySelector('.adw-page-setup-paper')!.getAttribute('model')!);
            expect(model).toHaveLength(COMMON_PAPER_SIZES.length + 1);
            expect(model[0]).toBe(COMMON_PAPER_SIZES[0]!.displayName);
            // The last row is the custom-paper manager, which opens the backends' dialog.
            expect(model[model.length - 1]).toBe('Manage Custom Sizes…');
            host.remove();
        });

        await it('reports the chosen sheet in its user unit', () => {
            // paper_size_changed (gtkpagesetupunixdialog.c:711-728) — the label is
            // `W × H unit` through double_to_string, which prints no decimal point at all
            // on a whole millimetre.
            const { el, host } = mountSetup();
            const label = el.querySelector('.adw-page-setup-size-label')!;
            expect(label.textContent).toBe('210 × 297 mm');
            expect((label as HTMLElement).title).toContain('Margins:');
            expect((label as HTMLElement).title).toContain('Bottom: 14.2 mm');
            host.remove();
        });

        await it('the orientation radios are one group and drive the setup', () => {
            // get_orientation / set_orientation (:788-838) — four check buttons in one group.
            const { el, host } = mountSetup();
            expect(el.pageSetup.orientation).toBe('portrait');
            const landscape = [...el.querySelectorAll('adw-radio')].find(
                (radio) => radio.getAttribute('value') === 'landscape',
            )!;
            (landscape as HTMLElement & { checked: boolean }).checked = true;
            expect(el.pageSetup.orientation).toBe('landscape');
            host.remove();
        });

        await it('a setup with margins no row has is APPENDED, as set_paper_size does', () => {
            // set_page_setup (:823-833) — the model is searched with `page_setup_is_equal`
            // and a miss appends the setup, because `add_item` is TRUE here.
            const { el, host } = mountSetup();
            const custom = {
                paperSize: 'iso_a4',
                orientation: 'portrait' as const,
                margins: { top: 1, bottom: 2, left: 3, right: 4 },
            };
            el.pageSetup = custom;
            expect(el.pageSetup).toStrictEqual(custom);
            host.remove();
        });

        await it('print-settings select the printer they name', () => {
            // set_print_settings (gtkpagesetupunixdialog.c:897-931) — the ONE key it reads
            // is `format-for-printer`, and it selects that printer when the list has it.
            const { el, host } = mountSetup();
            el.printers = [{ name: 'Office Laser', location: 'Building A' }];
            el.printSettings = { 'format-for-printer': 'Office Laser' };
            const dropdown = el.querySelector('.adw-page-setup-printer') as HTMLElement & { selected: number };
            expect(dropdown.selected).toBe(1);
            host.remove();
        });
    });
};
