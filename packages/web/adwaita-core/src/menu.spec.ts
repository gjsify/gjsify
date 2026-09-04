// Portable menu-model specs — driven by the shared conformance vectors, so this suite
// and the renderer suites assert the SAME tables.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_MENU_SURFACE_NATIVESCRIPT,
    ADW_MENU_SURFACE_WEB,
    assertMenuRenderable,
    flattenMenu,
    menuItemAt,
    menuNodeAt,
    menuRefusals,
    normalizeMenuModel,
    parseDetailedAction,
    parseMenuModel,
    resolveMenuItemState,
} from './menu.js';
import {
    MENU_DETAILED_ACTION_VECTORS,
    MENU_FLATTEN_VECTORS,
    MENU_ITEM_STATE_VECTORS,
    MENU_NORMALIZE_VECTORS,
    MENU_PARSE_VECTORS,
    MENU_REFUSAL_VECTORS,
} from './conformance/menu.js';

export default async () => {
    await describe('normalizeMenuModel (ADR 0042 conformance vectors)', async () => {
        for (const { input, model, rule } of MENU_NORMALIZE_VECTORS) {
            await it(rule, () => {
                expect(normalizeMenuModel(input)).toStrictEqual([...model]);
            });
        }

        await it('is idempotent over every vector, which is what lets a widget be handed its own model', () => {
            for (const { input } of MENU_NORMALIZE_VECTORS) {
                const once = normalizeMenuModel(input);
                expect(normalizeMenuModel(once)).toStrictEqual([...once]);
            }
        });

        await it('a non-array is no menu rather than a throw', () => {
            expect(normalizeMenuModel(null)).toStrictEqual([]);
            expect(normalizeMenuModel(undefined)).toStrictEqual([]);
            expect(normalizeMenuModel('Save' as unknown as string[])).toStrictEqual([]);
        });
    });

    await describe('parseMenuModel (ADR 0042 conformance vectors)', async () => {
        for (const { json, model, rule } of MENU_PARSE_VECTORS) {
            await it(`${JSON.stringify(json)} — ${rule}`, () => {
                expect(parseMenuModel(json)).toStrictEqual([...model]);
            });
        }
    });

    await describe('flattenMenu (ADR 0042 conformance vectors)', async () => {
        for (const { model, rows, rule } of MENU_FLATTEN_VECTORS) {
            await it(rule, () => {
                const flat = flattenMenu(model).map((row) => ({
                    label: row.node.label,
                    path: [...row.path],
                    separated: row.separated,
                }));
                expect(flat).toStrictEqual(rows.map((row) => ({ ...row, path: [...row.path] })));
            });
        }

        await it('every flattened row addresses the node it came from', () => {
            for (const { model } of MENU_FLATTEN_VECTORS) {
                for (const row of flattenMenu(model)) {
                    expect(menuNodeAt(model, row.path)).toBe(row.node);
                }
            }
        });
    });

    await describe('menuNodeAt / menuItemAt', async () => {
        const model = normalizeMenuModel([
            { label: 'New' },
            { section: [{ label: 'Cut' }] },
            { label: 'More', submenu: [{ label: 'Rename' }] },
        ]);

        await it('the empty path names the model, not a node', () => {
            expect(menuNodeAt(model, [])).toBe(null);
        });

        await it('descends links, so a nested item has a name', () => {
            expect(menuItemAt(model, [2, 0])).toStrictEqual({ kind: 'item', label: 'Rename' });
            expect(menuItemAt(model, [1, 0])).toStrictEqual({ kind: 'item', label: 'Cut' });
        });

        await it('a section or a submenu is a node but not an item', () => {
            expect(menuNodeAt(model, [1])?.kind).toBe('section');
            expect(menuItemAt(model, [1])).toBe(null);
            expect(menuItemAt(model, [2])).toBe(null);
        });

        await it('an item has nothing to descend into', () => {
            expect(menuNodeAt(model, [0, 0])).toBe(null);
        });
    });

    await describe('parseDetailedAction (ADR 0042 conformance vectors)', async () => {
        for (const { detailed, name, target, rule } of MENU_DETAILED_ACTION_VECTORS) {
            await it(`${detailed} — ${rule}`, () => {
                const parsed = parseDetailedAction(detailed);
                expect(parsed?.name).toBe(name);
                expect(parsed?.target).toBe(target);
            });
        }

        await it('never throws, for any row — it runs on the display side of an accepted menu', () => {
            // The other half of the same table is `gioValid`, driven by
            // `@gjsify/gtk-host`'s menu suite: GIO is the authority on legality, this
            // function is only the splitter. Asserting the totality HERE is what keeps
            // the two halves from being read as one claim.
            for (const { detailed } of MENU_DETAILED_ACTION_VECTORS) {
                expect(typeof parseDetailedAction(detailed)?.name).toBe('string');
            }
        });

        await it('the two spellings of one string target agree, so a radio can match either', () => {
            expect(parseDetailedAction("app.view('list')")?.target).toBe(parseDetailedAction('app.view::list')?.target);
        });

        await it('no action is not an action', () => {
            expect(parseDetailedAction(undefined)).toBe(null);
            expect(parseDetailedAction('')).toBe(null);
        });
    });

    await describe('resolveMenuItemState — enabled/checked come from the ACTION', async () => {
        for (const { item, actions, state, rule } of MENU_ITEM_STATE_VECTORS) {
            await it(rule, () => {
                expect(resolveMenuItemState(item, actions)).toStrictEqual({ ...state });
            });
        }

        await it('NO action group is not an EMPTY one — nothing is known, so nothing is dimmed', () => {
            // The distinction the browser renderer needs: `{}` is a group that knows the
            // action is missing, `undefined` is a surface that has no group to ask. With
            // the two collapsed, every actioned item in a menu whose host dispatches its
            // own actions arrived `disabled` — measured, on the split button's own suite.
            const live = { kind: 'item', label: 'Quit', action: 'app.quit' } as const;
            expect(resolveMenuItemState(live)).toStrictEqual({
                sensitive: true,
                toggled: false,
                role: 'normal',
                visible: true,
            });
            expect(resolveMenuItemState(live, {}).sensitive).toBe(false);
        });

        await it('with no action group, hidden-when="action-missing" hides nothing', () => {
            const item = { kind: 'item', label: 'Ghost', action: 'app.x', hiddenWhen: 'action-missing' } as const;
            expect(resolveMenuItemState(item).visible).toBe(true);
            expect(resolveMenuItemState(item, {}).visible).toBe(false);
        });

        await it('an actionless item is sensitive whether or not a group was given', () => {
            const heading = { kind: 'item', label: 'Heading' } as const;
            expect(resolveMenuItemState(heading).sensitive).toBe(true);
            expect(resolveMenuItemState(heading, {}).sensitive).toBe(true);
        });
    });

    await describe('menuRefusals / assertMenuRenderable (ADR 0042 conformance vectors)', async () => {
        for (const { model, paths, rule } of MENU_REFUSAL_VECTORS) {
            await it(`web + nativescript: ${rule}`, () => {
                for (const surface of [ADW_MENU_SURFACE_WEB, ADW_MENU_SURFACE_NATIVESCRIPT]) {
                    const refused = menuRefusals(model, surface).map((r) => [...r.path]);
                    expect(refused).toStrictEqual(paths.map((p) => [...p]));
                    if (paths.length === 0) assertMenuRenderable(model, surface);
                    else expect(() => assertMenuRenderable(model, surface)).toThrow(surface.name);
                }
            });

            await it(`a surface that CAN host a custom child refuses nothing: ${rule}`, () => {
                // Built inline rather than imported: GTK refuses nothing, so a published
                // `ADW_MENU_SURFACE_GTK` would carry an arm no caller can reach. The
                // literal is the assertion's own input, which is what a surface record
                // with `custom: true` is for.
                const gtk = { name: 'gtk', custom: true } as const;
                expect(menuRefusals(model, gtk)).toStrictEqual([]);
                assertMenuRenderable(model, gtk);
            });
        }

        await it('the throw names EVERY refusal, not the first', () => {
            const model = normalizeMenuModel([
                { label: 'A', custom: 'one' },
                { label: 'B', custom: 'two' },
            ]);
            expect(() => assertMenuRenderable(model, ADW_MENU_SURFACE_WEB)).toThrow('one');
            expect(() => assertMenuRenderable(model, ADW_MENU_SURFACE_WEB)).toThrow('two');
        });
    });
};
