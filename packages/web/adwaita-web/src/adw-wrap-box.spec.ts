// DOM-level conformance tests for <adw-wrap-box>, driven by the SAME tables the
// NativeScript renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// There were no wrap-box specs at all, which is how sixteen divergences from
// `Adw.WrapBox` sat untouched (issue #1048). Three of them were wrong answers to
// the one question that IS portable — where a line's leftover space goes:
//
//   - `align` was written to `align-items`, the CROSS axis, where libadwaita
//     applies it as a MAIN-axis offset of the whole line block
//     (adw-wrap-layout.c:717-725), so `align="1"` pushed children DOWN;
//   - `JUSTIFY_MAP` mapped `fill` and `spread` to the same `space-between`,
//     where C grows the CHILDREN for one and the GAPS for the other
//     (adw-wrap-layout.c:317-341);
//   - `justify-last-line` was observed and never read, so the final line was
//     always justified — the opposite of the C default (adw-wrap-box.c:379-381).
//
// The element publishes its resolved decision as `data-line-justify` (what
// governs a complete line) and `data-last-line-justify` (what governs the final
// one), which is both what the stylesheet keys off and what these vectors read:
// the rendered `justify-content` / `flex-grow` are asserted alongside, so a
// correct data attribute with a stylesheet that ignores it still fails.

import { describe, expect, it } from '@gjsify/unit';

import {
    WRAP_BOX_CHILD_ORDER_VECTORS,
    WRAP_BOX_LENGTH_VECTORS,
    WRAP_BOX_LINE_VECTORS,
    WRAP_BOX_NATURAL_LENGTH_VECTORS,
    WRAP_BOX_NOTIFY_PROPERTIES,
    WRAP_BOX_POLICY_VECTORS,
    WRAP_BOX_SPACING_NOTIFY_VECTORS,
    WRAP_BOX_SPACING_VECTORS,
} from '@gjsify/adwaita-core/conformance';

/** Mount a wrap box with `n` block children and the given attributes. */
function mountWrapBox(attrs: Record<string, string>, n = 3): { box: HTMLElement; children: HTMLElement[] } {
    const box = document.createElement('adw-wrap-box');
    for (const [name, value] of Object.entries(attrs)) box.setAttribute(name, value);
    const children: HTMLElement[] = [];
    for (let i = 0; i < n; i++) {
        const child = document.createElement('div');
        child.textContent = `item ${i}`;
        box.appendChild(child);
        children.push(child);
    }
    document.body.appendChild(box);
    return { box, children };
}

/** Remove every wrap box a test mounted. */
function unmountAll(): void {
    for (const box of Array.from(document.querySelectorAll('adw-wrap-box'))) box.remove();
}

