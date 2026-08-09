// DOM-level conformance tests for <adw-about-dialog>, driven by the vectors in
// `@gjsify/adwaita-core/conformance` — the same table the core suite asserts.
//
// This element carried its own copy of `parse_person`, its own page-visibility
// rules and its own set of invented fallbacks, and diverged from libadwaita on
// thirteen counts. Two of them were not subtle: Support Questions and Report an
// Issue were rendered on the DETAILS page, one navigation step deeper than GTK
// puts them (adw-about-dialog.ui:146-186), and `website` was treated as Details
// content, which is exactly the one input libadwaita leaves OUT of that
// predicate (:1108). Nothing compared the two, so nothing failed.
import { describe, expect, it } from '@gjsify/unit';

import { ADW_ABOUT_DIALOG_LABELS, stripMnemonic } from '@gjsify/adwaita-core';
import {
    ABOUT_DIALOG_CREDITS_LEGAL_VECTORS,
    ABOUT_DIALOG_DETAILS_VECTORS,
    ABOUT_DIALOG_HEADER_VECTORS,
    ABOUT_DIALOG_SUPPORT_VECTORS,
    CREDITS_SECTIONS_VECTORS,
    CREDIT_PERSON_VECTORS,
} from '@gjsify/adwaita-core/conformance';

/** The label a renderer without an accelerator layer paints for a row. */
const label = (key: keyof typeof ADW_ABOUT_DIALOG_LABELS) => stripMnemonic(ADW_ABOUT_DIALOG_LABELS[key]);

interface Mounted {
    dialog: HTMLElement & { developers: string[]; designers: string[]; artists: string[]; documenters: string[] };
    host: HTMLElement;
    /** Every `window.open` the dialog performed, most recent last. */
    opened: string[];
    /** Restore the stubbed `window.open`. */
    dispose: () => void;
}

