// AdwShortcutLabel against `SHORTCUT_LABEL_VECTORS` — the same table the core
// suite and the browser renderer drive, so a divergence between the parse and
// what this renderer actually builds fails a test naming the accelerator.
//
// The serialiser below walks the REAL view tree the widget is built from and
// produces the table's compact form, discriminating on `className` exactly as
// the browser serialiser discriminates on `classList` — it reads only fields
// that end up on a view, so it cannot agree with a plan the widget would not
// render.
//
// THE APPLE ROWS ARE DRIVEN HERE. #1124 expected them to stay core-only ("no
// element to drive, because the glyph set is an option on the parse and not
// something the widget reads from its environment"). That is true of the browser
// element and NOT of this one: `#ifdef __APPLE__` upstream is iOS on
// NativeScript, and `isIOS` makes it readable — so `shortcutLabelPlatform` is
// the environment read, and both of its branches are asserted below.
//
// IMPORTANT: this file must NOT import `./widgets/adw-shortcut-label.js` (nor the
// package root). That module `extends StackLayout`, which evaluates the bare
// `@nativescript/core` specifier at module-eval and is unresolvable on GJS/Node.
// The rendering is exercised through `./widgets/shortcut-label.js`, the pure
// sibling the widget walks.

import { describe, expect, it } from '@gjsify/unit';

import { SHORTCUT_LABEL_VECTORS } from '@gjsify/adwaita-core/conformance';
import {
    SHORTCUT_LABEL_CAP_TEXT_CLASS,
    SHORTCUT_LABEL_DIMMED_CLASS,
    SHORTCUT_LABEL_DISABLED_CLASS,
    SHORTCUT_LABEL_KEYCAP_CLASS,
    SHORTCUT_LABEL_KEYS_CLASS,
    SHORTCUT_LABEL_SIDE_CLASS,
    SHORTCUT_LABEL_SPACED_CLASS,
    shortcutLabelDirection,
    shortcutLabelPlatform,
    shortcutLabelRenderPlan,
} from './widgets/shortcut-label.js';
import type { ShortcutLabelViewSpec } from './widgets/shortcut-label.js';

const classes = (spec: ShortcutLabelViewSpec): string[] => spec.className.split(' ');

const has = (spec: ShortcutLabelViewSpec, className: string): boolean => classes(spec).includes(className);

/** The text of the child carrying `className`, or a value that fails visibly. */
const childText = (spec: ShortcutLabelViewSpec, className: string): string => {
    const found = spec.children.find((child) => has(child, className));
    return found ? found.text : `<no .${className}>`;
};

/** The plan in the vectors' compact form (see conformance/shortcut-label.ts). */
const serialize = (children: readonly ShortcutLabelViewSpec[]): string =>
    children
        .map((child) => {
            if (has(child, SHORTCUT_LABEL_DISABLED_CLASS)) return `(disabled: ${child.text})`;
            if (has(child, SHORTCUT_LABEL_DIMMED_CLASS)) return child.text;

            return child.children
                .map((cap) => {
                    const label = childText(cap, SHORTCUT_LABEL_CAP_TEXT_CLASS);
                    const side = cap.children.find((grandchild) => has(grandchild, SHORTCUT_LABEL_SIDE_CLASS));
                    return `[${side ? `${label} (${side.text})` : label}]`;
                })
                .join('');
        })
        .join(' ')
        .trim();

