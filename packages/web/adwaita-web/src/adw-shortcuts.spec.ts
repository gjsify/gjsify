// DOM-level behaviour tests for the shortcuts trio — <adw-shortcuts-dialog> and the
// two markup-only objects it holds. Runs in a real browser via the @gjsify/adwaita-web
// browser test axis (tests/browser Playwright harness).
//
// The dialog half is <adw-dialog>'s own spec; what is here is the content model and the
// rules the C states for an item (adw-shortcuts-item.c:19-28).
import { describe, expect, it } from '@gjsify/unit';

import type { AdwShortcutsDialog } from './elements/adw-shortcuts-dialog.js';
import type { AdwShortcutsSection } from './elements/adw-shortcuts-section.js';

type Item = HTMLElement & { hasAccelerator: boolean; subtitle: string; accelerator: string };

function item(title: string, accelerator = '', subtitle = ''): Item {
    const el = document.createElement('adw-shortcuts-item') as Item;
    el.setAttribute('title', title);
    if (accelerator) el.setAttribute('accelerator', accelerator);
    if (subtitle) el.setAttribute('subtitle', subtitle);
    return el;
}

function section(title: string | null, ...items: Item[]): AdwShortcutsSection {
    const el = document.createElement('adw-shortcuts-section') as AdwShortcutsSection;
    if (title !== null) el.setAttribute('title', title);
    el.append(...items);
    return el;
}

function dialog(...sections: AdwShortcutsSection[]): AdwShortcutsDialog {
    const el = document.createElement('adw-shortcuts-dialog') as AdwShortcutsDialog;
    el.setAttribute('title', 'Keyboard Shortcuts');
    el.append(...sections);
    document.body.appendChild(el);
    return el;
}

export const AdwShortcutsTest = async () => {
    await describe('adw-shortcuts-dialog is an adw-dialog', async () => {
        await it('carries the dialog chrome and its title', async () => {
            const dlg = dialog(section('General'));
            // The flat header with the close button is the base's, and the class is
            // `dialog.shortcuts` upstream — which is why the element adds it as a class
            // of its own rather than a wrapper element.
            expect(dlg.classList.contains('adw-dialog')).toBe(true);
            expect(dlg.classList.contains('adw-shortcuts-dialog')).toBe(true);
            expect(dlg.querySelector('.adw-dialog-header')).not.toBeNull();
            expect(dlg.querySelector('.adw-dialog-title')?.textContent).toBe('Keyboard Shortcuts');
            dlg.remove();
        });

        await it('presents and closes through the inherited dialog API', async () => {
            const dlg = dialog(section('General'));
            expect(dlg.open).toBe(false);
            dlg.present();
            expect(dlg.open).toBe(true);
            dlg.close();
            expect(dlg.open).toBe(false);
            dlg.remove();
        });

        await it('holds its sections inside the dialog content area', async () => {
            const dlg = dialog(section('General'), section('Navigation'));
            expect(dlg.sections.length).toBe(2);
            // The sections sit in the base's own content area — no wrapper of this
            // class's own — so the dialog's padding and scrolling wrap them the way
            // they wrap any other child, and a section added later lands there too.
            expect(dlg.sections.every((el) => el.parentElement === dlg.contentArea)).toBe(true);
            dlg.remove();
        });

        await it('routes a section appended after connect into the content area', async () => {
            const dlg = dialog(section('General'));
            const late = section('Navigation');
            dlg.appendChild(late);
            // The routing is a MutationObserver (`bindSlottedChildren`), so the move is
            // a microtask away rather than synchronous with the append.
            await Promise.resolve();
            expect(dlg.sections.length).toBe(2);
            expect(late.parentElement).toBe(dlg.contentArea);
            dlg.remove();
        });
    });

    await describe('adw-shortcuts-section', async () => {
        await it('draws a heading only when it has a title', async () => {
            // The class documents an untitled section as the way to subdivide a section
            // into groups, and libadwaita draws no heading for one.
            const titled = section('General', item('Open Menu', 'F10'));
            const untitled = section(null, item('Move Tab Left', '<Shift><Ctrl>Page_Up'));
            document.body.append(titled, untitled);

            const titledHeading = titled.querySelector('.adw-shortcuts-section-title') as HTMLElement;
            const untitledHeading = untitled.querySelector('.adw-shortcuts-section-title') as HTMLElement;
            expect(titledHeading.hidden).toBe(false);
            expect(untitledHeading.hidden).toBe(true);
            titled.remove();
            untitled.remove();
        });

        await it('exposes its items in document order', async () => {
            const sec = section('General', item('Open Menu', 'F10'), item('Quit', '<Control>Q'));
            document.body.appendChild(sec);
            expect(sec.items.map((el) => el.getAttribute('title'))).toStrictEqual(['Open Menu', 'Quit']);
            sec.remove();
        });
    });

    await describe('adw-shortcuts-item', async () => {
        await it('draws the accelerator as keycaps', async () => {
            const el = item('Open Menu', 'F10');
            document.body.appendChild(el);
            const label = el.querySelector('adw-shortcut-label');
            expect(label?.getAttribute('accelerator')).toBe('F10');
            expect(el.hasAccelerator).toBe(true);
            el.remove();
        });

        await it('draws no keycaps for an item that stands for an action alone', async () => {
            // An accelerator for an action comes from Gtk.Application, which a document
            // has no way to ask, so the row is allowed to carry the action alone.
            const el = item('Preferences');
            el.setAttribute('action-name', 'app.preferences');
            document.body.appendChild(el);
            expect(el.hasAccelerator).toBe(false);
            expect((el.querySelector('adw-shortcut-label') as HTMLElement | null)?.hidden).toBe(true);
            el.remove();
        });

        await it('draws the subtitle only when there is one', async () => {
            const withSub = item('Move Tab Left', '<Shift><Ctrl>Page_Up', 'Move the current tab');
            const without = item('Quit', '<Control>Q');
            document.body.append(withSub, without);
            const sub = withSub.querySelector('.adw-shortcuts-item-subtitle') as HTMLElement;
            expect(sub.hidden).toBe(false);
            expect(sub.textContent).toBe('Move the current tab');
            expect((without.querySelector('.adw-shortcuts-item-subtitle') as HTMLElement).hidden).toBe(true);
            withSub.remove();
            without.remove();
        });

        await it('hides a row that belongs to the other text direction', async () => {
            // adw-shortcuts-item.c:25-28 — one dialog carries both an LTR and an RTL
            // accelerator for the same action, and each row shows in its own direction.
            const rtl = item('Move Tab Left', '<Shift><Ctrl>Page_Up');
            rtl.setAttribute('direction', 'rtl');
            const both = item('Quit', '<Control>Q');
            document.body.append(rtl, both);
            // The harness document is LTR, so the RTL row is the one that hides.
            expect(rtl.hidden).toBe(true);
            expect(both.hidden).toBe(false);
            rtl.remove();
            both.remove();
        });
    });
};
