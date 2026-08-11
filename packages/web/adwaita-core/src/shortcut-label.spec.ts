// The grammar and the keycap order are `SHORTCUT_LABEL_VECTORS`
// (conformance/shortcut-label.ts), driven here AND by the browser suite against
// real `<adw-shortcut-label>` elements — so a renderer that re-derives the parse
// fails a test naming the accelerator, not a screenshot review.
//
// What is asserted HERE and nowhere else is the parse-failure boundary, which
// has no DOM to look at: which malformed accelerators are rejected, and that a
// rejection keeps the nodes already built.

import { describe, expect, it } from '@gjsify/unit';

import { formatShortcutLabelNodes, SHORTCUT_LABEL_VECTORS } from './conformance/shortcut-label.js';
import { parseAccelerator, parseShortcutLabel } from './shortcut-label.js';

export default async () => {
    await describe('AdwShortcutLabel parse (conformance vectors)', async () => {
        for (const vector of SHORTCUT_LABEL_VECTORS) {
            await it(`${vector.accelerator || '(empty)'} — ${vector.rule}`, () => {
                const parse = parseShortcutLabel(vector.accelerator, {
                    disabledText: vector.disabledText,
                    direction: vector.direction,
                    platform: vector.platform,
                });

                expect(formatShortcutLabelNodes(parse.nodes)).toBe(vector.expected);
                if (vector.accessibleLabel !== undefined) {
                    expect(parse.accessibleLabel).toBe(vector.accessibleLabel);
                }
                expect(parse.error).toBe(vector.error ?? null);
            });
        }
    });

    await describe('accelerator parse failures', async () => {
        await it('rejects what is decidable without the keysym table', () => {
            // An unterminated modifier, an unknown modifier name, and a
            // modifier with no key at all. GTK's parse fails on all three.
            expect(parseAccelerator('<Control')).toBe(null);
            expect(parseAccelerator('<Frobnicate>a')).toBe(null);
            expect(parseAccelerator('<Control>')).toBe(null);
        });

        await it('accepts an unknown KEY name, which is not decidable here', () => {
            // Documented divergence: without GDK's keysym table this module
            // cannot tell `XF86AudioPlay` from a typo, so it renders it the way
            // GTK renders every name it does know (:332-346). Asserting the
            // divergence keeps it a decision rather than a surprise.
            expect(parseAccelerator('<Control>XF86AudioPlay')?.key).toBe('XF86AudioPlay');
            expect(formatShortcutLabelNodes(parseShortcutLabel('<Control>XF86AudioPlay').nodes)).toBe(
                '[Ctrl][XF86AudioPlay]',
            );
        });

        await it('keeps the nodes built before the failure', () => {
            // `rebuild` warns and BREAKS out of the loop (:531-534) — it does not
            // clear what it has already placed, so a half-parsed accelerator
            // renders its valid prefix.
            const parse = parseShortcutLabel('<Control>C <Frobnicate>x <Control>V');

            expect(parse.error).toBe('<Frobnicate>x');
            expect(formatShortcutLabelNodes(parse.nodes)).toBe('[Ctrl][C] /');
        });

        await it('treats <Release> as a marker, not a keycap', () => {
            const parsed = parseAccelerator('<Release><Control>a');

            expect(parsed?.key).toBe('a');
            expect([...(parsed?.modifiers ?? [])]).toStrictEqual(['control']);
        });
    });
};
