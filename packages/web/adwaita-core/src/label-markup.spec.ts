// What a `Gtk.Label` DRAWS from its markup — the flat styled runs, the `<a href>` links
// over the display text, and `::activate-link`'s default rule. Both label renderers draw
// through `label-markup.ts`, so the derivation is asserted once, here; what a label reports
// as its TEXT is `label.spec.ts`.
//
// The rows are `conformance/label-markup.ts`. The hand-written cases below are the parts a
// table row cannot carry: `visited` across a re-parse, and the three-way order of
// `labelActivateLink` (a user handler, the window check, the launch).

import { describe, expect, it } from '@gjsify/unit';

import {
    LABEL_MARKUP_STYLE_PLAIN,
    type LabelActivateLinkSteps,
    type LabelLink,
    type LabelMarkupRun,
    labelActivateLink,
    labelHasLinks,
    labelLinkVisited,
    labelLinksHaveTooltip,
    labelLinksInheritVisited,
    labelMarkupRender,
} from './label-markup.js';
import {
    LABEL_MARKUP_LINK_VECTORS,
    LABEL_MARKUP_RUN_VECTORS,
    type LabelMarkupRunExpectation,
} from './conformance/label-markup.js';

/** One run as a table row writes it — every unset flag omitted, so a row stays readable. */
function runAsExpectation(run: LabelMarkupRun): LabelMarkupRunExpectation {
    const expectation: LabelMarkupRunExpectation = { text: run.text };
    const style = run.style;
    if (style.bold) expectation.bold = true;
    if (style.italic) expectation.italic = true;
    if (style.underline) expectation.underline = true;
    if (style.strikethrough) expectation.strikethrough = true;
    if (style.monospace) expectation.monospace = true;
    if (style.sizeSteps !== 0) expectation.sizeSteps = style.sizeSteps;
    if (style.script !== null) expectation.script = style.script;
    if (run.link !== null) expectation.link = run.link;
    if (style.spans.length > 0) expectation.spans = style.spans.map((attributes) => ({ ...attributes }));
    return expectation;
}

/** A link as its table row writes it — `visited` is a separate question, so it is dropped. */
function linkAsExpectation(link: LabelLink) {
    return {
        href: link.href,
        title: link.title,
        cssClass: link.cssClass,
        start: link.start,
        end: link.end,
    };
}

/** The steps of one `::activate-link`, with what each did recorded. */
function steps(options: { rooted: boolean; handled: boolean }): LabelActivateLinkSteps & { launched: string[] } {
    const launched: string[] = [];
    return {
        rooted: options.rooted,
        launched,
        emit: () => options.handled,
        launch: (uri: string) => {
            launched.push(uri);
        },
    };
}