export default async () => {
    await describe('AdwShortcutLabel (conformance vectors)', async () => {
        for (const vector of SHORTCUT_LABEL_VECTORS) {
            await it(`${vector.accelerator || '(empty)'} — ${vector.rule}`, () => {
                const plan = shortcutLabelRenderPlan(vector.accelerator, {
                    disabledText: vector.disabledText,
                    direction: vector.direction,
                    platform: vector.platform,
                });

                expect(serialize(plan.children)).toBe(vector.expected);
                if (vector.accessibleLabel !== undefined) {
                    expect(plan.accessibleLabel).toBe(vector.accessibleLabel);
                }
                expect(plan.error).toBe(vector.error ?? null);
            });
        }
    });

    await describe('AdwShortcutLabel view tree', async () => {
        await it('builds one box per combination, holding one keycap box per keycap', () => {
            const { children } = shortcutLabelRenderPlan('<Control>C');

            expect(children.length).toBe(1);
            expect(children[0].kind).toBe('box');
            expect(has(children[0], SHORTCUT_LABEL_KEYS_CLASS)).toBe(true);
            expect(children[0].children.map((cap) => cap.kind)).toStrictEqual(['box', 'box']);
            expect(children[0].children.every((cap) => has(cap, SHORTCUT_LABEL_KEYCAP_CLASS))).toBe(true);
        });

        await it('puts the side marker INSIDE the cap it belongs to, not in a cap of its own', () => {
            // `%s <small><b>%s</b></small>` (:195) is one label, not two keys —
            // a marker promoted to its own cap draws an empty-looking extra key.
            const { children } = shortcutLabelRenderPlan('Control_L');
            const cap = children[0].children[0];

            expect(children[0].children.length).toBe(1);
            expect(cap.children.map((child) => child.className)).toStrictEqual([
                SHORTCUT_LABEL_CAP_TEXT_CLASS,
                SHORTCUT_LABEL_SIDE_CLASS,
            ]);
            expect(cap.children.map((child) => child.text)).toStrictEqual(['Ctrl', 'L']);
        });

        await it('spaces every child but the first, at both levels', () => {
            // GTK's `border-spacing: 6px` puts the gap BETWEEN children only
            // (`_shortcuts-dialog.scss:37-39`). NS has no `gap` and its CSS
            // subset no `:first-child`, so a first child carrying the class is a
            // stray 6px at the leading edge and nothing would catch it.
            const { children } = shortcutLabelRenderPlan('<Shift>A Home');

            expect(children.map((child) => has(child, SHORTCUT_LABEL_SPACED_CLASS))).toStrictEqual([false, true, true]);
            expect(children[0].children.map((cap) => has(cap, SHORTCUT_LABEL_SPACED_CLASS))).toStrictEqual([
                false,
                true,
            ]);
        });

        await it('pins a combination box to LTR and leaves the separators inheriting', () => {
            // `gtk_widget_set_direction (box, GTK_TEXT_DIR_LTR)` (:380).
            const { children } = shortcutLabelRenderPlan('<Control>C+<Control>X', { direction: 'rtl' });

            expect(children.map((child) => child.direction)).toStrictEqual(['ltr', null, 'ltr']);
            expect(children[1].text).toBe('←');
        });

        await it('keeps the partial tree a failed parse leaves behind', () => {
            const plan = shortcutLabelRenderPlan('<Control>C <Frobnicate>x');

            expect(plan.error).toBe('<Frobnicate>x');
            expect(serialize(plan.children)).toBe('[Ctrl][C] /');
        });
    });

    await describe('AdwShortcutLabel environment reads', async () => {
        await it('draws the Apple glyph set on iOS and the words elsewhere', () => {
            expect(shortcutLabelPlatform(true)).toBe('apple');
            expect(shortcutLabelPlatform(false)).toBe('default');
            expect(serialize(shortcutLabelRenderPlan('<Primary>c', { platform: 'apple' }).children)).toBe('[⌘][C]');
            expect(serialize(shortcutLabelRenderPlan('<Primary>c', { platform: 'default' }).children)).toBe(
                '[Ctrl][C]',
            );
        });

        await it("treats NS's unresolved inherited direction as LTR", () => {
            // `direction` is `null` until the view is attached, which is exactly
            // when a constructor reads it — a null read must not mean RTL.
            expect(shortcutLabelDirection(null)).toBe('ltr');
            expect(shortcutLabelDirection(undefined)).toBe('ltr');
            expect(shortcutLabelDirection('rtl')).toBe('rtl');
            expect(shortcutLabelDirection('ltr')).toBe('ltr');
        });
    });
};
