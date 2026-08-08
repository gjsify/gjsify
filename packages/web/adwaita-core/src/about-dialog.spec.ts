// About-dialog derivation specs — driven by the shared conformance vectors, so
// this suite and the renderer suites assert the SAME table.
//
// Every derivation here returns a struct, so every comparison is
// `toStrictEqual`: `@gjsify/unit`'s `toEqual` compares with `==`, which is
// reference equality for objects and arrays and would pass on two structs that
// share nothing but their identity.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_ABOUT_DIALOG_LABELS,
    ADW_CREDITS_SECTION_TITLES,
    ADW_LICENSES,
    ADW_LICENSE_ALIASES,
    ADW_LICENSE_DEFAULTS,
    ADW_TRANSLATOR_CREDITS_SENTINELS,
    type AdwLicenseState,
    type AdwLicenseType,
    aboutDialogVisibility,
    creditsSections,
    GTK_LICENSE,
    isLicenseType,
    legalSectionVisible,
    licenseText,
    licenseTypeForSpdxId,
    parseCreditPerson,
    setLicense,
    setLicenseType,
    translatorCreditsPeople,
} from './about-dialog.js';
import { gStrStrip, stripMnemonic } from './glib.js';
import {
    ABOUT_DIALOG_CREDITS_LEGAL_VECTORS,
    ABOUT_DIALOG_DETAILS_VECTORS,
    ABOUT_DIALOG_HEADER_VECTORS,
    ABOUT_DIALOG_LABEL_VECTORS,
    ABOUT_DIALOG_SUPPORT_VECTORS,
    CREDITS_SECTIONS_VECTORS,
    CREDIT_PERSON_VECTORS,
    LEGAL_SECTION_VECTORS,
    LICENSE_INFO_VECTORS,
    LICENSE_SETTER_VECTORS,
    LICENSE_SPDX_VECTORS,
    LICENSE_TEXT_VECTORS,
    TRANSLATOR_CREDITS_VECTORS,
} from './conformance/about-dialog.js';