export default async () => {
    await describe('LABEL_MARKUP_RUN_VECTORS — the styled runs a label draws', async () => {
        for (const vector of LABEL_MARKUP_RUN_VECTORS) {
            await it(vector.rule, () => {
                const render = labelMarkupRender(vector.markup);
                if (vector.runs.length === 0) {
                    // The unparseable row: no runs AT ALL is the `null` a caller turns into
                    // the raw string, not an empty render.
                    expect(render).toBe(null);
                    return;
                }
                expect(render).not.toBe(null);
                expect(render!.text).toBe(vector.text);
                expect(render!.runs.map(runAsExpectation)).toStrictEqual(
                    vector.runs.map((run) => ({
                        ...run,
                        ...(run.spans ? { spans: run.spans.map((a) => ({ ...a })) } : {}),
                    })),
                );
            });
        }

        await it('the runs concatenate to the text, on every row that parses', () => {
            for (const vector of LABEL_MARKUP_RUN_VECTORS) {
                const render = labelMarkupRender(vector.markup);
                if (render === null) continue;
                expect(render.runs.map((run) => run.text).join('')).toBe(render.text);
            }
        });
    });

    await describe('LABEL_MARKUP_LINK_VECTORS — the `<a href>` elements, and their ranges', async () => {
        for (const vector of LABEL_MARKUP_LINK_VECTORS) {
            await it(vector.rule, () => {
                const render = labelMarkupRender(vector.markup);
                if (vector.links === null) {
                    expect(render).toBe(null);
                    return;
                }
                expect(render).not.toBe(null);
                expect(render!.links.map(linkAsExpectation)).toStrictEqual(vector.links.map((link) => ({ ...link })));
                expect(labelHasLinks(render!.links)).toBe(vector.cssClass);
                expect(labelLinksHaveTooltip(render!.links)).toBe(vector.hasTooltip);
            });
        }

        await it("every range SLICES the display text to the link's own characters", () => {
            for (const vector of LABEL_MARKUP_LINK_VECTORS) {
                const render = labelMarkupRender(vector.markup);
                if (render === null) continue;
                for (const link of render.links) {
                    const sliced = render.text.slice(link.start, link.end);
                    // The property a renderer depends on: cutting with these offsets gives
                    // the characters, which is why they are UTF-16 units and not bytes.
                    expect(sliced.length).toBe(link.end - link.start);
                }
            }
        });

        await it('a link starts out unvisited, whatever the markup says', () => {
            const render = labelMarkupRender('<a href="https://gtk.org">docs</a>');
            expect(render!.links[0]!.visited).toBe(false);
        });
    });

    await describe('labelMarkupRender — the parse failures a caller shows raw', async () => {
        await it('is null on the strings `parseLabelMarkup` rejects', () => {
            expect(labelMarkupRender('a < b')).toBe(null);
            expect(labelMarkupRender('<b>unclosed')).toBe(null);
            expect(labelMarkupRender('<blink>no such tag</blink>')).toBe(null);
            expect(labelMarkupRender('<script>alert(1)</script>')).toBe(null);
        });

        await it('takes an absent markup string as the empty render, not as a failure', () => {
            const render = labelMarkupRender(undefined as unknown as string);
            expect(render).toStrictEqual({ text: '', runs: [], links: [] });
        });

        await it('gives a plain string ONE run with the plain style', () => {
            const render = labelMarkupRender('plain');
            expect(render!.runs).toStrictEqual([{ text: 'plain', style: LABEL_MARKUP_STYLE_PLAIN, link: null }]);
        });
    });

    await describe('labelLinksInheritVisited — followed stays followed across a re-parse', async () => {
        const followed: LabelLink = {
            href: 'https://gtk.org',
            title: null,
            cssClass: null,
            start: 0,
            end: 4,
            visited: true,
        };

        await it('carries visited over by URI, not by position', () => {
            const render = labelMarkupRender('see <a href="https://gtk.org">docs</a>', [followed]);
            expect(render!.links[0]!.visited).toBe(true);
        });

        await it('leaves a link to a different URI unvisited', () => {
            const render = labelMarkupRender('<a href="https://gnome.org">home</a>', [followed]);
            expect(render!.links[0]!.visited).toBe(false);
        });

        await it('shares one visited state between two links to the same place', () => {
            const render = labelMarkupRender('<a href="https://gtk.org">one</a> <a href="https://gtk.org">two</a>', [
                followed,
            ]);
            expect(render!.links.map((link) => link.visited)).toStrictEqual([true, true]);
        });

        await it('takes the FIRST match, as the C does', () => {
            const unfollowed: LabelLink = { ...followed, visited: false };
            expect(labelLinksInheritVisited([unfollowed], [unfollowed, followed])[0]!.visited).toBe(false);
            expect(labelLinksInheritVisited([unfollowed], [followed, unfollowed])[0]!.visited).toBe(true);
        });

        await it('hands the links straight back when there were none before', () => {
            const links = [{ ...followed, visited: false }];
            expect(labelLinksInheritVisited(links, [])).toBe(links);
        });
    });

    await describe('labelLinkVisited — following one link', async () => {
        const links: readonly LabelLink[] = [
            { href: 'a', title: null, cssClass: null, start: 0, end: 1, visited: false },
            { href: 'b', title: null, cssClass: null, start: 1, end: 2, visited: false },
            { href: 'a', title: null, cssClass: null, start: 2, end: 3, visited: false },
        ];

        await it('marks every link to the same URI, which is the one state they share', () => {
            expect(labelLinkVisited(links, 0).map((link) => link.visited)).toStrictEqual([true, false, true]);
        });

        await it('leaves the array alone when the link is already visited', () => {
            const once = labelLinkVisited(links, 1);
            expect(labelLinkVisited(once, 1)).toBe(once);
        });

        await it('leaves the array alone for an index that is not a link', () => {
            expect(labelLinkVisited(links, 7)).toBe(links);
        });
    });

    await describe('labelActivateLink — the signal order, then the default handler', async () => {
        await it('launches the URI when no handler took it, and counts that as visited', () => {
            const port = steps({ rooted: true, handled: false });
            expect(labelActivateLink('https://gtk.org', port)).toBe(true);
            expect(port.launched).toStrictEqual(['https://gtk.org']);
        });

        await it('does NOT launch when a handler returned true — the accumulator stops there', () => {
            const port = steps({ rooted: true, handled: true });
            expect(labelActivateLink('https://gtk.org', port)).toBe(true);
            expect(port.launched).toStrictEqual([]);
        });

        await it('launches nothing from a label with no window above it, and stays unvisited', () => {
            // `gtk_label_activate_link`'s first branch: no `GTK_IS_WINDOW` root, no launch.
            const port = steps({ rooted: false, handled: false });
            expect(labelActivateLink('https://gtk.org', port)).toBe(false);
            expect(port.launched).toStrictEqual([]);
        });

        await it('still lets a user handler win in an unrooted label, because it runs first', () => {
            const port = steps({ rooted: false, handled: true });
            expect(labelActivateLink('https://gtk.org', port)).toBe(true);
            expect(port.launched).toStrictEqual([]);
        });
    });
};