/** A vector value as it reads in a test name (`JSON.stringify` flattens NaN to null). */
function label(value: unknown): string {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * `justify-content` for an un-justified line at `align`.
 *
 * C offsets the line block by `roundf (length_delta * align)`, a continuum;
 * flexbox has three positions, so the port takes the nearest one. That
 * approximation lives here rather than in the vectors because it is the browser
 * renderer's, not libadwaita's.
 */
function expectedJustifyContent(align: number): string {
    if (align < 0.25) return 'flex-start';
    if (align < 0.75) return 'center';
    return 'flex-end';
}

export const AdwWrapBoxTest = async () => {
    await describe('<adw-wrap-box> line layout (Adw.WrapBox justify / align / justify-last-line)', async () => {
        for (const vector of WRAP_BOX_LINE_VECTORS) {
            const title =
                `justify=${vector.justify} last-line=${vector.justifyLastLine} align=${vector.align} ` +
                `${vector.lastLine ? 'final' : 'complete'} line of ${vector.childrenInLine}`;

            await it(`${title}: ${vector.rule}`, () => {
                const attrs: Record<string, string> = { justify: vector.justify, align: String(vector.align) };
                if (vector.justifyLastLine) attrs['justify-last-line'] = '';
                // A box with ONE child has exactly one line, and that line is the
                // final one — the only line membership CSS can know without a
                // layout pass, and the reason the stylesheet has an `:only-child`
                // rule at all.
                const childCount = vector.childrenInLine === 1 ? 1 : 3;
                const { box, children } = mountWrapBox(attrs, childCount);

                const resolved = vector.lastLine ? box.dataset.lastLineJustify : box.dataset.lineJustify;
                expect(resolved).toBe(vector.layout.justify);

                if (!vector.lastLine && vector.childrenInLine > 1) {
                    // `justify-content` is the container knob, and a flex
                    // container applies it to every line — so it carries the
                    // COMPLETE-line rule.
                    expect(getComputedStyle(box).justifyContent).toBe(
                        vector.layout.growGaps ? 'space-between' : expectedJustifyContent(vector.layout.align),
                    );
                }

                if (vector.lastLine && vector.childrenInLine === 1) {
                    expect(getComputedStyle(children[0]).flexGrow).toBe(vector.layout.growChildren ? '1' : '0');
                }

                unmountAll();
            });
        }

        await it('align is a MAIN-axis offset, never a cross-axis one', () => {
            const { box } = mountWrapBox({ align: '1' });
            const style = getComputedStyle(box);
            expect(style.justifyContent).toBe('flex-end');
            // The cross axis is libadwaita's `h = line_size` — every child takes
            // the full line extent (adw-wrap-layout.c:746-751).
            expect(style.alignItems).toBe('stretch');
            unmountAll();
        });

        await it('fill grows the children and keeps the gaps; spread does the opposite', () => {
            const filled = mountWrapBox({ justify: 'fill', 'justify-last-line': '', 'child-spacing': '10' });
            expect(getComputedStyle(filled.children[0]).flexGrow).toBe('1');
            expect(getComputedStyle(filled.box).justifyContent).toBe('flex-start');
            expect(getComputedStyle(filled.box).columnGap).toBe('10px');
            unmountAll();

            const spread = mountWrapBox({ justify: 'spread', 'justify-last-line': '', 'child-spacing': '10' });
            expect(getComputedStyle(spread.children[0]).flexGrow).toBe('0');
            expect(getComputedStyle(spread.box).justifyContent).toBe('space-between');
            unmountAll();
        });

        await it('a spread box whose last line is not justified gets the filler that packs it', () => {
            const { box } = mountWrapBox({ justify: 'spread' });
            // The only per-line hook flexbox offers: a generated flex item on the
            // final line that absorbs its leftover, so the line packs at the start
            // the way an un-justified line does.
            expect(getComputedStyle(box, '::after').flexGrow).toBe('1');
            unmountAll();

            const justified = mountWrapBox({ justify: 'spread', 'justify-last-line': '' });
            expect(getComputedStyle(justified.box, '::after').flexGrow).toBe('0');
            unmountAll();
        });

        await it('an unknown justify value falls back to the default, as an invalid enum does', () => {
            const { box } = mountWrapBox({ justify: 'stretch-everything' });
            expect(box.dataset.lineJustify).toBe('none');
            unmountAll();
        });
    });

    await describe('<adw-wrap-box> spacing (adw_wrap_box_set_child_spacing)', async () => {
        for (const vector of WRAP_BOX_SPACING_VECTORS) {
            await it(`child-spacing ${label(vector.value)} → ${vector.spacing}: ${vector.rule}`, () => {
                const attrs: Record<string, string> = {};
                if (vector.value !== null) attrs['child-spacing'] = String(vector.value);
                const { box } = mountWrapBox(attrs);

                expect((box as HTMLElement & { childSpacing: number }).childSpacing).toBe(vector.spacing);
                expect(getComputedStyle(box).columnGap).toBe(`${vector.spacing}px`);
                unmountAll();
            });

            await it(`line-spacing ${label(vector.value)} → ${vector.spacing}: ${vector.rule}`, () => {
                const attrs: Record<string, string> = {};
                if (vector.value !== null) attrs['line-spacing'] = String(vector.value);
                const { box } = mountWrapBox(attrs);

                expect((box as HTMLElement & { lineSpacing: number }).lineSpacing).toBe(vector.spacing);
                expect(getComputedStyle(box).rowGap).toBe(`${vector.spacing}px`);
                unmountAll();
            });
        }

        await it('a vertical box swaps which gap the two spacings drive', () => {
            const { box } = mountWrapBox({ orientation: 'vertical', 'child-spacing': '8', 'line-spacing': '4' });
            const style = getComputedStyle(box);
            expect(style.rowGap).toBe('8px');
            expect(style.columnGap).toBe('4px');
            unmountAll();
        });

        for (const vector of WRAP_BOX_SPACING_NOTIFY_VECTORS) {
            await it(`notify::child-spacing ${vector.from} → ${label(vector.value)} = ${vector.notifies}: ${vector.rule}`, () => {
                const { box } = mountWrapBox({ 'child-spacing': String(vector.from) });
                let notified = 0;
                box.addEventListener('notify::child-spacing', () => {
                    notified++;
                });
                box.setAttribute('child-spacing', String(vector.value));
                expect(notified).toBe(vector.notifies ? 1 : 0);
                unmountAll();
            });
        }
    });

    await describe('<adw-wrap-box> the properties neither port had (#1048)', async () => {
        for (const { value, policy, flexShrink, rule } of WRAP_BOX_POLICY_VECTORS) {
            await it(`wrap-policy ${label(value)} → ${policy}: ${rule}`, () => {
                const attrs: Record<string, string> = {};
                if (value !== null) attrs['wrap-policy'] = String(value);
                const { box, children } = mountWrapBox(attrs);
                expect((box as HTMLElement & { wrapPolicy: string }).wrapPolicy).toBe(policy);
                expect(getComputedStyle(children[0]).flexShrink).toBe(String(flexShrink));
                unmountAll();
            });
        }

        await it('a box with no wrap-policy forbids shrinking — CSS defaults to the OTHER one', () => {
            const { children } = mountWrapBox({});
            expect(getComputedStyle(children[0]).flexShrink).toBe('0');
            unmountAll();
        });

        for (const { value, unit, dpi, px, rule } of WRAP_BOX_LENGTH_VECTORS) {
            // The element resolves at the default dpi; the scaled rows are the
            // core suite's, since a browser has no `gtk-xft-dpi` to report.
            if (dpi !== 96 || value < 0) continue;
            await it(`child-spacing ${value}${String(unit)} → ${px}px: ${rule}`, () => {
                const attrs: Record<string, string> = { 'child-spacing': String(value) };
                if (unit !== null) attrs['child-spacing-unit'] = String(unit);
                const { box } = mountWrapBox(attrs);
                expect(getComputedStyle(box).columnGap).toBe(`${px}px`);
                unmountAll();
            });
        }

        for (const { value, length, rule } of WRAP_BOX_NATURAL_LENGTH_VECTORS) {
            await it(`natural-line-length ${label(value)} → ${length}: ${rule}`, () => {
                const attrs: Record<string, string> = {};
                if (value !== null) attrs['natural-line-length'] = String(value);
                const { box } = mountWrapBox(attrs);
                expect((box as HTMLElement & { naturalLineLength: number }).naturalLineLength).toBe(length);
                // -1 is UNSET, not a length: it must not reach the style at all.
                expect(box.style.maxWidth).toBe(length < 0 ? '' : `${length}px`);
                unmountAll();
            });
        }

        await it('a VERTICAL box caps the block axis, because that is where its lines run', () => {
            const { box } = mountWrapBox({ orientation: 'vertical', 'natural-line-length': '400' });
            expect(box.style.maxHeight).toBe('400px');
            expect(box.style.maxWidth).toBe('');
            unmountAll();
        });

        await it('pack-direction and wrap-reverse reverse the axes they own', () => {
            const packed = mountWrapBox({ 'pack-direction': 'end-to-start' });
            expect(getComputedStyle(packed.box).flexDirection).toBe('row-reverse');
            unmountAll();

            const reversed = mountWrapBox({ 'wrap-reverse': '' });
            expect(getComputedStyle(reversed.box).flexWrap).toBe('wrap-reverse');
            unmountAll();
        });

        await it('notifies for EVERY property, not just the two spacings', () => {
            const { box } = mountWrapBox({});
            const seen: string[] = [];
            for (const property of WRAP_BOX_NOTIFY_PROPERTIES) {
                box.addEventListener(`notify::${property}`, () => seen.push(property));
            }
            // One real change per property, each different from the default.
            box.setAttribute('child-spacing', '6');
            box.setAttribute('child-spacing-unit', 'sp');
            box.setAttribute('pack-direction', 'end-to-start');
            box.setAttribute('align', '1');
            box.setAttribute('justify', 'fill');
            box.toggleAttribute('justify-last-line', true);
            box.setAttribute('line-spacing', '4');
            box.setAttribute('line-spacing-unit', 'pt');
            box.toggleAttribute('line-homogeneous', true);
            box.setAttribute('natural-line-length', '400');
            box.setAttribute('natural-line-length-unit', 'sp');
            box.toggleAttribute('wrap-reverse', true);
            box.setAttribute('wrap-policy', 'minimum');
            box.setAttribute('orientation', 'vertical');

            expect([...seen].sort()).toStrictEqual([...WRAP_BOX_NOTIFY_PROPERTIES].sort());
            unmountAll();
        });

        await it('and stays silent for a value that normalises to what it already holds', () => {
            const { box } = mountWrapBox({ 'wrap-policy': 'minimum' });
            let notified = 0;
            box.addEventListener('notify::wrap-policy', () => {
                notified++;
            });
            box.setAttribute('wrap-policy', 'not-a-policy'); // → the default, a change
            expect(notified).toBe(1);
            box.setAttribute('wrap-policy', 'also-not-a-policy'); // → the default again
            expect(notified).toBe(1);
            unmountAll();
        });
    });

    await describe('<adw-wrap-box> child list (insert/reorder after, remove_all)', async () => {
        for (const { op, children, child, sibling, result, rule } of WRAP_BOX_CHILD_ORDER_VECTORS) {
            const name = `${op} ${child} after ${sibling ?? 'NULL'} in [${children.join(',')}]`;
            await it(`${name}: ${rule}`, () => {
                const box = document.createElement('adw-wrap-box') as HTMLElement & {
                    insertChildAfter(c: Element, s?: Element | null): boolean;
                    reorderChildAfter(c: Element, s?: Element | null): boolean;
                };
                document.body.appendChild(box);
                const byId = new Map<string, HTMLElement>();
                const make = (id: string) => {
                    const view = document.createElement('div');
                    view.dataset.id = id;
                    byId.set(id, view);
                    return view;
                };
                for (const id of children) box.appendChild(make(id));
                // The child being placed may be one of the mounted ones (a
                // reorder, or the "already parented" refusal) or a fresh one.
                const target = byId.get(child) ?? make(child);
                // A sibling the box does not have still has to be a real element.
                const after = sibling === null ? null : (byId.get(sibling) ?? make(sibling));

                const ok =
                    op === 'insert-after' ? box.insertChildAfter(target, after) : box.reorderChildAfter(target, after);
                expect(ok).toBe(result !== null);
                const order = [...box.children].map((view) => (view as HTMLElement).dataset.id);
                expect(order).toStrictEqual(result === null ? [...children] : [...result]);
                unmountAll();
            });
        }

        await it('removeAll empties the box, leaving the box itself mounted', () => {
            const { box } = mountWrapBox({}, 4);
            expect(box.children.length).toBe(4);
            (box as HTMLElement & { removeAll(): void }).removeAll();
            expect(box.children.length).toBe(0);
            expect(box.isConnected).toBe(true);
            unmountAll();
        });
    });
};
