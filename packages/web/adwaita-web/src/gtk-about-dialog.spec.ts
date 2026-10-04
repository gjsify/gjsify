// DOM-level tests for <gtk-about-dialog>. What is worth asserting is the page
// VISIBILITY derivation — it is the one thing a reader of the rendered dialog cannot work
// out by looking, and the three rules in `gtkaboutdialog.c` disagree with each other on
// purpose: a licence page for a CUSTOM licence only, a system page for any text at all, and
// a credits page for any credit list or extra section.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkAboutDialog } from './elements/gtk-about-dialog.js';
import { splitLinks } from './elements/gtk-about-dialog.js';

function mount(attrs: Record<string, string> = {}): { el: GtkAboutDialog; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-about-dialog') as GtkAboutDialog;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

/** The pages the stack switcher currently offers. */
function pages(el: GtkAboutDialog): string[] {
    return [...el.querySelectorAll('.adw-gtk-about-dialog-switcher-item')].map((item) => item.textContent ?? '');
}

export const GtkAboutDialogTest = async () => {
    await describe('<gtk-about-dialog> chrome', async () => {
        await it('is an AdwDialog sheet, and its title is "About <name>"', () => {
            // update_name_version (gtkaboutdialog.c:1066-1073) — the WINDOW title, which
            // the headerbar does not display: the `.ui` gives the titlebar a stack switcher
            // and no title widget.
            const { el, host } = mount({ 'program-name': 'Calculator' });
            expect(el.classList.contains('adw-dialog')).toBe(true);
            expect(el.title).toBe('About Calculator');
            expect(el.querySelector('.adw-dialog-title')).toBe(null);
            host.remove();
        });

        await it('an unset program-name falls back to the application name', () => {
            // gtk_about_dialog_set_program_name (gtkaboutdialog.c:1095-1112) —
            // `g_get_application_name ()`, which in a document is its own title.
            const { el, host } = mount();
            expect(el.title).toBe(`About ${document.title}`);
            expect(el.querySelector('.adw-gtk-about-dialog-name')?.textContent).toBe(document.title);
            host.remove();
        });

        await it('presenting traps focus and closing gives it back', () => {
            const opener = document.createElement('button');
            document.body.appendChild(opener);
            opener.focus();
            const { el, host } = mount({ 'program-name': 'Calculator' });
            el.present();
            expect(el.open).toBe(true);
            // The role and `aria-modal` live on the modal SURFACE, as for every dialog
            // (`surface` in keyboard-operable.spec.ts) — the host carries neither.
            expect(el.querySelector('.adw-dialog-box')?.getAttribute('aria-modal')).toBe('true');
            el.close();
            expect(el.open).toBe(false);
            expect(document.activeElement).toBe(opener);
            opener.remove();
            host.remove();
        });
    });

    await describe('<gtk-about-dialog> page visibility', async () => {
        await it('shows no switcher for a dialog with nothing extra', () => {
            // update_stack_switcher_visibility (gtkaboutdialog.c:657-670) — the switcher is
            // visible only when one of the three pages is, so a plain about dialog has an
            // EMPTY headerbar, exactly as in GTK.
            const { el, host } = mount({ 'program-name': 'Calculator', version: '1.0' });
            expect(pages(el)).toStrictEqual([]);
            expect(el.querySelector('.adw-gtk-about-dialog-switcher')?.hasAttribute('hidden')).toBe(true);
            host.remove();
        });

        await it('a licence page needs a CUSTOM licence with text', () => {
            // update_license_button_visibility (gtkaboutdialog.c:686-696) — the type AND a
            // non-empty string, which is why `license-type="mit-x11"` alone shows nothing.
            const { el, host } = mount({ 'program-name': 'Calculator', 'license-type': 'mit-x11' });
            expect(pages(el)).toStrictEqual([]);
            el.license = 'Permission is hereby granted, free of charge, …';
            expect(pages(el)).toStrictEqual(['License']);
            host.remove();
        });

        await it('a system page needs text, and clearing it takes the page away', () => {
            // update_system_button_visibility (gtkaboutdialog.c:700-710).
            const { el, host } = mount({ 'program-name': 'Calculator' });
            el.setAttribute('system-information', 'GTK 4.24.0\nglibc 2.42');
            expect(pages(el)).toStrictEqual(['System']);
            el.removeAttribute('system-information');
            expect(pages(el)).toStrictEqual([]);
            host.remove();
        });

        await it('credits come from authors, documenters, artists, translators or a section', () => {
            // populate_credits_page (gtkaboutdialog.c:2029-2080) and its visibility rule
            // (update_credits_button_visibility, :700-717).
            const { el, host } = mount({ 'program-name': 'Calculator' });
            el.authors = ['Ada Lovelace <ada@example.org>', 'Grace Hopper'];
            expect(pages(el)).toStrictEqual(['Credits']);
            el.authors = [];
            expect(pages(el)).toStrictEqual([]);
            el.addCreditSection('Reviewed by', ['Barbara Liskov']);
            expect(pages(el)).toStrictEqual(['Credits']);
            host.remove();
        });

        await it('an untranslated translator-credits sentinel shows no credits page', () => {
            // :2064-2068 — the string "translator-credits" comes back unchanged from gettext
            // in an untranslated locale, and showing THAT to the user is the bug.
            const { el, host } = mount({ 'program-name': 'Calculator' });
            el.translatorCredits = 'translator-credits';
            expect(pages(el)).toStrictEqual([]);
            el.translatorCredits = 'Ada Lovelace\nGrace Hopper';
            expect(pages(el)).toStrictEqual(['Credits']);
            host.remove();
        });
    });

    await describe('<gtk-about-dialog> content', async () => {
        await it('the main page shows version, comments, website, copyright and licence', () => {
            const { el, host } = mount({
                'program-name': 'Calculator',
                version: '48.1',
                comments: 'A four-function calculator.',
                website: 'https://gitlab.gnome.org/World/gnome-calculator',
                'website-label': 'GNOME Calculator',
                copyright: '© 2026 The GNOME Project',
            });
            const main = el.querySelector('.adw-gtk-about-dialog-page[data-page="main"]')!;
            expect(main.querySelector('.adw-gtk-about-dialog-version')?.textContent).toBe('48.1');
            expect(main.querySelector('.adw-gtk-about-dialog-comments')?.textContent).toBe(
                'A four-function calculator.',
            );
            // update_website (gtkaboutdialog.c:1009-1041) — the LABEL is the link text when
            // one is set, and the word "Website" when it is not.
            expect(main.querySelector('a.adw-gtk-about-dialog-website')?.textContent).toBe('GNOME Calculator');
            expect(main.querySelector('a.adw-gtk-about-dialog-website')?.getAttribute('href')).toBe(
                'https://gitlab.gnome.org/World/gnome-calculator',
            );
            expect(main.querySelector('.adw-gtk-about-dialog-copyright')?.textContent).toBe('© 2026 The GNOME Project');
            host.remove();
        });

        await it('a website with no label links the bare word "Website"', () => {
            const { el, host } = mount({
                'program-name': 'Calculator',
                website: 'https://gjsify.org',
            });
            expect(el.querySelector('a.adw-gtk-about-dialog-website')?.textContent).toBe('Website');
            host.remove();
        });

        await it('a known licence type writes the warranty preamble and wraps it', async () => {
            // gtk_about_dialog_set_license_type (gtkaboutdialog.c:2259-2313) — a licence
            // other than CUSTOM OVERWRITES `license` with the disclaimer, links it to that
            // licence's URL and sets wrap-license TRUE. The disclaimer is the MAIN page's
            // label (`gtk_label_set_markup`, :2354), NOT a stack page: the License TAB
            // needs CUSTOM with text (`update_license_button_visibility`, :674-685).
            const { el, host } = mount({ 'program-name': 'Calculator', website: 'https://gjsify.org' });
            el.setAttribute('license-type', 'gpl-3-0');
            const licence = el.querySelector('.adw-gtk-about-dialog-license')!;
            expect(licence.textContent).toContain('absolutely no warranty');
            const link = licence.querySelector('a')!;
            expect(link.getAttribute('href')).toBe('https://www.gnu.org/licenses/gpl-3.0.html');
            expect(link.textContent).toBe('GNU General Public License, version 3 or later');
            expect(el.wrapLicense).toBe(false);
            expect(pages(el)).toStrictEqual([]);
            host.remove();
        });

        await it('licence and system text turn <…> and bare URLs into links', async () => {
            const { el, host } = mount({
                'program-name': 'Calculator',
                'system-information': 'Build host: <build@example.org>\nDocs: https://gjsify.org/gtk end',
            });
            el.setAttribute('system-information', 'Build host: <build@example.org>\nDocs: https://gjsify.org/gtk end');
            await Promise.resolve();
            // Lazy population: the System page is built the first time it is SHOWN
            // (stack_visible_child_notify, gtkaboutdialog.c:297-333), so open it first.
            el.showPage('system');
            const page = el.querySelector('.adw-gtk-about-dialog-page[data-page="system"]')!;
            const mail = page.querySelector('a[href^="mailto:"]');
            const url = page.querySelector('a[href="https://gjsify.org/gtk"]');
            expect(mail?.textContent).toBe('build@example.org');
            expect(url?.textContent).toBe('https://gjsify.org/gtk');
            host.remove();
        });

        await it("the credits page names every section in the C's order", () => {
            const { el, host } = mount({ 'program-name': 'Calculator' });
            el.authors = ['Ada Lovelace'];
            el.documenters = ['Grace Hopper'];
            el.translatorCredits = 'Barbara Liskov';
            el.artists = ['Margaret Hamilton'];
            el.addCreditSection('Reviewed by', ['Tony Hoare']);
            el.showPage('credits');
            const headings = [...el.querySelectorAll('.adw-gtk-about-dialog-credits-heading')].map(
                (heading) => heading.textContent,
            );
            expect(headings).toStrictEqual([
                'Created by',
                'Documented by',
                'Translated by',
                'Design by',
                'Reviewed by',
            ]);
            host.remove();
        });
    });

    await describe('<gtk-about-dialog> activate-link', async () => {
        await it('a link click raises a cancelable activate-link', () => {
            // emit_activate_link (gtkaboutdialog.c:646-655) — BOOLEAN__STRING with the
            // true-handled accumulator, which is what `preventDefault()` spells.
            const { el, host } = mount({ 'program-name': 'Calculator', website: 'https://gjsify.org' });
            const seen: unknown[] = [];
            el.addEventListener('activate-link', (event) => {
                seen.push((event as CustomEvent).detail);
                event.preventDefault();
            });
            el.querySelector('a.adw-gtk-about-dialog-website')!.dispatchEvent(
                new MouseEvent('click', { bubbles: true, cancelable: true }),
            );
            expect(seen).toStrictEqual([{ uri: 'https://gjsify.org' }]);
            host.remove();
        });
    });

    await describe('<gtk-about-dialog> link scanning', async () => {
        await it('splits angle-bracket emails, bare URLs and plain text', () => {
            // text_buffer_new (gtkaboutdialog.c:1903-2028) — the three shapes, in order.
            expect(splitLinks('a <b@c.org> d')).toStrictEqual([
                { text: 'a ', uri: null },
                { text: 'b@c.org', uri: 'mailto:b@c.org' },
                { text: ' d', uri: null },
            ]);
            expect(splitLinks('see https://gjsify.org/x now')).toStrictEqual([
                { text: 'see ', uri: null },
                { text: 'https://gjsify.org/x', uri: 'https://gjsify.org/x' },
                { text: ' now', uri: null },
            ]);
        });

        await it('leaves a name that is only a word alone', () => {
            expect(splitLinks('Ada Lovelace')).toStrictEqual([{ text: 'Ada Lovelace', uri: null }]);
        });
    });
};
