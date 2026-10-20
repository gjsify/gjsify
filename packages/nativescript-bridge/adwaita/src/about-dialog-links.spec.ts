// `Adw.AboutDialog`'s application icon and link rows on the REAL NS card. The card has no
// Details subpage, so the website must be on it whenever ABOUT_DIALOG_DETAILS_VECTORS says
// either page shows it; the link buttons carry the titles of ADW_ABOUT_DIALOG_LABELS and
// emit `activate-link` with GTK's handled accumulator before the default launch.
//
// This lives on the TREES entry (`src/test.trees.mts`): it builds the port's real widget
// classes, which evaluate `@nativescript/core` at module scope.

import { describe, expect, it } from '@gjsify/unit';
import { ADW_ABOUT_DIALOG_LABELS, stripMnemonic } from '@gjsify/adwaita-core';
import { ABOUT_DIALOG_DETAILS_VECTORS } from '@gjsify/adwaita-core/conformance';

import * as Adw from './namespace/adw.js';

interface Tappable {
    text: string;
    visibility: string;
    notify(data: { eventName: string }): void;
}

interface CardParts {
    _appIcon: { iconName: string; pixelSize: number; visibility: string };
    _websiteButton: Tappable;
    _supportButton: Tappable;
    _issueButton: Tappable;
    _linksBox: { getChildAt(index: number): Tappable };
}

const card = (dialog: InstanceType<typeof Adw.AboutDialog>) => dialog as unknown as CardParts;
const tap = (button: Tappable): void => button.notify({ eventName: 'tap' });

export const AdwAboutDialogLinksNsTest = async () => {
    await describe('NativeScript Adw.AboutDialog application icon', async () => {
        await it('draws application-icon as a 128px image, never as text', () => {
            const dialog = new Adw.AboutDialog();
            dialog.applicationIcon = 'eu.example.App';
            expect(card(dialog)._appIcon.iconName).toBe('eu.example.App');
            expect(card(dialog)._appIcon.pixelSize).toBe(128);
            expect(card(dialog)._appIcon.visibility).toBe('visible');
        });

        await it('collapses the image while application-icon is empty', () => {
            expect(card(new Adw.AboutDialog())._appIcon.visibility).toBe('collapse');
        });
    });

    await describe('NativeScript Adw.AboutDialog website row (update_details vectors)', async () => {
        for (const { website, comments, customLinks, rule } of ABOUT_DIALOG_DETAILS_VECTORS) {
            await it(`website=${website} comments=${comments} links=${customLinks} — ${rule}`, () => {
                const dialog = new Adw.AboutDialog();
                if (website) dialog.website = 'https://example.org';
                if (comments) dialog.comments = 'A description.';
                if (customLinks) dialog.add_link('Docs', 'https://example.org/docs');
                expect(card(dialog)._websiteButton.visibility).toBe(website ? 'visible' : 'collapse');
            });
        }
    });

    await describe('NativeScript Adw.AboutDialog link buttons', async () => {
        await it('titles the rows as libadwaita, mnemonics stripped', () => {
            const dialog = new Adw.AboutDialog();
            expect(card(dialog)._websiteButton.text).toBe(stripMnemonic(ADW_ABOUT_DIALOG_LABELS.websiteRow));
            expect(card(dialog)._supportButton.text).toBe(stripMnemonic(ADW_ABOUT_DIALOG_LABELS.supportRow));
            expect(card(dialog)._issueButton.text).toBe(stripMnemonic(ADW_ABOUT_DIALOG_LABELS.issueRow));
        });

        await it('emits activate-link with the URI of the tapped row', () => {
            const dialog = new Adw.AboutDialog();
            dialog.website = 'https://example.org';
            dialog.supportUrl = 'https://example.org/help';
            dialog.issueUrl = 'https://example.org/issues';
            dialog.add_link('_Docs', 'https://example.org/docs');
            const seen: string[] = [];
            dialog.connect('activate-link', (_self, data) => {
                seen.push((data as unknown as { uri: string }).uri);
                return true;
            });
            tap(card(dialog)._websiteButton);
            tap(card(dialog)._supportButton);
            tap(card(dialog)._issueButton);
            tap(card(dialog)._linksBox.getChildAt(0));
            expect(seen).toStrictEqual([
                'https://example.org',
                'https://example.org/help',
                'https://example.org/issues',
                'https://example.org/docs',
            ]);
            expect(card(dialog)._linksBox.getChildAt(0).text).toBe('Docs');
        });

        await it('re-renders without stacking tap handlers', () => {
            const dialog = new Adw.AboutDialog();
            dialog.website = 'https://example.org';
            dialog.version = '1.0';
            dialog.comments = 'Hi';
            let count = 0;
            dialog.connect('activate-link', () => {
                count += 1;
                return true;
            });
            tap(card(dialog)._websiteButton);
            expect(count).toBe(1);
        });
    });
};
