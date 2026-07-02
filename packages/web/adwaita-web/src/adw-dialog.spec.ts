// DOM-level behaviour tests for <adw-dialog>. Runs in a real browser via the
// @gjsify/adwaita-web browser test axis (tests/browser Playwright harness). The
// custom elements are registered by importing the package root in test.browser.mts;
// these specs create elements via document.createElement and assert their DOM
// behaviour (present/close events, can-close gating, header/content, focus return).
import { describe, it, expect } from '@gjsify/unit';

import type { AdwDialog } from './elements/adw-dialog.js';

function makeDialog(html = '<p>Body</p>'): AdwDialog {
    const el = document.createElement('adw-dialog') as AdwDialog;
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
}

export const AdwDialogTest = async () => {
    await describe('adw-dialog present/close', async () => {
        await it('present() reveals + fires notify::open(true)', async () => {
            const dialog = makeDialog();
            let notified: boolean | null = null;
            dialog.addEventListener('notify::open', (e) => {
                notified = (e as CustomEvent).detail.open;
            });
            expect(dialog.open).toBe(false);
            dialog.present();
            expect(dialog.open).toBe(true);
            expect(dialog.classList.contains('open')).toBe(true);
            expect(notified).toBe(true);
            dialog.remove();
        });

        await it('close() hides + fires notify::open(false) then closed', async () => {
            const dialog = makeDialog();
            dialog.present();
            const order: string[] = [];
            dialog.addEventListener('notify::open', (e) => {
                order.push(`notify:${(e as CustomEvent).detail.open}`);
            });
            dialog.addEventListener('closed', () => order.push('closed'));
            dialog.close();
            expect(dialog.open).toBe(false);
            expect(order).toStrictEqual(['notify:false', 'closed']);
            dialog.remove();
        });

        await it('present() on a disconnected element attaches it to the body', async () => {
            const dialog = document.createElement('adw-dialog') as AdwDialog;
            expect(dialog.isConnected).toBe(false);
            dialog.present();
            expect(dialog.isConnected).toBe(true);
            expect(dialog.open).toBe(true);
            dialog.remove();
        });
    });

    await describe('adw-dialog can-close gating', async () => {
        await it('close() while locked raises close-attempt and stays open', async () => {
            const dialog = makeDialog();
            dialog.canClose = false;
            dialog.present();
            let attempts = 0;
            let closed = 0;
            dialog.addEventListener('close-attempt', () => attempts++);
            dialog.addEventListener('closed', () => closed++);
            dialog.close();
            expect(dialog.open).toBe(true);
            expect(attempts).toBe(1);
            expect(closed).toBe(0);
            dialog.remove();
        });

        await it('forceClose() closes even while locked', async () => {
            const dialog = makeDialog();
            dialog.canClose = false;
            dialog.present();
            let closed = 0;
            dialog.addEventListener('closed', () => closed++);
            dialog.forceClose();
            expect(dialog.open).toBe(false);
            expect(closed).toBe(1);
            dialog.remove();
        });

        await it('Escape on the box dismisses when unlocked, is gated when locked', async () => {
            const dialog = makeDialog();
            dialog.present();
            const box = dialog.querySelector('.adw-dialog-box') as HTMLElement;
            box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(dialog.open).toBe(false);

            const locked = makeDialog();
            locked.canClose = false;
            locked.present();
            const lockedBox = locked.querySelector('.adw-dialog-box') as HTMLElement;
            let attempts = 0;
            locked.addEventListener('close-attempt', () => attempts++);
            lockedBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(locked.open).toBe(true);
            expect(attempts).toBe(1);
            dialog.remove();
            locked.remove();
        });
    });

    await describe('adw-dialog content + header', async () => {
        await it('moves author markup into the content area', async () => {
            const dialog = makeDialog('<p id="hello">Hello</p>');
            const content = dialog.querySelector('.adw-dialog-content');
            expect(content?.querySelector('#hello')?.textContent).toBe('Hello');
        });

        await it('renders the header only when a title is set', async () => {
            const dialog = makeDialog();
            const header = dialog.querySelector('.adw-dialog-header') as HTMLElement;
            expect(header.hidden).toBe(true);
            dialog.title = 'Settings';
            expect(header.hidden).toBe(false);
            expect(dialog.querySelector('.adw-dialog-title')?.textContent).toBe('Settings');
            dialog.remove();
        });

        await it('reflects presentation-mode + content-width', async () => {
            const dialog = makeDialog();
            expect(dialog.dataset.presentation).toBe('auto');
            dialog.presentationMode = 'bottom-sheet';
            expect(dialog.dataset.presentation).toBe('bottom-sheet');
            dialog.contentWidth = 500;
            const box = dialog.querySelector('.adw-dialog-box') as HTMLElement;
            expect(box.style.getPropertyValue('--adw-dialog-content-width')).toBe('500px');
            dialog.remove();
        });

        await it('the close button reflects the locked state', async () => {
            const dialog = makeDialog();
            dialog.title = 'X';
            const closeBtn = dialog.querySelector('.adw-dialog-close') as HTMLButtonElement;
            expect(closeBtn.disabled).toBe(false);
            dialog.canClose = false;
            expect(closeBtn.disabled).toBe(true);
            expect(closeBtn.classList.contains('locked')).toBe(true);
            dialog.remove();
        });
    });

    await describe('adw-dialog focus handling', async () => {
        await it('returns focus to the opener on close', async () => {
            const opener = document.createElement('button');
            opener.textContent = 'Open';
            document.body.appendChild(opener);
            opener.focus();
            expect(document.activeElement).toBe(opener);

            const dialog = makeDialog('<button id="inner">Inner</button>');
            dialog.present();
            // Move focus into the dialog explicitly (present() also does this, but
            // focusing a just-shown element in the same tick is layout-timing
            // sensitive under headless Chrome — so drive it deterministically here).
            (dialog.querySelector('#inner') as HTMLButtonElement).focus();
            // Close must return focus to the opener (never leave it trapped inside
            // the dialog — the regression this guards).
            dialog.close();
            expect(dialog.contains(document.activeElement)).toBe(false);
            expect(document.activeElement).toBe(opener);
            dialog.remove();
            opener.remove();
        });
    });
};
