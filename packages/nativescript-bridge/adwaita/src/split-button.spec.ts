// AdwSplitButton conformance tests, driven by the SAME vectors the browser
// renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// The two ports used to carry independent split-button logic and had drifted
// apart AND away from libadwaita: this renderer swapped the label VIEW out when
// an icon was set but kept the label VALUE, so `get label()` returned text
// nobody could see and the action sheet was titled with it, while the browser
// renderer showed the icon and the label at the same time. Nothing failed,
// because nothing compared them. This suite is that comparison.
//
// IMPORTANT: this file must NOT import `./widgets/adw-split-button.js` (nor the
// package root). That module `extends GridLayout`, which evaluates the bare
// `@nativescript/core` specifier at module-eval and is unresolvable on GJS/Node.
// The behaviour is exercised through the modules that are free of
// `@nativescript/core` value imports — `@gjsify/adwaita-core` and
// `./widgets/split-button.js` — which is the REAL shipping code the widget
// composes, not a mirror of it.

import { describe, expect, it } from '@gjsify/unit';

import {
    SplitButtonState,
    buildMenu,
    menuTree,
    resolveDropdownTooltip,
    splitButtonStyleClasses,
} from '@gjsify/adwaita-core';
import {
    MENU_FLATTEN_VECTORS,
    MENU_ITEM_STATE_VECTORS,
    MENU_NORMALIZE_VECTORS,
    SPLIT_BUTTON_DIRECTION_VECTORS,
    SPLIT_BUTTON_DROPDOWN_VECTORS,
    SPLIT_BUTTON_MENU_ACTIVATION_VECTORS,
    SPLIT_BUTTON_STYLE_CLASS_VECTORS,
    SPLIT_BUTTON_TOOLTIP_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import { ARROW_SVGS, splitButtonArrowSvg } from './widgets/split-button.js';
import { refuseMenuString } from './widgets/popup-menu.js';

export const AdwSplitButtonNsTest = async () => {
    // The content slots are the widget's DECLARED properties now; their vectors run against the
    // widget in `split-button-properties.spec.ts`.
    await describe('AdwSplitButton style classes (shared conformance vectors)', async () => {
        for (const { label, iconName, classes, rule } of SPLIT_BUTTON_STYLE_CLASS_VECTORS) {
            await it(`style classes for ${JSON.stringify(label)}/${JSON.stringify(iconName)} — ${rule}`, () => {
                expect([...splitButtonStyleClasses(label, iconName)]).toStrictEqual([...classes]);
            });
        }
    });

    await describe('AdwSplitButton.menuModel normalisation (shared conformance vectors)', async () => {
        for (const { input, tree, rule } of MENU_NORMALIZE_VECTORS) {
            await it(rule, () => {
                const state = new SplitButtonState();
                // ADR 0128: `buildMenu` is how an authored menu becomes a model, and the
                // state holds the MODEL. What it has to agree with is still the tree the
                // table names — `menuTree` is the one bridge back.
                state.setMenuModel(buildMenu(input));
                expect(menuTree(state.menuModel!)).toStrictEqual([...tree]);
            });
        }

        await it('refuses a JSON STRING by name, rather than answering an empty menu', () => {
            // NativeScript's Builder writes an XML attribute straight onto the property,
            // so `menuModel="[…]"` in a view file arrives as text. Left to
            // `normalizeMenuModel` it is simply "not an array" and the author gets a dead
            // dropdown with no diagnostic — a shut door that is also silent.
            expect(() => refuseMenuString('[{"label":"Save"}]', 'AdwSplitButton')).toThrow('AdwSplitButton.menuModel');
            expect(() => refuseMenuString('[{"label":"Save"}]', 'AdwSplitButton')).toThrow('ADR 0042');
            // Every form the model DOES take passes through untouched.
            expect(refuseMenuString(['Save'], 'AdwSplitButton')).toBe(undefined);
            expect(refuseMenuString([{ label: 'Save' }], 'AdwSplitButton')).toBe(undefined);
        });

        await it('buildMenu still takes the bare string[] this port was alone in taking', () => {
            const state = new SplitButtonState();
            state.setMenuModel(buildMenu(['Save as…', 'Export']));
            expect(menuTree(state.menuModel!)).toStrictEqual([
                { kind: 'item', label: 'Save as…' },
                { kind: 'item', label: 'Export' },
            ]);
        });
    });

    await describe('choosing a menu item (shared conformance vectors)', async () => {
        for (const { tree, path, activated, rule } of SPLIT_BUTTON_MENU_ACTIVATION_VECTORS) {
            await it(`activating ${JSON.stringify(path)} dispatches ${JSON.stringify(activated)} — ${rule}`, () => {
                const state = new SplitButtonState();
                state.setMenuModel(buildMenu(tree));
                expect(state.activateMenuItem(path)).toStrictEqual(activated);
            });
        }

        await it('a dismissal activates nothing', () => {
            const state = new SplitButtonState();
            state.setMenuModel(buildMenu([{ label: 'Print', action: 'app.print' }]));
            expect(state.activateMenuItem([])).toBe(null);
        });
    });

    await describe('dropdown sensitivity (shared conformance vectors)', async () => {
        for (const { tree, popover, enabled, canOpen, rule } of SPLIT_BUTTON_DROPDOWN_VECTORS) {
            const what = tree === null ? 'no model' : `${tree.length} entries`;
            await it(`${what}, popover=${popover} → enabled=${enabled} — ${rule}`, () => {
                const state = new SplitButtonState();
                if (popover) state.setPopover({ popover: true });
                // `null` is the only spelling of "no menu" since ADR 0128, so an EMPTY
                // tree is still installed — and leaves the dropdown live.
                if (tree !== null) state.setMenuModel(buildMenu(tree));
                // The `_openMenu()` guard: no menu ⇒ the popup is never shown,
                // and the arrow half is dimmed instead of looking live.
                expect(state.dropdownEnabled).toBe(enabled);
                expect(state.openMenu()).toBe(canOpen);
            });
        }
    });

    await describe('arrow direction (shared conformance vectors)', async () => {
        for (const { direction, arrowIcon, rule } of SPLIT_BUTTON_DIRECTION_VECTORS) {
            await it(`${direction} draws ${arrowIcon} — ${rule}`, () => {
                const svg = splitButtonArrowSvg(direction);
                expect(svg.startsWith('<svg')).toBe(true);
                expect(svg).toBe(ARROW_SVGS[arrowIcon]);
            });
        }

        await it('`none` draws the DOWN caret, not the open-menu hamburger (_buttons.scss:621-623)', () => {
            // This widget rendered `openMenuSymbolic` here for its whole life,
            // because core's glyph table was read off the PLAIN `menubutton
            // arrow.none` rule (:454-456) and the `splitbutton` block overrides it.
            expect(splitButtonArrowSvg('none')).toBe(splitButtonArrowSvg('down'));
            expect(splitButtonArrowSvg('none')).not.toBe(ARROW_SVGS['open-menu-symbolic']);
        });

        await it('gives the five directions FOUR distinct glyphs — none and down coincide', () => {
            const svgs = SPLIT_BUTTON_DIRECTION_VECTORS.map((vector) => splitButtonArrowSvg(vector.direction));
            expect(new Set(svgs).size).toBe(4);
            // The four that are NOT the override are still all different, so a
            // collapsed map cannot hide behind the `none === down` row.
            const directional = SPLIT_BUTTON_DIRECTION_VECTORS.filter((vector) => vector.direction !== 'none');
            expect(new Set(directional.map((vector) => splitButtonArrowSvg(vector.direction))).size).toBe(4);
        });
    });

    await describe('dropdown tooltip (shared conformance vectors)', async () => {
        for (const { tooltip, text, markup, rule } of SPLIT_BUTTON_TOOLTIP_VECTORS) {
            await it(`${JSON.stringify(tooltip)} → ${JSON.stringify(text)} — ${rule}`, () => {
                const state = new SplitButtonState();
                state.setDropdownTooltip(tooltip);
                expect(resolveDropdownTooltip(state.dropdownTooltip)).toStrictEqual({ text, markup });
            });
        }
    });
};
