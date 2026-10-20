// `Adw.AboutDialog`'s credits, acknowledgements and legal pages on the REAL NS card, held to the
// vectors the browser element is driven with: CREDITS_SECTIONS_VECTORS, TRANSLATOR_CREDITS_VECTORS,
// ACKNOWLEDGEMENT_SECTIONS_VECTORS, LEGAL_SECTIONS_VECTORS, LICENSE_SETTER_VECTORS,
// ABOUT_DIALOG_CREDITS_LEGAL_VECTORS and ABOUT_DIALOG_SUPPORT_VECTORS. The card has no subpages,
// so each page is one label whose text is the core's groups flattened: the heading, then a line
// per person (or the legal section's plain text).
//
// This lives on the TREES entry (`src/test.trees.mts`): it builds the port's real widget
// classes, which evaluate `@nativescript/core` at module scope.

import { describe, expect, it } from '@gjsify/unit';
import {
    ABOUT_DIALOG_CREDITS_LEGAL_VECTORS,
    ABOUT_DIALOG_SUPPORT_VECTORS,
    ACKNOWLEDGEMENT_SECTIONS_VECTORS,
    CREDITS_SECTIONS_VECTORS,
    LEGAL_SECTIONS_VECTORS,
    LICENSE_SETTER_VECTORS,
    TRANSLATOR_CREDITS_VECTORS,
} from '@gjsify/adwaita-core/conformance';

import * as Adw from './namespace/adw.js';

interface Shown {
    text: string;
    visibility: string;
}

interface CardLabels {
    _supportButton: Shown;
    _issueButton: Shown;
    _creditsLabel: Shown;
    _acknowledgementsLabel: Shown;
    _legalLabel: Shown;
}

const card = (dialog: InstanceType<typeof Adw.AboutDialog>) => dialog as unknown as CardLabels;

/** What the card prints for a list of groups: a heading line, then the names, groups a blank line apart. */
const groupsText = (groups: ReadonlyArray<{ title: string | null; people: ReadonlyArray<{ name: string }> }>): string =>
    groups
        .map((group) => [...(group.title === null ? [] : [group.title]), ...group.people.map((p) => p.name)].join('\n'))
        .join('\n\n');

