// Split-button behaviour specs — driven by the shared conformance vectors, so
// this suite and the two renderer suites assert the SAME table.

import { describe, expect, it } from '@gjsify/unit';

import {
    DEFAULT_DROPDOWN_TOOLTIP,
    SplitButtonState,
    isSplitButtonDirection,
    menuButtonArrowIcon,
    menuButtonPopupDirection,
    resolveDropdownTooltip,
    splitButtonArrowIcon,
    splitButtonPopupDirection,
    splitButtonRootState,
    splitButtonStyleClasses,
} from './split-button.js';
import type { SplitButtonProperty } from './split-button.js';
import type { AdwMenuModel } from './menu.js';
import {
    MENU_BUTTON_DIRECTION_VECTORS,
    SPLIT_BUTTON_CONTENT_VECTORS,
    SPLIT_BUTTON_DIRECTION_VECTORS,
    SPLIT_BUTTON_DROPDOWN_VECTORS,
    SPLIT_BUTTON_MENU_ACTIVATION_VECTORS,
    SPLIT_BUTTON_ROOT_STATE_VECTORS,
    SPLIT_BUTTON_STYLE_CLASS_VECTORS,
    SPLIT_BUTTON_TOOLTIP_VECTORS,
} from './conformance/split-button.js';
import type { SplitButtonContentStep } from './conformance/split-button.js';

/**
 * Apply one vector step. `child` steps name their widget by key, so the same key within a
 * sequence is the same object — what the pointer-equality guard keys off.
 */
function applyStep(state: SplitButtonState, step: SplitButtonContentStep, children: Map<string, object>): boolean {
    switch (step.op) {
        case 'label':
            // Only `child` steps carry a null value; see the vector table's docs.
            return state.setLabel(step.value ?? '');
        case 'icon-name':
            return state.setIconName(step.value ?? '');
        default: {
            if (step.value === null) return state.setChild(null);
            let child = children.get(step.value);
            if (child === undefined) {
                child = { widget: step.value };
                children.set(step.value, child);
            }
            return state.setChild(child);
        }
    }
}