/**
 * Mount a dialog and set every attribute imperatively — several vectors hinge on
 * exact whitespace, which a value parsed out of markup is not a reliable
 * carrier for. `window.open` is stubbed because the link rows really do call it.
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
 * Activate a row and report the URI it asked for.
 *
 * The URI never reaches the DOM — it is captured in the row's activation
 * handler — so the only way to observe it is to drive the row and listen.
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
            // `if (link)` is a pointer test in the C, so `"Ada <>"` still links,
            // to the URI `mailto:` — collapsing "" to null loses the row type.
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
            // `add_credit_section` has no counterpart on this element yet, so the
            // rows exercising it are asserted by the core suite alone.
            if (input.creditSections) continue;
            // Same for `translator-credits`: no property, so no "Translated by".
            if (input.translatorCredits !== undefined) continue;

            await it(rule, () => {
                const mounted = mount();
                mounted.dialog.developers = [...(input.developers ?? [])];
                mounted.dialog.designers = [...(input.designers ?? [])];
                mounted.dialog.artists = [...(input.artists ?? [])];
                mounted.dialog.documenters = [...(input.documenters ?? [])];

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
        // `add_link` has no counterpart on this element, so `has_custom_links`
        // is always FALSE here; those rows are asserted by the core suite.
        for (const vector of ABOUT_DIALOG_DETAILS_VECTORS.filter((row) => !row.customLinks && !row.releaseNotes)) {
            const { website, comments, visible, rule } = vector;
            await it(`website=${website} comments=${comments} — ${rule}`, () => {
                const mounted = mount({
                    'application-name': 'Builder',
                    ...(website ? { website: 'https://example.org' } : {}),
                    ...(comments ? { comments: 'A description.' } : {}),
                });

                const main = page(mounted.dialog, 'main');
                const details = page(mounted.dialog, 'details');

                expect({
                    detailsGroup: group(mounted.dialog, 'details') !== null,
                    detailsRow: hasRow(main, label('detailsRow')),
                    websiteRow: hasRow(main, label('websiteRow')),
                    commentsLabel: details?.querySelector('.adw-about-dialog-comments') != null,
                    linksGroup: group(mounted.dialog, 'links') !== null,
                    detailsWebsiteRow: hasRow(details, label('websiteRow')),
                }).toStrictEqual({
                    detailsGroup: visible.detailsGroup,
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
            // `show_details` is `has_comments || has_custom_links` (:1108) —
            // website is deliberately not in it, so a dialog whose only extra is
            // a website links straight from the main page.
            const mounted = mount({ 'application-name': 'Builder', website: 'https://example.org' });
            expect(page(mounted.dialog, 'details')).toBe(null);
            expect(hasRow(page(mounted.dialog, 'main'), label('websiteRow'))).toBe(true);
            mounted.dispose();
        });
    });

    await describe('adw-about-dialog main page (update_support vectors)', async () => {
        // debug-info has no counterpart on this element (there is no
        // Troubleshooting page), so those rows are asserted by the core suite.
        for (const vector of ABOUT_DIALOG_SUPPORT_VECTORS.filter((row) => !row.debugInfo)) {
            const { supportUrl, issueUrl, visible, rule } = vector;
            await it(`support=${supportUrl} issue=${issueUrl} — ${rule}`, () => {
                const mounted = mount({
                    'application-name': 'Builder',
                    ...(supportUrl ? { 'support-url': 'https://example.org/help' } : {}),
                    ...(issueUrl ? { 'issue-url': 'https://example.org/issues' } : {}),
                });

                const main = page(mounted.dialog, 'main');
                expect({
                    supportGroup: group(mounted.dialog, 'support') !== null,
                    supportRow: hasRow(main, label('supportRow')),
                    issueRow: hasRow(main, label('issueRow')),
                }).toStrictEqual({
                    supportGroup: visible.supportGroup,
                    supportRow: visible.supportRow,
                    issueRow: visible.issueRow,
                });

                mounted.dispose();
            });
        }

        await it('puts the support and issue rows on the MAIN page, not on Details', () => {
            // adw-about-dialog.ui:146-186 — `support_group` is a child of the
            // main page, and the class docs say so outright (:87-90).
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
        // No acknowledgements API on this element; the core suite covers it.
        for (const vector of ABOUT_DIALOG_CREDITS_LEGAL_VECTORS.filter((row) => !row.hasAcknowledgements)) {
            const { hasCredits, hasLegal, visible, rule } = vector;
            await it(`credits=${hasCredits} legal=${hasLegal} — ${rule}`, () => {
                const mounted = mount({
                    'application-name': 'Builder',
                    ...(hasLegal ? { copyright: '© 2026 Ada' } : {}),
                });
                if (hasCredits) mounted.dialog.developers = ['Ada'];

                const main = page(mounted.dialog, 'main');
                expect({
                    creditsLegalGroup: group(mounted.dialog, 'credits-legal') !== null,
                    creditsRow: hasRow(main, label('creditsRow')),
                    legalRow: hasRow(main, label('legalRow')),
                }).toStrictEqual({
                    creditsLegalGroup: visible.creditsLegalGroup,
                    creditsRow: visible.creditsRow,
                    legalRow: visible.legalRow,
                });

                mounted.dispose();
            });
        }
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
            // The main page's title is bound to AdwDialog:title, whose template
            // default is the bare word (.ui:6, :19); the application name lives
            // in the header revealer instead (.ui:29-31).
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
            // `activate_link_cb` returns the accumulated handler result
            // (:429-437, accumulator `g_signal_accumulator_true_handled`
            // :2098): a handler saying "handled" suppresses the default
            // navigation. `preventDefault()` is the web spelling of that, and it
            // was unavailable — the event was not cancelable and `window.open`
            // ran regardless.
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

    // AN OPENED DIALOG HAS TO OCCUPY SPACE.
    //
    // Every other test in this file reads the built DOM, and all of them passed
    // while the dialog rendered INVISIBLE — its sheet measured 360×0. The suite
    // could not see that, because none of it looks at geometry.
    //
    // The sheet is `position: fixed` with a width and no height, which is what
    // `adw-about-dialog.ui:7` declares: `content-width` 360 and no
    // content-height, libadwaita taking the height from the content. The content
    // could not supply one — the navigation pages were absolutely positioned, so
    // they contributed nothing to the page stack, which contributed nothing to
    // the view, which left the sheet at zero; and the pages, being `inset: 0` of
    // a zero-height parent, were zero in turn.
    await describe('adw-about-dialog — an opened dialog is actually on screen', async () => {
        await it('gives its sheet a height derived from its content', () => {
            const mounted = mount({ 'application-name': 'Adwaita Storybook', version: '0.11.0' });
            mounted.dialog.setAttribute('open', '');

            const sheet = mounted.dialog.querySelector('.adw-about-dialog-sheet') as HTMLElement;
            const rect = sheet.getBoundingClientRect();
            // HEIGHT only. The width was never the defect, and pinning it here
            // needs `calc(100vw - 48px)` restated in JS — where `100vw` and
            // `innerWidth` disagree by the scrollbar (360 against a measured
            // 342), so the assertion would report the harness rather than the
            // widget. A test should assert the rule the bug broke.
            expect(rect.height > 0).toBe(true);
            // And not merely the header: the sheet has to be taller than the one
            // child that had a size of its own all along, which is what made the
            // collapse invisible to every other test in this file.
            const header = sheet.querySelector('adw-header-bar') as HTMLElement;
            expect(rect.height > header.getBoundingClientRect().height).toBe(true);

            mounted.dispose();
        });
    });
};