export default async () => {
    await describe('parseCreditPerson (Adw.AboutDialog parse_person)', async () => {
        for (const { input, name, link, isEmail, uri, rule } of CREDIT_PERSON_VECTORS) {
            await it(`${JSON.stringify(input)} — ${rule}`, () => {
                expect(parseCreditPerson(input)).toStrictEqual({ name, link, isEmail, uri });
            });
        }

        await it('distinguishes an EMPTY link from NO link', () => {
            // `if (link)` in the C is a pointer test, so "" is still a link row.
            // A port using `link ? … : null` collapses the two and turns
            // `"Ada <>"` into a plain action row.
            expect(parseCreditPerson('Ada <>').link).toBe('');
            expect(parseCreditPerson('Ada').link).toBe(null);
        });

        await it('strips the name with g_strstrip, not String.trim', () => {
            const padded = '\u00A0Ada\u00A0'; // NBSP, which trim() eats and g_strstrip does not
            expect(parseCreditPerson(padded).name).toBe(gStrStrip(padded));
            expect(parseCreditPerson(padded).name).not.toBe(padded.trim());
        });
    });

    await describe('translatorCreditsPeople (update_credits sentinel + g_strsplit)', async () => {
        for (const { value, people, rule } of TRANSLATOR_CREDITS_VECTORS) {
            await it(`${JSON.stringify(value)} — ${rule}`, () => {
                expect(translatorCreditsPeople(value)).toStrictEqual([...people]);
            });
        }

        await it('does not behave like String.prototype.split on the empty string', () => {
            // g_strsplit("") is a zero-length vector; ''.split('\n') is ['']. The
            // difference is a whole "Translated by" group with one blank row.
            expect(translatorCreditsPeople('')).toStrictEqual([]);
            expect(''.split('\n')).toStrictEqual(['']);
        });

        await it('checks both spellings of the untranslated sentinel', () => {
            expect([...ADW_TRANSLATOR_CREDITS_SENTINELS]).toStrictEqual(['translator_credits', 'translator-credits']);
        });
    });

    await describe('creditsSections (Adw.AboutDialog update_credits)', async () => {
        for (const { input, sections, rule } of CREDITS_SECTIONS_VECTORS) {
            await it(rule, () => {
                const actual = creditsSections(input).map((section) => ({
                    title: section.title,
                    people: section.people.map((person) => ({ name: person.name, uri: person.uri })),
                }));
                expect(actual).toStrictEqual(
                    sections.map((section) => ({ title: section.title, people: [...section.people] })),
                );
            });
        }

        await it('titles the built-in sections the way the C does', () => {
            expect({ ...ADW_CREDITS_SECTION_TITLES }).toStrictEqual({
                developers: 'Code by',
                designers: 'Design by',
                artists: 'Artwork by',
                documenters: 'Documentation by',
                translators: 'Translated by',
            });
        });

        await it('keeps blank translator lines as rows', () => {
            // g_strsplit keeps interior empty tokens and add_credits_section only
            // skips NULL pointers (:557-558), so the blank line IS a row.
            const [section] = creditsSections({ translatorCredits: 'Ada\n\nBob' });
            expect(section!.people.map((person) => person.name)).toStrictEqual(['Ada', '', 'Bob']);
        });
    });

    await describe('aboutDialogVisibility (update_details / update_support / update_credits_legal_group)', async () => {
        for (const { website, comments, customLinks, releaseNotes, visible, rule } of ABOUT_DIALOG_DETAILS_VECTORS) {
            await it(`details: website=${website} comments=${comments} links=${customLinks} notes=${releaseNotes} — ${rule}`, () => {
                const state = aboutDialogVisibility({
                    website: website ? 'https://example.org' : '',
                    comments: comments ? 'A description.' : '',
                    hasCustomLinks: customLinks,
                    releaseNotes: releaseNotes ? '<p>New things.</p>' : '',
                });
                expect({
                    detailsGroup: state.detailsGroup,
                    whatsNewRow: state.whatsNewRow,
                    detailsRow: state.detailsRow,
                    websiteRow: state.websiteRow,
                    commentsLabel: state.commentsLabel,
                    linksGroup: state.linksGroup,
                    detailsWebsiteRow: state.detailsWebsiteRow,
                }).toStrictEqual({ ...visible });
            });
        }

        for (const { supportUrl, issueUrl, debugInfo, visible, rule } of ABOUT_DIALOG_SUPPORT_VECTORS) {
            await it(`support: support=${supportUrl} issue=${issueUrl} debug=${debugInfo} — ${rule}`, () => {
                const state = aboutDialogVisibility({
                    supportUrl: supportUrl ? 'https://example.org/help' : '',
                    issueUrl: issueUrl ? 'https://example.org/issues' : '',
                    debugInfo: debugInfo ? 'GTK 4.20' : '',
                });
                expect({
                    supportGroup: state.supportGroup,
                    supportRow: state.supportRow,
                    issueRow: state.issueRow,
                    troubleshootingRow: state.troubleshootingRow,
                }).toStrictEqual({ ...visible });
            });
        }

        for (const { hasCredits, hasLegal, hasAcknowledgements, visible, rule } of ABOUT_DIALOG_CREDITS_LEGAL_VECTORS) {
            await it(`credits/legal: credits=${hasCredits} legal=${hasLegal} ack=${hasAcknowledgements} — ${rule}`, () => {
                const state = aboutDialogVisibility({ hasCredits, hasLegal, hasAcknowledgements });
                expect({
                    creditsLegalGroup: state.creditsLegalGroup,
                    creditsRow: state.creditsRow,
                    legalRow: state.legalRow,
                    acknowledgementsRow: state.acknowledgementsRow,
                }).toStrictEqual({ ...visible });
            });
        }

        for (const { property, value, visible, rule } of ABOUT_DIALOG_HEADER_VECTORS) {
            await it(`header: ${property}=${JSON.stringify(value)} — ${rule}`, () => {
                const key = {
                    'application-icon': 'applicationIcon',
                    'application-name': 'applicationName',
                    'developer-name': 'developerName',
                    version: 'version',
                }[property] as 'applicationIcon' | 'applicationName' | 'developerName' | 'version';
                const state = aboutDialogVisibility({ [key]: value });
                const shown = {
                    applicationIcon: state.appIcon,
                    applicationName: state.appName,
                    developerName: state.developerName,
                    version: state.version,
                }[key];
                expect(shown).toBe(visible);
            });
        }

        await it('never shows both website rows at once', () => {
            // The two are separate template widgets (.ui:133 and :347) and the
            // pair of tests at :1112-1113 is mutually exclusive by construction.
            for (const website of ['', 'https://example.org']) {
                for (const comments of ['', 'A description.']) {
                    for (const hasCustomLinks of [false, true]) {
                        const state = aboutDialogVisibility({ website, comments, hasCustomLinks });
                        expect(state.websiteRow && state.detailsWebsiteRow).toBe(false);
                    }
                }
            }
        });
    });

    await describe('ADW_ABOUT_DIALOG_LABELS (adw-about-dialog.ui)', async () => {
        for (const { label, text, plain, rule } of ABOUT_DIALOG_LABEL_VECTORS) {
            await it(`${label} — ${rule}`, () => {
                expect(ADW_ABOUT_DIALOG_LABELS[label]).toBe(text);
                expect(stripMnemonic(text)).toBe(plain);
            });
        }

        await it('does not build the dialog title out of the application name', () => {
            // The template default is the bare word; the app name lives in the
            // header revealer instead (.ui:6 vs :29-31).
            expect(ADW_ABOUT_DIALOG_LABELS.dialogTitle).toBe('About');
        });
    });

    await describe('the licence table (gtk_license_info)', async () => {
        await it('has 19 rows, the last being 0BSD (G_STATIC_ASSERT :253-256)', () => {
            expect(ADW_LICENSES).toHaveLength(19);
            expect(ADW_LICENSES.length - 1).toBe(GTK_LICENSE['0BSD']);
            expect(ADW_LICENSES[GTK_LICENSE['0BSD']]!.spdxId).toBe('0BSD');
        });

        for (const { licenseType, spdxId, url, rule } of LICENSE_INFO_VECTORS) {
            await it(`index ${licenseType} — ${rule}`, () => {
                const info = ADW_LICENSES[licenseType]!;
                expect({ spdxId: info.spdxId, url: info.url }).toStrictEqual({ spdxId, url });
            });
        }

        await it('keeps unknown and custom empty so every later index lines up', () => {
            expect(ADW_LICENSES[GTK_LICENSE.UNKNOWN]).toStrictEqual({ name: null, url: null, spdxId: null });
            expect(ADW_LICENSES[GTK_LICENSE.CUSTOM]).toStrictEqual({ name: null, url: null, spdxId: null });
        });

        await it('carries exactly the two deprecated SPDX aliases (:264-267)', () => {
            expect(ADW_LICENSE_ALIASES.map((alias) => alias.spdxId)).toStrictEqual(['GPL-2.0', 'GPL-3.0']);
        });

        await it('bounds-checks like the setter does (:3401-3402)', () => {
            expect(isLicenseType(0)).toBe(true);
            expect(isLicenseType(18)).toBe(true);
            expect(isLicenseType(19)).toBe(false);
            expect(isLicenseType(-1)).toBe(false);
            expect(isLicenseType(2.5)).toBe(false);
        });
    });

    await describe('licenseTypeForSpdxId (populate_from_appdata :1226-1239)', async () => {
        for (const { spdxId, licenseType, rule } of LICENSE_SPDX_VECTORS) {
            await it(`${JSON.stringify(spdxId)} → ${licenseType} — ${rule}`, () => {
                expect(licenseTypeForSpdxId(spdxId)).toBe(licenseType);
            });
        }
    });

    await describe('licenseText (get_license_text :635-651)', async () => {
        for (const { licenseType, license, text, rule } of LICENSE_TEXT_VECTORS) {
            await it(`type ${licenseType} — ${rule}`, () => {
                expect(licenseText(licenseType as AdwLicenseType, license)).toBe(text);
            });
        }

        await it('gives every stock licence a preamble with its own URL and name', () => {
            const missing: number[] = [];
            for (let type = 2; type < ADW_LICENSES.length; type++) {
                const info = ADW_LICENSES[type]!;
                const text = licenseText(type as AdwLicenseType, '');
                if (!text?.includes(info.url!) || !text.includes(info.name!)) missing.push(type);
            }
            // One assertion naming every broken index, not 17 separate failures.
            expect(missing).toStrictEqual([]);
        });
    });

    await describe('setLicense / setLicenseType (:3396-3416, :3459-3480)', async () => {
        for (const { steps, license, licenseType, notify, rule } of LICENSE_SETTER_VECTORS) {
            await it(rule, () => {
                let state: AdwLicenseState = { ...ADW_LICENSE_DEFAULTS };
                const notified: string[] = [];
                for (const step of steps) {
                    const transition =
                        step.property === 'license'
                            ? setLicense(state, step.value as string)
                            : setLicenseType(state, step.value as number);
                    state = transition.state;
                    notified.push(...transition.notify);
                }
                expect({ license: state.license, licenseType: state.licenseType, notified }).toStrictEqual({
                    license,
                    licenseType,
                    notified: [...notify],
                });
            });
        }

        await it('reports `changed` for the early-outs', () => {
            const custom = setLicense({ ...ADW_LICENSE_DEFAULTS }, 'text');
            expect(custom.changed).toBe(true);
            expect(setLicense(custom.state, 'text').changed).toBe(false);
            expect(setLicenseType(custom.state, GTK_LICENSE.CUSTOM).changed).toBe(false);
            expect(setLicenseType(custom.state, 99).changed).toBe(false);
        });
    });

    await describe('legalSectionVisible (append_legal_section :666-671)', async () => {
        for (const { copyright, licenseType, license, visible, rule } of LEGAL_SECTION_VECTORS) {
            await it(rule, () => {
                expect(legalSectionVisible(copyright, licenseType as AdwLicenseType, license)).toBe(visible);
            });
        }
    });
};
