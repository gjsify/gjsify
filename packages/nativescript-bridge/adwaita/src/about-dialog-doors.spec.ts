// `Adw.AboutDialog`'s release-notes, debug-info and add_link doors on the REAL NS card, held
// to the ABOUT_DIALOG_DOOR_VECTORS real `gi://Adw` passes. The card has no subpages, so only
// the rows that read no page run here (`isPaged: false`); what the card shows instead is
// asserted below against the core's buffer.
//
// This lives on the TREES entry (`src/test.trees.mts`): it builds the port's real widget
// classes, which evaluate `@nativescript/core` at module scope.

import { describe, expect, it } from '@gjsify/unit';
import { ADW_ABOUT_DIALOG_LABELS, stripMnemonic } from '@gjsify/adwaita-core';
import {
    ABOUT_DIALOG_DOOR_VECTORS,
    driveAboutDialogDoorVectors,
    type AboutDialogDoorLike,
} from '@gjsify/adwaita-core/conformance';

import * as Adw from './namespace/adw.js';

interface CardLabels {
    _releaseNotesLabel: { text: string; visibility: string };
    _linksLabel: { text: string; visibility: string };
    _debugInfoLabel: { text: string; visibility: string };
}

const card = (dialog: InstanceType<typeof Adw.AboutDialog>) => dialog as unknown as CardLabels;

export const AdwAboutDialogDoorsNsTest = async () => {
    await driveAboutDialogDoorVectors(
        {
            name: 'NativeScript Adw.AboutDialog',
            isOracle: false,
            labels: { ...ADW_ABOUT_DIALOG_LABELS, websiteRow: stripMnemonic(ADW_ABOUT_DIALOG_LABELS.websiteRow) },
            isGLibUntranslated: true,
            makeDialog: () => new Adw.AboutDialog() as unknown as AboutDialogDoorLike,
            whatsNew: () => [],
            isRowVisible: () => false,
            debugInfoText: () => '',
            linkTitles: () => [],
            dispose() {},
        },
        { describe, it, expect },
        ABOUT_DIALOG_DOOR_VECTORS.filter((vector) => !vector.isPaged),
    );

    await describe('NativeScript Adw.AboutDialog: the doors on a flat card', async () => {
        await it('shows the release-notes buffer text, heading included', () => {
            const dialog = new Adw.AboutDialog();
            dialog.version = '1.0';
            dialog.releaseNotes = '<ul><li>A</li></ul>';
            expect(card(dialog)._releaseNotesLabel.text).toBe(
                `${ADW_ABOUT_DIALOG_LABELS.releaseNotesHeading.replace('%s', '1.0')}\n• A`,
            );
            expect(card(dialog)._releaseNotesLabel.visibility).toBe('visible');
        });

        await it('does not rebuild the heading when only version changes', () => {
            const dialog = new Adw.AboutDialog();
            dialog.releaseNotes = '<p>Hi</p>';
            dialog.version = '1.0';
            expect(card(dialog)._releaseNotesLabel.text).toBe('Hi');
        });

        await it('collapses the notes, links and debug labels while they are empty', () => {
            const labels = card(new Adw.AboutDialog());
            expect([
                labels._releaseNotesLabel.visibility,
                labels._linksLabel.visibility,
                labels._debugInfoLabel.visibility,
            ]).toStrictEqual(['collapse', 'collapse', 'collapse']);
        });

        await it('lists add_link entries in order, mnemonics stripped', () => {
            const dialog = new Adw.AboutDialog();
            dialog.add_link('_Docs', 'https://example.org/docs');
            dialog.add_link('Chat', 'https://example.org/chat');
            expect(card(dialog)._linksLabel.text).toBe(
                'Docs: https://example.org/docs\nChat: https://example.org/chat',
            );
        });

        await it('shows debug-info verbatim', () => {
            const dialog = new Adw.AboutDialog();
            dialog.debugInfo = 'GTK 4.20\n  Wayland';
            expect(card(dialog)._debugInfoLabel.text).toBe('GTK 4.20\n  Wayland');
            expect(card(dialog)._debugInfoLabel.visibility).toBe('visible');
        });

        await it('refuses new_from_appdata by name', () => {
            expect(() => Adw.AboutDialog.new_from_appdata('/org/example/App/metainfo.xml')).toThrow(
                'Adw.AboutDialog.new_from_appdata',
            );
        });
    });
};