export default async () => {
    await describe('SplitButtonState defaults (adw-split-button.c:311-435)', async () => {
        await it('starts empty, down, untooltipped and with a dead dropdown', () => {
            const state = new SplitButtonState();
            expect(state.mode).toBe('empty');
            expect(state.label).toBe(null);
            expect(state.iconName).toBe(null);
            expect(state.child).toBe(null);
            expect(state.useUnderline).toBe(false);
            expect(state.direction).toBe('down');
            // The getter reports "" while unset, never null.
            expect(state.dropdownTooltip).toBe('');
            expect(state.menuModel).toBe(null);
            expect(state.popover).toBe(null);
            expect(state.dropdownEnabled).toBe(false);
            expect(state.open).toBe(false);
            expect([...state.styleClasses]).toStrictEqual([]);
        });
    });

    await describe('SplitButtonState content machine (libadwaita conformance vectors)', async () => {
        for (const vector of SPLIT_BUTTON_CONTENT_VECTORS) {
            await it(vector.name, () => {
                const state = new SplitButtonState();
                const children = new Map<string, object>();

                for (const step of vector.steps) {
                    const emissions: (readonly SplitButtonProperty[])[] = [];
                    const off = state.subscribe((change) => emissions.push(change.notified));
                    const changed = applyStep(state, step, children);
                    off();

                    expect(changed).toBe(step.changed);
                    expect(emissions).toHaveLength(step.changed ? 1 : 0);
                    if (step.changed) expect([...emissions[0]!]).toStrictEqual([...step.notified]);

                    expect(state.mode).toBe(step.mode);
                    expect(state.label).toBe(step.label);
                    expect(state.iconName).toBe(step.iconName);
                    expect([...state.styleClasses]).toStrictEqual([...step.styleClasses]);

                    if (step.op === 'child' && step.value !== null) {
                        expect(state.child).toBe(children.get(step.value));
                    } else if (step.mode === 'label' || step.mode === 'icon') {
                        // gtk_button_get_child() reports the INTERNAL content
                        // widget here, never the app child.
                        expect(state.child).not.toBe(null);
                        for (const child of children.values()) expect(state.child).not.toBe(child);
                    } else if (step.mode === 'empty') {
                        expect(state.child).toBe(null);
                    }
                }
            });
        }

        await it('rejects a null label like g_return_if_fail does (c:666)', () => {
            const state = new SplitButtonState();
            state.setLabel('Open');
            let emissions = 0;
            state.subscribe(() => emissions++);
            expect(state.setLabel(null as unknown as string)).toBe(false);
            expect(state.label).toBe('Open');
            expect(emissions).toBe(0);
        });

        await it('rejects a null icon name like g_return_if_fail does (c:754)', () => {
            const state = new SplitButtonState();
            state.setIconName('document-open-symbolic');
            let emissions = 0;
            state.subscribe(() => emissions++);
            expect(state.setIconName(null as unknown as string)).toBe(false);
            expect(state.iconName).toBe('document-open-symbolic');
            expect(emissions).toBe(0);
        });

        await it('setChild(null) is the only way back to the empty state', () => {
            const state = new SplitButtonState();
            state.setLabel('Open');
            expect(state.setChild(null)).toBe(true);
            expect(state.mode).toBe('empty');
            expect(state.label).toBe(null);
            expect(state.child).toBe(null);
        });

        await it('unsubscribing stops the fan-out', () => {
            const state = new SplitButtonState();
            let hits = 0;
            const off = state.subscribe(() => hits++);
            state.setLabel('Open');
            off();
            state.setLabel('Find');
            expect(hits).toBe(1);
        });
    });

    await describe('splitButtonStyleClasses (adw-split-button.c:145-165)', async () => {
        for (const { label, iconName, classes, rule } of SPLIT_BUTTON_STYLE_CLASS_VECTORS) {
            await it(`${JSON.stringify(label)} / ${JSON.stringify(iconName)} → [${classes.join(', ')}] — ${rule}`, () => {
                expect([...splitButtonStyleClasses(label, iconName)]).toStrictEqual([...classes]);
            });
        }
    });

    await describe('use-underline (test_adw_split_button_use_underline, tests:97-123)', async () => {
        await it('notifies 0, 1, 2 times for false, true, false', () => {
            const state = new SplitButtonState();
            let notified = 0;
            state.subscribe(() => notified++);

            expect(state.setUseUnderline(false)).toBe(false);
            expect(notified).toBe(0);

            expect(state.setUseUnderline(true)).toBe(true);
            expect(state.useUnderline).toBe(true);
            expect(notified).toBe(1);

            expect(state.setUseUnderline(false)).toBe(true);
            expect(state.useUnderline).toBe(false);
            expect(notified).toBe(2);
        });

        await it('!!-normalises a truthy non-boolean (c:715)', () => {
            const state = new SplitButtonState();
            expect(state.setUseUnderline(2 as unknown as boolean)).toBe(true);
            expect(state.useUnderline).toBe(true);
            // Stored as a real boolean, so the idempotence guard now holds.
            expect(state.setUseUnderline(true)).toBe(false);
        });
    });

    await describe('menu-model ⟷ popover exclusivity (tests:172-243)', async () => {
        const model1: AdwMenuModel = [{ kind: 'item', label: 'Save as…', action: 'app.save-as' }];
        const model2: AdwMenuModel = [{ kind: 'item', label: 'Export', action: 'app.export' }];

        await it('notifies menu-model 1, 2, 3 times as a popover displaces it (tests:185-199)', () => {
            const state = new SplitButtonState();
            let notified = 0;
            state.subscribe((change) => {
                if (change.notified.includes('menu-model')) notified++;
            });

            expect(state.setMenuModel(model1)).toBe(true);
            // The state stores its OWN normalised copy, so this is value equality and
            // not identity — see `setMenuModel`'s note on C's pointer guard.
            expect(state.menuModel).toStrictEqual([...model1]);
            expect(notified).toBe(1);

            expect(state.setMenuModel(model2)).toBe(true);
            expect(state.menuModel).toStrictEqual([...model2]);
            expect(notified).toBe(2);

            const popover = { popover: true };
            expect(state.setPopover(popover)).toBe(true);
            expect(state.menuModel).toBe(null);
            expect(state.popover).toBe(popover);
            expect(notified).toBe(3);
        });

        await it('notifies popover 1, 2, 3 times as a menu model displaces it (tests:221-239)', () => {
            const state = new SplitButtonState();
            const popover1 = { popover: 1 };
            const popover2 = { popover: 2 };
            let notified = 0;
            state.subscribe((change) => {
                if (change.notified.includes('popover')) notified++;
            });

            expect(state.setPopover(popover1)).toBe(true);
            expect(notified).toBe(1);

            expect(state.setPopover(popover2)).toBe(true);
            expect(state.popover).toBe(popover2);
            expect(notified).toBe(2);

            expect(state.setMenuModel(model1)).toBe(true);
            // Which popover a model derives is an implementation detail; only "not the one
            // just set" is guaranteed.
            expect(state.popover).not.toBe(popover2);
            expect(state.popover).not.toBe(null);
            expect(notified).toBe(3);
        });

        await it('the cleared property is notified before the set one', () => {
            const state = new SplitButtonState();
            state.setMenuModel(model1);
            const emissions: (readonly SplitButtonProperty[])[] = [];
            state.subscribe((change) => emissions.push(change.notified));
            state.setPopover({ popover: true });
            expect([...emissions[0]!]).toStrictEqual(['menu-model', 'popover']);
        });

        await it('re-setting the same model is a no-op', () => {
            const state = new SplitButtonState();
            state.setMenuModel(model1);
            expect(state.setMenuModel(model1)).toBe(false);
        });

        await it('an empty list is no menu model at all', () => {
            const state = new SplitButtonState();
            expect(state.setMenuModel([])).toBe(false);
            expect(state.menuModel).toBe(null);
            expect(state.dropdownEnabled).toBe(false);

            state.setMenuModel(model1);
            expect(state.setMenuModel([])).toBe(true);
            expect(state.menuModel).toBe(null);
            expect(state.dropdownEnabled).toBe(false);
        });

        await it('losing the dropdown closes an open menu', () => {
            const state = new SplitButtonState();
            state.setMenuModel(model1);
            expect(state.openMenu()).toBe(true);
            state.setMenuModel(null);
            expect(state.open).toBe(false);
        });
    });

    await describe('dropdown sensitivity (libadwaita conformance vectors)', async () => {
        for (const { model, popover, enabled, canOpen, rule } of SPLIT_BUTTON_DROPDOWN_VECTORS) {
            await it(`${model.length} entries, popover=${popover} → enabled=${enabled} — ${rule}`, () => {
                const state = new SplitButtonState();
                if (popover) state.setPopover({ popover: true });
                if (model.length > 0) state.setMenuModel(model);
                expect(state.dropdownEnabled).toBe(enabled);
                expect(state.openMenu()).toBe(canOpen);
                expect(state.open).toBe(canOpen);
            });
        }

        await it('toggleMenu tags the change interactive, openMenu does not', () => {
            const state = new SplitButtonState();
            state.setMenuModel([{ label: 'Save as…' }]);
            const interactive: boolean[] = [];
            state.subscribe((change) => interactive.push(change.interactive));

            state.openMenu();
            state.closeMenu();
            state.toggleMenu();
            expect(interactive).toStrictEqual([false, false, true]);
        });
    });

    await describe('direction (test_adw_split_button_direction, tests:245-271)', async () => {
        await it('notifies 0, 1, 2 times for down, up, down', () => {
            const state = new SplitButtonState();
            let notified = 0;
            state.subscribe(() => notified++);

            expect(state.setDirection('down')).toBe(false);
            expect(notified).toBe(0);

            expect(state.setDirection('up')).toBe(true);
            expect(state.direction).toBe('up');
            expect(notified).toBe(1);

            expect(state.setDirection('down')).toBe(true);
            expect(state.direction).toBe('down');
            expect(notified).toBe(2);
        });

        await it('rejects a value that is not a GtkArrowType', () => {
            const state = new SplitButtonState();
            expect(state.setDirection('sideways' as unknown as 'up')).toBe(false);
            expect(state.direction).toBe('down');
            expect(isSplitButtonDirection('sideways')).toBe(false);
            expect(isSplitButtonDirection('none')).toBe(true);
        });

        for (const { direction, arrowIcon, popupDirection, rule } of SPLIT_BUTTON_DIRECTION_VECTORS) {
            await it(`${direction} → ${arrowIcon}, popup ${popupDirection} — ${rule}`, () => {
                expect(splitButtonArrowIcon(direction)).toBe(arrowIcon);
                expect(splitButtonPopupDirection(direction)).toBe(popupDirection);

                const state = new SplitButtonState();
                state.setDirection(direction);
                expect(state.arrowIcon).toBe(arrowIcon);
            });
        }

        for (const { direction, arrowIcon, popupDirection, rule } of MENU_BUTTON_DIRECTION_VECTORS) {
            await it(`plain menubutton: ${direction} → ${arrowIcon}, popup ${popupDirection} — ${rule}`, () => {
                expect(menuButtonArrowIcon(direction)).toBe(arrowIcon);
                expect(menuButtonPopupDirection(direction)).toBe(popupDirection);
            });
        }

        await it('the two tables differ ONLY at `none` — that is the whole splitbutton override', () => {
            const shared = MENU_BUTTON_DIRECTION_VECTORS.filter((vector) => vector.direction !== 'none');
            for (const { direction, arrowIcon } of shared) expect(splitButtonArrowIcon(direction)).toBe(arrowIcon);

            // `menubutton arrow.none` against `splitbutton > menubutton > button >
            // arrow.none` — the only glyph the split-button block re-declares.
            expect(menuButtonArrowIcon('none')).toBe('open-menu-symbolic');
            expect(splitButtonArrowIcon('none')).toBe('pan-down-symbolic');
            expect(splitButtonArrowIcon('none')).toBe(splitButtonArrowIcon('down'));
        });

        await it('placement is NOT overridden: the two functions are the same object (c:971, :997)', () => {
            // `adw_split_button_set_direction` hands the value straight to
            // `gtk_menu_button_set_direction`, so a copy here could only drift.
            expect(menuButtonPopupDirection).toBe(splitButtonPopupDirection);
        });
    });

    await describe('dropdown tooltip (test_adw_split_button_dropdown_tooltip, tests:273-298)', async () => {
        await it('notifies 0, 1, 2 times for "", set, re-set', () => {
            const state = new SplitButtonState();
            let notified = 0;
            state.subscribe(() => notified++);

            // The guard compares against the getter, which already reports "".
            expect(state.setDropdownTooltip('')).toBe(false);
            expect(notified).toBe(0);

            expect(state.setDropdownTooltip('Some tooltip')).toBe(true);
            expect(state.dropdownTooltip).toBe('Some tooltip');
            expect(notified).toBe(1);

            expect(state.setDropdownTooltip('Some other tooltip')).toBe(true);
            expect(state.dropdownTooltip).toBe('Some other tooltip');
            expect(notified).toBe(2);
        });

        await it('clearing a set tooltip RESTORES the default rather than blanking it', () => {
            const state = new SplitButtonState();
            state.setDropdownTooltip('Some tooltip');
            expect(state.setDropdownTooltip('')).toBe(true);
            expect(state.dropdownTooltip).toBe('');
            expect(resolveDropdownTooltip(state.dropdownTooltip)).toStrictEqual({
                text: DEFAULT_DROPDOWN_TOOLTIP,
                markup: false,
            });
        });

        for (const { tooltip, text, markup, rule } of SPLIT_BUTTON_TOOLTIP_VECTORS) {
            await it(`${JSON.stringify(tooltip)} → ${JSON.stringify(text)} (markup: ${markup}) — ${rule}`, () => {
                expect(resolveDropdownTooltip(tooltip)).toStrictEqual({ text, markup });
            });
        }
    });

    await describe('splitButtonRootState (adw-split-button.c:118-143)', async () => {
        for (const { action, dropdown, active, checked, rule } of SPLIT_BUTTON_ROOT_STATE_VECTORS) {
            await it(`${rule}`, () => {
                expect(splitButtonRootState(action, dropdown)).toStrictEqual({ active, checked });
            });
        }
    });

    await describe('activateMenuItem is BY POSITION (libadwaita conformance vectors)', async () => {
        for (const { model, path, activated, rule } of SPLIT_BUTTON_MENU_ACTIVATION_VECTORS) {
            await it(`path [${path.join('.')}] → ${JSON.stringify(activated)} — ${rule}`, () => {
                const state = new SplitButtonState();
                state.setMenuModel(model);
                expect(state.activateMenuItem(path)).toStrictEqual(activated);
            });
        }

        await it('activating an item dismisses the menu', () => {
            const state = new SplitButtonState();
            state.setMenuModel([{ label: 'Save as…', action: 'app.save-as' }]);
            expect(state.openMenu()).toBe(true);
            expect(state.open).toBe(true);
            expect(state.activateMenuItem([0])).toStrictEqual({
                kind: 'item',
                label: 'Save as…',
                action: 'app.save-as',
            });
            expect(state.open).toBe(false);
        });

        await it('an out-of-range activation leaves the menu alone', () => {
            const state = new SplitButtonState();
            state.setMenuModel([{ label: 'Save as…' }]);
            state.openMenu();
            expect(state.activateMenuItem([5])).toBe(null);
            expect(state.open).toBe(true);
        });

        await it('setting the same model twice notifies once — value equality replaces C’s pointer guard', () => {
            const state = new SplitButtonState();
            let notified = 0;
            state.subscribe((change) => {
                if (change.notified.includes('menu-model')) notified++;
            });
            expect(state.setMenuModel(['Save as…'])).toBe(true);
            // A DIFFERENT array with the same content, which is what every renderer
            // hands over on a re-render.
            expect(state.setMenuModel(['Save as…'])).toBe(false);
            expect(state.setMenuModel(state.menuModel)).toBe(false);
            expect(notified).toBe(1);
        });
    });
};
