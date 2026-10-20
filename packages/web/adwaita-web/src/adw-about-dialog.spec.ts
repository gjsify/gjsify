// DOM-level conformance tests for <adw-about-dialog>, driven by the vectors in
// `@gjsify/adwaita-core/conformance` — the same table the core suite asserts.
//
// A local copy of `parse_person`, of the page-visibility rules or of the fallbacks
// diverges from libadwaita in thirteen ways, two of them structural: Support Questions
// and Report an Issue belong on the MAIN page, not one navigation step deeper on Details;
// and `website` is the one input the Details-visibility predicate leaves OUT.
import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_ABOUT_DIALOG_LABELS,
    type ReleaseNotesSegment,
    type Toast,
    licenseTypeForNick,
    stripMnemonic,
} from '@gjsify/adwaita-core';
import {
    ABOUT_DIALOG_CREDITS_LEGAL_VECTORS,
    ABOUT_DIALOG_DETAILS_VECTORS,
    ABOUT_DIALOG_DOOR_VECTORS,
    ABOUT_DIALOG_HEADER_VECTORS,
    ABOUT_DIALOG_SUPPORT_VECTORS,
    type AboutDialogDoorLike,
    ACKNOWLEDGEMENT_SECTIONS_VECTORS,
    CREDITS_SECTIONS_VECTORS,
    CREDIT_PERSON_VECTORS,
    LEGAL_SECTIONS_VECTORS,
    LICENSE_SETTER_VECTORS,
    RELEASE_NOTES_VECTORS,
    TRANSLATOR_CREDITS_VECTORS,
    driveAboutDialogDoorVectors,
    driveReleaseNotesVectors,
} from '@gjsify/adwaita-core/conformance';

/** The label a renderer without an accelerator layer paints for a row. */
const label = (key: keyof typeof ADW_ABOUT_DIALOG_LABELS) => stripMnemonic(ADW_ABOUT_DIALOG_LABELS[key]);

interface Mounted {
    dialog: HTMLElement &
        AboutDialogDoorLike & {
            developers: string[];
            designers: string[];
            artists: string[];
            documenters: string[];
            copyright: string;
            license: string;
            licenseType: number;
            licenseUrl: string;
            translatorCredits: string;
            add_credit_section(name: string | null, people: string[]): void;
            add_acknowledgement_section(name: string | null, people: string[]): void;
            add_legal_section(
                title: string,
                copyright: string | null,
                licenseType: number,
                license: string | null,
            ): void;
        };
    host: HTMLElement;
    /** Every `window.open` the dialog performed, most recent last. */
    opened: string[];
    /** Restore the stubbed `window.open`. */
    dispose: () => void;
}

/**
 * Mount a dialog and set every attribute imperatively: several vectors hinge on exact
 * whitespace, which markup is not a reliable carrier for. `window.open` is stubbed
 * because the link rows really do call it.
 */
function mount(attributes: Record<string, string> = {}): Mounted {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dialog = document.createElement('adw-about-dialog') as Mounted['dialog'];
    host.appendChild(dialog);
    for (const [name, value] of Object.entries(attributes)) dialog.setAttribute(name, value);

    const opened: string[] = [];
    const original = window.open;
    (window as unknown as { open: unknown }).open = (url?: string | URL) => {
        opened.push(String(url ?? ''));
        return null;
    };

    return {
        dialog,
        host,
        opened,
        dispose: () => {
            (window as unknown as { open: unknown }).open = original;
            host.remove();
        },
    };
}

/** The navigation page with `tag`, or `null` when the dialog did not build it. */
function page(dialog: HTMLElement, tag: string): HTMLElement | null {
    return dialog.querySelector(`adw-navigation-page[tag="${tag}"]`);
}

/** The preferences group the template calls `id`, on whichever page it lives. */
function group(dialog: HTMLElement, id: string): HTMLElement | null {
    return dialog.querySelector(`adw-preferences-group[data-group="${id}"]`);
}

/** Whether a row with `title` exists inside `scope`. */
function hasRow(scope: Element | null, title: string): boolean {
    if (!scope) return false;
    return scope.querySelector(`adw-action-row[title="${title}"]`) !== null;
}

/** The row titles inside `scope`, in document order. */
function rowTitles(scope: Element | null): string[] {
    if (!scope) return [];
    return [...scope.querySelectorAll('adw-action-row')].map((row) => row.getAttribute('title') ?? '');
}

