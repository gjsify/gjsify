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
    normalizeMenuModel,
    resolveDropdownTooltip,
    splitButtonStyleClasses,
} from '@gjsify/adwaita-core';
import type { AdwMenuModel, AdwMenuPath } from '@gjsify/adwaita-core';
import {
    MENU_FLATTEN_VECTORS,
    MENU_ITEM_STATE_VECTORS,
    MENU_NORMALIZE_VECTORS,
    SPLIT_BUTTON_CONTENT_VECTORS,
    SPLIT_BUTTON_DIRECTION_VECTORS,
    SPLIT_BUTTON_DROPDOWN_VECTORS,
    SPLIT_BUTTON_MENU_ACTIVATION_VECTORS,
    SPLIT_BUTTON_STYLE_CLASS_VECTORS,
    SPLIT_BUTTON_TOOLTIP_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import { ARROW_SVGS, setActionIcon, splitButtonArrowSvg } from './widgets/split-button.js';
import { refuseMenuString } from './widgets/popup-menu.js';

/** Which of the two action views the widget parents for a given state. */
function parentedView(state: SplitButtonState): 'icon' | 'label' {
    return state.mode === 'icon' ? 'icon' : 'label';
}

export const AdwSplitButtonNsTest = async () => {
    await describe('AdwSplitButton content (shared conformance vectors)', async () => {
        for (const vector of SPLIT_BUTTON_CONTENT_VECTORS) {
            await it(`renders the right half through: ${vector.name}`, () => {
                const state = new SplitButtonState();
                const children = new Map<string, object>();

                for (const step of vector.steps) {
                    if (step.op === 'label') state.setLabel(step.value ?? '');
                    else if (step.op === 'icon-name') state.setIconName(step.value ?? '');
                    else if (step.value === null) state.setChild(null);
                    else {
                        let child = children.get(step.value);
                        if (child === undefined) {
                            child = { widget: step.value };
                            children.set(step.value, child);
                        }
                        state.setChild(child);
                    }

                    expect(state.mode).toBe(step.mode);
                    // The regression this suite exists for: in icon mode the
                    // label is GONE, not merely hidden behind a swapped view.
                    expect(state.label).toBe(step.label);
                    expect(state.iconName).toBe(step.iconName);
                    expect(parentedView(state)).toBe(step.mode === 'icon' ? 'icon' : 'label');
                    expect([...splitButtonStyleClasses(state.label, state.iconName)]).toStrictEqual([
                        ...step.styleClasses,
                    ]);
                }
            });
        }

        for (const { label, iconName, classes, rule } of SPLIT_BUTTON_STYLE_CLASS_VECTORS) {
            await it(`style classes for ${JSON.stringify(label)}/${JSON.stringify(iconName)} — ${rule}`, () => {
                expect([...splitButtonStyleClasses(label, iconName)]).toStrictEqual([...classes]);
            });
        }
    });

    await describe('AdwSplitButton.iconName ⟷ label (the real setActionIcon mapping)', async () => {
        await it('an SVG replaces the label, and clearing it hands the half back', () => {
            const state = new SplitButtonState();
            state.setLabel('Save');
            expect(state.label).toBe('Save');

            setActionIcon(state, '<svg id="save"/>');
            expect(state.mode).toBe('icon');
            expect(state.iconName).toBe('<svg id="save"/>');
            // Not "hidden": the sheet title reads this, and it must be empty now.
            expect(state.label).toBe(null);

            setActionIcon(state, '');
            expect(state.mode).toBe('empty');
            expect(state.iconName).toBe(null);

            state.setLabel('Save');
            expect(state.mode).toBe('label');
            expect(state.label).toBe('Save');
        });

        await it('clearing an icon that was never set is a no-op', () => {
            const state = new SplitButtonState();
            state.setLabel('Save');
            setActionIcon(state, null);
            expect(state.mode).toBe('label');
            expect(state.label).toBe('Save');
        });
    });

    await describe('AdwSplitButton.menuModel normalisation (shared conformance vectors)', async () => {
        for (const { input, model, rule } of MENU_NORMALIZE_VECTORS) {
            await it(rule, () => {
                const state = new SplitButtonState();
                state.setMenuModel(input);
                expect(state.menuModel ?? []).toStrictEqual(model.length === 0 ? [] : [...model]);
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

        await it('still accepts the bare string[] this port used to be alone in taking', () => {
            const state = new SplitButtonState();
            state.setMenuModel(['Save as…', 'Export']);
            expect(state.menuModel).toStrictEqual([
                { kind: 'item', label: 'Save as…' },
                { kind: 'item', label: 'Export' },
            ]);
        });
    });

    await describe('choosing a menu item (shared conformance vectors)', async () => {
        for (const { model, path, activated, rule } of SPLIT_BUTTON_MENU_ACTIVATION_VECTORS) {
            await it(`activating ${JSON.stringify(path)} dispatches ${JSON.stringify(activated)} — ${rule}`, () => {
                const state = new SplitButtonState();
                state.setMenuModel(model);
                expect(state.activateMenuItem(path)).toStrictEqual(activated);
            });
        }

        await it('a dismissal activates nothing', () => {
            const state = new SplitButtonState();
            state.setMenuModel([{ label: 'Print', action: 'app.print' }]);
            expect(state.activateMenuItem([])).toBe(null);
        });
    });

    await describe('dropdown sensitivity (shared conformance vectors)', async () => {
        for (const { model, popover, enabled, canOpen, rule } of SPLIT_BUTTON_DROPDOWN_VECTORS) {
            await it(`${model.length} entries, popover=${popover} → enabled=${enabled} — ${rule}`, () => {
                const state = new SplitButtonState();
                if (popover) state.setPopover({ popover: true });
                if (model.length > 0) state.setMenuModel(model);
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