export const AdwAboutDialogCreditsNsTest = async () => {
    await describe('NativeScript Adw.AboutDialog credits (update_credits vectors)', async () => {
        for (const { input, sections, rule } of CREDITS_SECTIONS_VECTORS) {
            await it(rule, () => {
                const dialog = new Adw.AboutDialog();
                dialog.developers = [...(input.developers ?? [])];
                dialog.designers = [...(input.designers ?? [])];
                dialog.artists = [...(input.artists ?? [])];
                dialog.documenters = [...(input.documenters ?? [])];
                if (input.translatorCredits) dialog.translatorCredits = input.translatorCredits;
                for (const section of input.creditSections ?? []) {
                    dialog.add_credit_section(section.title, [...section.people]);
                }
                expect(card(dialog)._creditsLabel.text).toBe(groupsText(sections));
                expect(card(dialog)._creditsLabel.visibility).toBe(sections.length > 0 ? 'visible' : 'collapse');
            });
        }

        for (const { value, people, rule } of TRANSLATOR_CREDITS_VECTORS) {
            await it(`translator-credits ${JSON.stringify(value)} — ${rule}`, () => {
                const dialog = new Adw.AboutDialog();
                if (value !== null) dialog.translatorCredits = value;
                expect(card(dialog)._creditsLabel.text).toBe(
                    people.length === 0 ? '' : ['Translated by', ...people].join('\n'),
                );
            });
        }
    });

    await describe('NativeScript Adw.AboutDialog acknowledgements (add_acknowledgement_section vectors)', async () => {
        for (const { sections, groups, rule } of ACKNOWLEDGEMENT_SECTIONS_VECTORS) {
            await it(rule, () => {
                const dialog = new Adw.AboutDialog();
                for (const section of sections) dialog.add_acknowledgement_section(section.title, [...section.people]);
                expect(card(dialog)._acknowledgementsLabel.text).toBe(groupsText(groups));
                expect(card(dialog)._acknowledgementsLabel.visibility).toBe(groups.length > 0 ? 'visible' : 'collapse');
            });
        }
    });

    await describe('NativeScript Adw.AboutDialog legal page (update_legal vectors)', async () => {
        for (const vector of LEGAL_SECTIONS_VECTORS) {
            await it(vector.rule, () => {
                const dialog = new Adw.AboutDialog();
                dialog.copyright = vector.copyright;
                dialog.licenseType = vector.licenseType;
                if (vector.licenseType === 1) dialog.license = vector.license;
                for (const section of vector.legalSections ?? []) {
                    dialog.add_legal_section(section.title, section.copyright, section.licenseType, section.license);
                }
                const expected = vector.sections
                    .map((section) => [section.title ?? '', section.text].filter((part) => part.length > 0).join('\n'))
                    .join('\n\n');
                expect(card(dialog)._legalLabel.text).toBe(expected);
                expect(card(dialog)._legalLabel.visibility).toBe(vector.hasLegal ? 'visible' : 'collapse');
            });
        }
    });

    await describe('NativeScript Adw.AboutDialog license / license-type (setter vectors)', async () => {
        for (const { steps, license, licenseType, rule } of LICENSE_SETTER_VECTORS) {
            await it(rule, () => {
                const dialog = new Adw.AboutDialog();
                for (const step of steps) {
                    if (step.property === 'license') dialog.license = String(step.value);
                    else dialog.licenseType = Number(step.value);
                }
                expect(dialog.license).toBe(license);
                expect(dialog.licenseType).toBe(licenseType);
            });
        }

        await it('takes an XML attribute string as an integer or a Gtk.License nick', () => {
            const dialog = new Adw.AboutDialog();
            dialog.licenseType = '7';
            expect(dialog.licenseType).toBe(7);
            dialog.licenseType = 'gpl-3-0';
            expect(dialog.licenseType).toBe(3);
            dialog.licenseType = 'not-a-license';
            expect(dialog.licenseType).toBe(3);
        });
    });

    await describe('NativeScript Adw.AboutDialog main page (credits/legal and support vectors)', async () => {
        for (const { hasCredits, hasLegal, hasAcknowledgements, visible, rule } of ABOUT_DIALOG_CREDITS_LEGAL_VECTORS) {
            await it(`credits=${hasCredits} legal=${hasLegal} ack=${hasAcknowledgements} — ${rule}`, () => {
                const dialog = new Adw.AboutDialog();
                if (hasLegal) dialog.copyright = '© 2026 Ada';
                if (hasCredits) dialog.developers = ['Ada'];
                if (hasAcknowledgements) dialog.add_acknowledgement_section('Funded by', ['Bob']);
                const shown = (label: Shown) => label.visibility === 'visible';
                expect({
                    creditsRow: shown(card(dialog)._creditsLabel),
                    legalRow: shown(card(dialog)._legalLabel),
                    acknowledgementsRow: shown(card(dialog)._acknowledgementsLabel),
                }).toStrictEqual({
                    creditsRow: visible.creditsRow,
                    legalRow: visible.legalRow,
                    acknowledgementsRow: visible.acknowledgementsRow,
                });
            });
        }

        for (const { supportUrl, issueUrl, visible, rule } of ABOUT_DIALOG_SUPPORT_VECTORS) {
            await it(`support=${supportUrl} issue=${issueUrl} — ${rule}`, () => {
                const dialog = new Adw.AboutDialog();
                if (supportUrl) dialog.supportUrl = 'https://example.org/help';
                if (issueUrl) dialog.issueUrl = 'https://example.org/issues';
                expect({
                    supportRow: card(dialog)._supportButton.visibility === 'visible',
                    issueRow: card(dialog)._issueButton.visibility === 'visible',
                }).toStrictEqual({ supportRow: visible.supportRow, issueRow: visible.issueRow });
            });
        }

        await it('refuses an add_legal_section whose license_type is outside Gtk.License', () => {
            const dialog = new Adw.AboutDialog();
            dialog.add_legal_section('Fonts', '© Foundry', 99, null);
            expect(card(dialog)._legalLabel.visibility).toBe('collapse');
        });
    });
};