/**
 * Activate a row and report the URI it asked for. The URI never reaches the DOM — it is
 * captured in the row's activation handler — so driving the row is the only way to see it.
 */
function activateRow(dialog: HTMLElement, row: Element): string | null {
    let uri: string | null = null;
    const listener = (event: Event) => {
        uri = (event as CustomEvent<{ uri: string }>).detail.uri;
    };
    dialog.addEventListener('activate-link', listener);
    row.dispatchEvent(new CustomEvent('activated', { bubbles: true }));
    dialog.removeEventListener('activate-link', listener);
    return uri;
}

export const AdwAboutDialogTest = async () => {
    await describe('adw-about-dialog credit parsing (parse_person vectors)', async () => {
        for (const { input, name, uri, rule } of CREDIT_PERSON_VECTORS) {
            await it(`${JSON.stringify(input)} — ${rule}`, () => {
                const mounted = mount({ 'application-name': 'Builder' });
                mounted.dialog.developers = [input];

                const credits = page(mounted.dialog, 'credits');
                const rows = credits ? [...credits.querySelectorAll('adw-action-row')] : [];
                expect(rows).toHaveLength(1);

                const row = rows[0]!;
                expect(row.getAttribute('title')).toBe(name);
                expect(activateRow(mounted.dialog, row)).toBe(uri);

                mounted.dispose();
            });
        }

        await it('makes a row with an empty link a LINK row, not a plain one', () => {
            // `if (link)` is a POINTER test in the C, so `"Ada <>"` still links, to the
            // URI `mailto:` — collapsing "" to null loses the row type.
            const mounted = mount();
            mounted.dialog.developers = ['Ada <>'];
            const row = page(mounted.dialog, 'credits')!.querySelector('adw-action-row')!;
            expect(row.hasAttribute('activatable')).toBe(true);
            expect(activateRow(mounted.dialog, row)).toBe('mailto:');
            mounted.dispose();
        });
    });

    await describe('adw-about-dialog credits page (update_credits vectors)', async () => {
        for (const { input, sections, rule } of CREDITS_SECTIONS_VECTORS) {
            await it(rule, () => {
                const mounted = mount();
                mounted.dialog.developers = [...(input.developers ?? [])];
                mounted.dialog.designers = [...(input.designers ?? [])];
                mounted.dialog.artists = [...(input.artists ?? [])];
                mounted.dialog.documenters = [...(input.documenters ?? [])];
                if (input.translatorCredits !== undefined && input.translatorCredits !== null) {
                    mounted.dialog.translatorCredits = input.translatorCredits;
                }
                for (const section of input.creditSections ?? []) {
                    mounted.dialog.add_credit_section(section.title, [...section.people]);
                }

                const credits = page(mounted.dialog, 'credits');
                const groups = credits ? [...credits.querySelectorAll('adw-preferences-group')] : [];
                expect(groups.map((node) => node.getAttribute('title'))).toStrictEqual(
                    sections.map((section) => section.title),
                );
                for (const [index, section] of sections.entries()) {
                    expect(rowTitles(groups[index]!)).toStrictEqual(section.people.map((person) => person.name));
                }

                mounted.dispose();
            });
        }
    });

    await describe('adw-about-dialog main page (update_details vectors)', async () => {
        for (const vector of ABOUT_DIALOG_DETAILS_VECTORS) {
            const { website, comments, customLinks, releaseNotes, visible, rule } = vector;
            await it(`website=${website} comments=${comments} links=${customLinks} notes=${releaseNotes} — ${rule}`, () => {
                const mounted = mount({
                    'application-name': 'Builder',
                    ...(website ? { website: 'https://example.org' } : {}),
                    ...(comments ? { comments: 'A description.' } : {}),
                    ...(releaseNotes ? { 'release-notes': '<p>Hi</p>' } : {}),
                });
                if (customLinks) mounted.dialog.add_link('_Docs', 'https://example.org/docs');

                const main = page(mounted.dialog, 'main');
                const details = page(mounted.dialog, 'details');

                expect({
                    detailsGroup: group(mounted.dialog, 'details') !== null,
                    whatsNewRow: hasRow(main, label('whatsNewRow')),
                    detailsRow: hasRow(main, label('detailsRow')),
                    websiteRow: hasRow(main, label('websiteRow')),
                    commentsLabel: details?.querySelector('.adw-about-dialog-comments') != null,
                    linksGroup: group(mounted.dialog, 'links') !== null,
                    detailsWebsiteRow: hasRow(details, label('websiteRow')),
                }).toStrictEqual({
                    detailsGroup: visible.detailsGroup,
                    whatsNewRow: visible.whatsNewRow,
                    detailsRow: visible.detailsRow,
                    websiteRow: visible.websiteRow,
                    commentsLabel: visible.commentsLabel,
                    linksGroup: visible.linksGroup,
                    detailsWebsiteRow: visible.detailsWebsiteRow,
                });

                mounted.dispose();
            });
        }

        await it('keeps a website-only dialog on the main page with no Details row', () => {
            // `show_details` is `has_comments || has_custom_links`; website is
            // deliberately not in it, so a dialog whose only extra is a website links
            // straight from the main page.
            const mounted = mount({ 'application-name': 'Builder', website: 'https://example.org' });
            expect(page(mounted.dialog, 'details')).toBe(null);
            expect(hasRow(page(mounted.dialog, 'main'), label('websiteRow'))).toBe(true);
            mounted.dispose();
        });
    });

    await describe('adw-about-dialog main page (update_support vectors)', async () => {
        for (const vector of ABOUT_DIALOG_SUPPORT_VECTORS) {
            const { supportUrl, issueUrl, debugInfo, visible, rule } = vector;
            await it(`support=${supportUrl} issue=${issueUrl} debug=${debugInfo} — ${rule}`, () => {
                const mounted = mount({
                    'application-name': 'Builder',
                    ...(supportUrl ? { 'support-url': 'https://example.org/help' } : {}),
                    ...(issueUrl ? { 'issue-url': 'https://example.org/issues' } : {}),
                    ...(debugInfo ? { 'debug-info': 'GTK 4.20' } : {}),
                });

                const main = page(mounted.dialog, 'main');
                expect({
                    supportGroup: group(mounted.dialog, 'support') !== null,
                    supportRow: hasRow(main, label('supportRow')),
                    issueRow: hasRow(main, label('issueRow')),
                    troubleshootingRow: hasRow(main, label('troubleshootingRow')),
                }).toStrictEqual({
                    supportGroup: visible.supportGroup,
                    supportRow: visible.supportRow,
                    issueRow: visible.issueRow,
                    troubleshootingRow: visible.troubleshootingRow,
                });

                mounted.dispose();
            });
        }

        await it('puts the support and issue rows on the MAIN page, not on Details', () => {
            // In `adw-about-dialog.ui`, `support_group` is a child of the MAIN page.
            const mounted = mount({
                'application-name': 'Builder',
                'support-url': 'https://example.org/help',
                'issue-url': 'https://example.org/issues',
            });
            expect(rowTitles(page(mounted.dialog, 'main'))).toContain(label('supportRow'));
            expect(rowTitles(page(mounted.dialog, 'main'))).toContain(label('issueRow'));
            // With neither comments nor custom links there is no Details page.
            expect(page(mounted.dialog, 'details')).toBe(null);
            mounted.dispose();
        });
    });

    await describe('adw-about-dialog main page (credits/legal vectors)', async () => {
        for (const vector of ABOUT_DIALOG_CREDITS_LEGAL_VECTORS) {
            const { hasCredits, hasLegal, hasAcknowledgements, visible, rule } = vector;
            await it(`credits=${hasCredits} legal=${hasLegal} ack=${hasAcknowledgements} — ${rule}`, () => {
                const mounted = mount({
                    'application-name': 'Builder',
                    ...(hasLegal ? { copyright: '© 2026 Ada' } : {}),
                });
                if (hasCredits) mounted.dialog.developers = ['Ada'];
                if (hasAcknowledgements) mounted.dialog.add_acknowledgement_section('Funded by', ['Bob']);

                const main = page(mounted.dialog, 'main');
                expect({
                    creditsLegalGroup: group(mounted.dialog, 'credits-legal') !== null,
                    creditsRow: hasRow(main, label('creditsRow')),
                    legalRow: hasRow(main, label('legalRow')),
                    acknowledgementsRow: hasRow(main, label('acknowledgementsRow')),
                }).toStrictEqual({
                    creditsLegalGroup: visible.creditsLegalGroup,
                    creditsRow: visible.creditsRow,
                    legalRow: visible.legalRow,
                    acknowledgementsRow: visible.acknowledgementsRow,
                });

                mounted.dispose();
            });
        }
    });

    await describe('adw-about-dialog translator-credits (split vectors)', async () => {
        for (const { value, people, rule } of TRANSLATOR_CREDITS_VECTORS) {
            await it(`${JSON.stringify(value)} — ${rule}`, () => {
                const mounted = mount();
                if (value !== null) mounted.dialog.translatorCredits = value;
                const groups = [...(page(mounted.dialog, 'credits')?.querySelectorAll('adw-preferences-group') ?? [])];
                if (people.length === 0) {
                    expect(groups).toHaveLength(0);
                } else {
                    expect(groups).toHaveLength(1);
                    expect(groups[0]!.getAttribute('title')).toBe('Translated by');
                    expect(rowTitles(groups[0]!)).toStrictEqual([...people]);
                }
                mounted.dispose();
            });
        }
    });

    await describe('adw-about-dialog acknowledgements page (add_acknowledgement_section vectors)', async () => {
        for (const { sections, groups, rule } of ACKNOWLEDGEMENT_SECTIONS_VECTORS) {
            await it(rule, () => {
                const mounted = mount();
                for (const section of sections) {
                    mounted.dialog.add_acknowledgement_section(section.title, [...section.people]);
                }
                const nodes = [
                    ...(page(mounted.dialog, 'acknowledgements')?.querySelectorAll('adw-preferences-group') ?? []),
                ];
                expect(nodes.map((node) => node.getAttribute('title'))).toStrictEqual(groups.map((g) => g.title));
                for (const [index, expected] of groups.entries()) {
                    const rows = [...nodes[index]!.querySelectorAll('adw-action-row')];
                    expect(rows.map((row) => row.getAttribute('title'))).toStrictEqual(
                        expected.people.map((person) => person.name),
                    );
                    for (const [at, person] of expected.people.entries()) {
                        expect(activateRow(mounted.dialog, rows[at]!)).toBe(person.uri);
                    }
                }
                mounted.dispose();
            });
        }
    });

    await describe('adw-about-dialog license and legal page (update_legal vectors)', async () => {
        for (const vector of LEGAL_SECTIONS_VECTORS) {
            await it(vector.rule, () => {
                const mounted = mount();
                mounted.dialog.copyright = vector.copyright;
                mounted.dialog.licenseType = vector.licenseType;
                if (vector.license.length > 0 && vector.licenseType === 1) mounted.dialog.license = vector.license;
                for (const section of vector.legalSections ?? []) {
                    mounted.dialog.add_legal_section(
                        section.title,
                        section.copyright,
                        section.licenseType,
                        section.license,
                    );
                }

                expect(hasRow(page(mounted.dialog, 'main'), label('legalRow'))).toBe(vector.hasLegal);
                const legal = page(mounted.dialog, 'legal');
                if (!vector.hasLegal) {
                    expect(legal).toBe(null);
                } else {
                    const body = legal!;
                    const titles = [...body.querySelectorAll('.adw-about-dialog-legal-title')].map(
                        (node) => node.textContent,
                    );
                    expect(titles).toStrictEqual(
                        vector.sections.filter((s) => s.title !== null).map((section) => section.title),
                    );
                    const texts = [...body.querySelectorAll('.adw-about-dialog-license')].map(
                        (node) => node.textContent,
                    );
                    expect(texts).toStrictEqual(
                        vector.sections.filter((s) => s.markup.length > 0).map((section) => section.text),
                    );
                }
                mounted.dispose();
            });
        }

        await it('turns the warranty line link into a cancelable activate-link', () => {
            const mounted = mount();
            mounted.dialog.licenseType = 7;
            const anchor = page(mounted.dialog, 'legal')!.querySelector('a')!;
            expect(anchor.textContent).toBe('The MIT License (MIT)');
            mounted.dialog.addEventListener('activate-link', (event) => event.preventDefault());
            anchor.click();
            expect(mounted.opened).toStrictEqual([]);
            mounted.dispose();
        });

        await it('opens a warranty line link when nothing handled it', () => {
            const mounted = mount();
            mounted.dialog.licenseType = 7;
            page(mounted.dialog, 'legal')!.querySelector('a')!.click();
            expect(mounted.opened).toStrictEqual(['https://opensource.org/licenses/mit-license.php']);
            mounted.dispose();
        });

        await it('links a custom license to license-url (not in libadwaita)', () => {
            const mounted = mount();
            mounted.dialog.license = 'Proprietary';
            mounted.dialog.licenseUrl = 'https://example.org/license';
            const anchor = page(mounted.dialog, 'legal')!.querySelector('a')!;
            expect(anchor.textContent).toBe('Proprietary');
            anchor.click();
            expect(mounted.opened).toStrictEqual(['https://example.org/license']);
            mounted.dispose();
        });
    });

    await describe('adw-about-dialog license / license-type (setter vectors)', async () => {
        for (const { steps, license, licenseType, notify, rule } of LICENSE_SETTER_VECTORS) {
            await it(rule, () => {
                const mounted = mount();
                const seen: string[] = [];
                for (const name of ['license', 'license-type']) {
                    mounted.dialog.addEventListener(`notify::${name}`, () => seen.push(name));
                }
                for (const step of steps) {
                    if (step.property === 'license') mounted.dialog.license = String(step.value);
                    else mounted.dialog.licenseType = Number(step.value);
                }
                expect(mounted.dialog.license).toBe(license);
                expect(mounted.dialog.licenseType).toBe(licenseType);
                expect(seen).toStrictEqual([...notify]);
                mounted.dispose();
            });
        }

        await it('takes a Gtk.License nick as the license-type attribute and keeps it', () => {
            const mounted = mount({ 'license-type': 'mit-x11' });
            expect(mounted.dialog.licenseType).toBe(licenseTypeForNick('mit-x11'));
            expect(mounted.dialog.getAttribute('license-type')).toBe('mit-x11');
            mounted.dispose();
        });

        await it('refuses an unknown nick and writes the real state back', () => {
            const mounted = mount({ 'license-type': 'not-a-license' });
            expect(mounted.dialog.licenseType).toBe(0);
            expect(mounted.dialog.hasAttribute('license-type')).toBe(false);
            mounted.dispose();
        });

        await it('honours license attributes set before the element connects', () => {
            const dialog = document.createElement('adw-about-dialog') as Mounted['dialog'];
            dialog.setAttribute('license', 'Early');
            document.body.appendChild(dialog);
            expect(dialog.license).toBe('Early');
            expect(dialog.licenseType).toBe(1);
            dialog.remove();
        });
    });

    await describe('adw-about-dialog header fields (no invented fallbacks)', async () => {
        for (const { property, value, visible, rule } of ABOUT_DIALOG_HEADER_VECTORS) {
            if (property === 'application-icon' || property === 'application-name') {
                await it(`${property}=${JSON.stringify(value)} — ${rule}`, () => {
                    const mounted = mount(value.length > 0 ? { [property]: value } : {});
                    const main = page(mounted.dialog, 'main')!;
                    const node =
                        property === 'application-icon'
                            ? main.querySelector('.adw-about-dialog-icon')
                            : main.querySelector('.adw-about-dialog-name');
                    expect(node !== null).toBe(visible);
                    mounted.dispose();
                });
                continue;
            }

            await it(`${property}=${JSON.stringify(value)} — ${rule}`, () => {
                const mounted = mount(value.length > 0 ? { [property]: value } : {});
                const main = page(mounted.dialog, 'main')!;
                const selector =
                    property === 'developer-name' ? '.adw-about-dialog-developer' : '.adw-about-dialog-version';
                expect(main.querySelector(selector) !== null).toBe(visible);
                mounted.dispose();
            });
        }

        await it('titles the dialog "About", not "About <app name>"', () => {
            // The main page's title is bound to AdwDialog:title, whose template default
            // is the bare word; the application name lives in the header revealer.
            const mounted = mount({ 'application-name': 'Builder' });
            expect(page(mounted.dialog, 'main')!.getAttribute('title')).toBe('About');
            mounted.dispose();
        });
    });

    await describe('adw-about-dialog activate-link is cancellable', async () => {
        await it('opens the URI when nothing handled the signal', () => {
            const mounted = mount({ 'application-name': 'Builder', website: 'https://example.org' });
            const row = page(mounted.dialog, 'main')!.querySelector(`adw-action-row[title="${label('websiteRow')}"]`)!;
            row.dispatchEvent(new CustomEvent('activated', { bubbles: true }));
            expect(mounted.opened).toStrictEqual(['https://example.org']);
            mounted.dispose();
        });

        await it('does NOT open when a handler cancels it', () => {
            // `activate_link_cb` returns the accumulated handler result (accumulator
            // `g_signal_accumulator_true_handled`): a handler saying "handled"
            // suppresses the default navigation, and `preventDefault()` is the web
            // spelling of that — so the event must be cancelable, or `window.open` runs
            // regardless.
            const mounted = mount({ 'application-name': 'Builder', website: 'https://example.org' });
            mounted.dialog.addEventListener('activate-link', (event) => event.preventDefault());
            const row = page(mounted.dialog, 'main')!.querySelector(`adw-action-row[title="${label('websiteRow')}"]`)!;
            row.dispatchEvent(new CustomEvent('activated', { bubbles: true }));
            expect(mounted.opened).toStrictEqual([]);
            mounted.dispose();
        });

        await it('is cancelable on a credit row too', () => {
            const mounted = mount();
            mounted.dialog.developers = ['Ada <ada@lovelace.org>'];
            mounted.dialog.addEventListener('activate-link', (event) => event.preventDefault());
            const row = page(mounted.dialog, 'credits')!.querySelector('adw-action-row')!;
            row.dispatchEvent(new CustomEvent('activated', { bubbles: true }));
            expect(mounted.opened).toStrictEqual([]);
            mounted.dispose();
        });
    });

    // The notes, debug and link doors, on the vectors real `gi://Adw` passes.
    const doorMounts: Mounted[] = [];
    const doorSubject = {
        name: 'adw-about-dialog',
        isOracle: false,
        labels: { ...ADW_ABOUT_DIALOG_LABELS, websiteRow: label('websiteRow') },
        isGLibUntranslated: true,
        makeDialog(): AboutDialogDoorLike {
            const mounted = mount({ 'application-name': 'Builder' });
            doorMounts.push(mounted);
            return mounted.dialog;
        },
        whatsNew(dialog: AboutDialogDoorLike): ReleaseNotesSegment[] {
            const notes =
                page(dialog as Mounted['dialog'], 'whatsnew')?.querySelectorAll(
                    '.adw-about-dialog-release-notes > span',
                ) ?? [];
            return [...notes].map((span) => ({
                text: span.textContent ?? '',
                tag: (span.dataset['tag'] ?? null) as ReleaseNotesSegment['tag'],
            }));
        },
        isRowVisible(dialog: AboutDialogDoorLike, row: 'whatsNewRow' | 'detailsRow' | 'troubleshootingRow'): boolean {
            return hasRow(page(dialog as Mounted['dialog'], 'main'), label(row));
        },
        debugInfoText(dialog: AboutDialogDoorLike): string {
            return (dialog as Mounted['dialog']).querySelector('pre.adw-about-dialog-debug-info')?.textContent ?? '';
        },
        linkTitles(dialog: AboutDialogDoorLike): string[] {
            return rowTitles(group(dialog as Mounted['dialog'], 'links'));
        },
        dispose() {
            for (const mounted of doorMounts.splice(0)) mounted.dispose();
        },
    };
    await driveReleaseNotesVectors(doorSubject, { describe, it, expect }, RELEASE_NOTES_VECTORS);
    await driveAboutDialogDoorVectors(doorSubject, { describe, it, expect }, ABOUT_DIALOG_DOOR_VECTORS);

    await describe('adw-about-dialog new_from_appdata and Copy Text', async () => {
        await it('refuses new_from_appdata by name', () => {
            const ctor = customElements.get('adw-about-dialog') as unknown as {
                new_from_appdata(path: string): unknown;
            };
            expect(() => ctor.new_from_appdata('/org/example/App/metainfo.xml')).toThrow(
                'Adw.AboutDialog.new_from_appdata',
            );
        });

        await it('shows the Copied toast when Copy Text copies the debug info', () => {
            const mounted = mount({ 'application-name': 'Builder', 'debug-info': 'GTK 4.20' });
            const copy = page(mounted.dialog, 'debuginfo')!.querySelector('.adw-about-dialog-copy') as HTMLElement;
            copy.click();
            const overlay = mounted.dialog.querySelector('adw-toast-overlay') as unknown as {
                currentToast: Toast | null;
            };
            expect(overlay.currentToast?.title).toBe(ADW_ABOUT_DIALOG_LABELS.copiedToast);
            mounted.dispose();
        });
    });

    // An opened dialog has to OCCUPY SPACE, and no other test here can see that: they
    // all read the built DOM, and all passed while the sheet measured 360×0.
    //
    // `adw-about-dialog.ui` declares `content-width` 360 and no content-height, so
    // libadwaita takes the height from the content — which absolutely-positioned
    // navigation pages cannot supply, since they contribute nothing to the page stack,
    // which contributes nothing to the view, and the pages are then `inset: 0` of a
    // zero-height parent.
    await describe('adw-about-dialog — an opened dialog is actually on screen', async () => {
        await it('gives its sheet a height derived from its content', () => {
            const mounted = mount({ 'application-name': 'Adwaita Storybook', version: '0.11.0' });
            mounted.dialog.setAttribute('open', '');

            const sheet = mounted.dialog.querySelector('.adw-about-dialog-sheet') as HTMLElement;
            const rect = sheet.getBoundingClientRect();
            // HEIGHT only: pinning the width needs `calc(100vw - 48px)` restated in JS,
            // where `100vw` and `innerWidth` disagree by the scrollbar, so the assertion
            // would report the harness rather than the widget.
            expect(rect.height > 0).toBe(true);
            // And not merely the header: the sheet has to be taller than the one
            // child that had a size of its own all along, which is what made the
            // collapse invisible to every other test in this file.
            const header = sheet.querySelector('adw-header-bar') as HTMLElement;
            expect(rect.height > header.getBoundingClientRect().height).toBe(true);

            mounted.dispose();
        });
    });

    await describe('adw-about-dialog link rows are AdwLinkRow, navigation rows are not', async () => {
        const iconOf = (row: Element) => row.querySelector('gtk-image');

        await it('draws website, support, issue and credit links as link rows with a tooltip', () => {
            const mounted = mount({
                website: 'https://example.org/a%20b',
                'support-url': 'https://example.org/help',
                'issue-url': 'https://example.org/issues',
            });
            mounted.dialog.developers = ['Ada <ada@example.org>', 'Bob https://example.org/bob'];
            mounted.dialog.add_link('_Docs', 'https://example.org/docs');

            const rows = [
                ...page(mounted.dialog, 'main')!.querySelectorAll('adw-action-row.link'),
                ...page(mounted.dialog, 'details')!.querySelectorAll('adw-action-row.link'),
                ...page(mounted.dialog, 'credits')!.querySelectorAll('adw-action-row.link'),
            ];
            expect(rows.length).toBe(6);
            for (const row of rows) {
                expect(row.getAttribute('role')).toBe('link');
                expect(row.hasAttribute('activatable')).toBe(true);
                expect(row.querySelector('[icon-name="go-next"], [icon="go-next"]')).toBe(null);
                expect(iconOf(row)).not.toBe(null);
            }
            const website = rows.find((r) => r.getAttribute('title') === label('websiteRow'))!;
            expect(website.getAttribute('tooltip-text')).toBe('https://example.org/a b');
            mounted.dispose();
        });

        await it('picks the glyph by scheme: mail-send for mailto:, external-link otherwise', () => {
            const mounted = mount({ website: 'https://example.org' });
            mounted.dialog.developers = ['Ada <ada@example.org>', 'Bob https://example.org/bob'];
            const credits = page(mounted.dialog, 'credits')!;
            const [ada, bob] = [...credits.querySelectorAll('adw-action-row.link')];
            expect(iconOf(ada!)!.className).toContain('adw-icon--adw-mail-send');
            expect(iconOf(bob!)!.className).toContain('adw-icon--adw-external-link');
            mounted.dispose();
        });

        await it('keeps the chevron and no link class on navigation rows', () => {
            const mounted = mount({ comments: 'Hi', website: 'https://example.org' });
            mounted.dialog.developers = ['Ada'];
            const nav = [...page(mounted.dialog, 'main')!.querySelectorAll('adw-action-row')].filter(
                (r) => !r.classList.contains('link'),
            );
            expect(nav.length > 0).toBe(true);
            for (const row of nav) {
                expect(row.classList.contains('link')).toBe(false);
                expect(row.getAttribute('role')).not.toBe('link');
                expect(iconOf(row)!.className).toContain('adw-icon--go-next');
            }
            mounted.dispose();
        });
    });
};
