// Sidebar behaviour specs — driven by the shared conformance vectors, so this
// suite and the two renderer suites assert the SAME table.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_SIDEBAR_NO_SELECTION,
    SidebarState,
    adjustSidebarSelection,
    clampSidebarSelection,
    flattenSidebarItems,
    sidebarHeaders,
    type AdwSidebarSectionSpec,
    type SidebarSelectionChange,
} from './sidebar.js';
import {
    SIDEBAR_ACTIVATION_VECTORS,
    SIDEBAR_CLAMP_VECTORS,
    SIDEBAR_FILTER_VECTORS,
    SIDEBAR_ITEMS_CHANGED_VECTORS,
    SIDEBAR_ITEM_FLAG_VECTORS,
    SIDEBAR_MODEL_VECTORS,
    SIDEBAR_MODE_VECTORS,
} from './conformance/sidebar.js';

/** A state seeded with `sections`, plus the changes it emits from then on. */
function seeded(sections: readonly AdwSidebarSectionSpec[]): {
    state: SidebarState;
    changes: SidebarSelectionChange[];
} {
    const state = new SidebarState();
    state.setSections(sections);
    const changes: SidebarSelectionChange[] = [];
    state.subscribe((change) => changes.push(change));
    return { state, changes };
}

export default async () => {
    await describe('clampSidebarSelection (adw_sidebar_set_selected bounds)', async () => {
        for (const { index, count, selected, rule } of SIDEBAR_CLAMP_VECTORS) {
            await it(`selected=${index} on ${count} items → ${selected} — ${rule}`, () => {
                expect(clampSidebarSelection(index, count)).toBe(selected);
            });
        }

        await it('never returns the nearest in-range index', () => {
            // The regression that motivated the lift: the web port answered 2 here.
            expect(clampSidebarSelection(5, 3)).toBe(ADW_SIDEBAR_NO_SELECTION);
        });
    });

    await describe('adjustSidebarSelection (items_changed_cb)', async () => {
        for (const vector of SIDEBAR_ITEMS_CHANGED_VECTORS) {
            const { selected, oldCount, newCount, position, removed, added, expected, rule } = vector;
            await it(`${selected} + splice(${position}, -${removed}, +${added}) → ${expected} — ${rule}`, () => {
                expect(adjustSidebarSelection(selected, oldCount, newCount, position, removed, added)).toBe(expected);
            });
        }
    });

    await describe('flattenSidebarItems / sidebarHeaders (flat index space + headers)', async () => {
        for (const vector of SIDEBAR_MODEL_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const { items, sectionFirstIndex } = flattenSidebarItems(vector.sections);

                expect(sectionFirstIndex).toStrictEqual([...vector.sectionFirstIndex]);
                expect(items).toHaveLength(vector.count);
                expect(
                    items.map((entry) => ({
                        index: entry.index,
                        sectionIndex: entry.sectionIndex,
                        sectionItemIndex: entry.sectionItemIndex,
                        title: entry.item.title,
                    })),
                ).toStrictEqual([...vector.flat]);
                expect(sidebarHeaders(vector.sections)).toStrictEqual([...vector.headers]);
            });
        }

        await it('keeps the item object identity so selectedItem === the declared spec', () => {
            const spec = { title: 'Inbox' };
            const state = new SidebarState();
            state.setSections([{ items: [spec] }]);
            expect(state.selectedItem).toBe(spec);
        });
    });

    await describe('SidebarFlatItem label visibility (string_is_not_empty bindings)', async () => {
        for (const vector of SIDEBAR_ITEM_FLAG_VECTORS) {
            await it(`${JSON.stringify(vector.item)} — ${vector.rule}`, () => {
                const { items } = flattenSidebarItems([{ items: [vector.item] }]);
                const flat = items[0]!;
                expect(flat.titleVisible).toBe(vector.titleVisible);
                expect(flat.subtitleVisible).toBe(vector.subtitleVisible);
                expect(flat.iconVisible).toBe(vector.iconVisible);
            });
        }
    });

    await describe('SidebarState.activate (row-selected then row-activated)', async () => {
        for (const vector of SIDEBAR_ACTIVATION_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const state = new SidebarState();
                state.setSections(vector.sections);
                state.setSelected(vector.initialSelected);

                const changes: SidebarSelectionChange[] = [];
                state.subscribe((change) => changes.push(change));

                expect(state.activate(vector.activate)).toStrictEqual({
                    index: vector.activate,
                    activated: vector.activated,
                    selectionChanged: vector.selectionChanged,
                });
                expect(state.selected).toBe(vector.selected);
                expect(changes).toHaveLength(vector.selectionChanged ? 1 : 0);
                if (vector.selectionChanged) expect(changes[0]!.interactive).toBe(true);
            });
        }

        await it('emits the change BEFORE activate() returns', () => {
            const { state, changes } = seeded([{ items: [{ title: 'A' }, { title: 'B' }] }]);
            let selectedAtEmit = -2;
            state.subscribe(() => {
                selectedAtEmit = state.selected;
            });
            state.activate(1);
            expect(changes).toHaveLength(1);
            expect(selectedAtEmit).toBe(1);
        });
    });

    await describe('SidebarState.setFilter (GtkFilterListModel + update_placeholder)', async () => {
        for (const vector of SIDEBAR_FILTER_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const state = new SidebarState();
                state.setSections(vector.sections);
                state.setFilter((item) => vector.keepTitles.includes(item.title));

                expect(state.count).toBe(vector.count);
                expect(state.visibleItems.map((entry) => entry.index)).toStrictEqual([...vector.visibleIndices]);
                expect(state.headers).toStrictEqual([...vector.headers]);
                expect(state.isEmpty).toBe(vector.isEmpty);
            });
        }

        await it('leaves a selected-but-filtered-out item selected, silently', () => {
            const { state, changes } = seeded([{ items: [{ title: 'A' }, { title: 'B' }] }]);
            state.setSelected(1);
            changes.length = 0;

            state.setFilter((item) => item.title === 'A');
            expect(state.selected).toBe(1);
            expect(state.selectedItem?.title).toBe('B');
            expect(changes).toHaveLength(0);
        });
    });

    await describe('SidebarState.setMode (adw_sidebar_set_mode)', async () => {
        for (const { mode, selectionVisible, rule } of SIDEBAR_MODE_VECTORS) {
            await it(`${mode} → selectionVisible ${selectionVisible} — ${rule}`, () => {
                const state = new SidebarState();
                state.setMode(mode);
                expect(state.mode).toBe(mode);
                expect(state.selectionVisible).toBe(selectionVisible);
            });
        }

        await it('is idempotent and never touches the selection', () => {
            const { state, changes } = seeded([{ items: [{ title: 'A' }, { title: 'B' }] }]);
            state.setSelected(1);
            changes.length = 0;

            expect(state.setMode('page')).toBe(true);
            expect(state.setMode('page')).toBe(false);
            expect(state.selected).toBe(1);
            state.setMode('sidebar');
            expect(state.selected).toBe(1);
            expect(changes).toHaveLength(0);
        });
    });

    await describe('SidebarState selection lifecycle', async () => {
        await it('starts with no selection on an empty sidebar', () => {
            const state = new SidebarState();
            expect(state.selected).toBe(ADW_SIDEBAR_NO_SELECTION);
            expect(state.selectedItem).toBeUndefined();
            expect(state.count).toBe(0);
            expect(state.isEmpty).toBe(true);
            expect(state.mode).toBe('sidebar');
        });

        await it('auto-selects index 0 the first time items appear, and notifies', () => {
            const state = new SidebarState();
            const changes: SidebarSelectionChange[] = [];
            state.subscribe((change) => changes.push(change));

            state.setSections([{ items: [{ title: 'A' }, { title: 'B' }] }]);
            expect(changes).toStrictEqual([
                { selected: 0, previous: ADW_SIDEBAR_NO_SELECTION, item: { title: 'A' }, interactive: false },
            ]);
        });

        await it('clears the selection when it is set out of range', () => {
            const { state, changes } = seeded([{ items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }]);
            expect(state.setSelected(5)).toBe(true);
            expect(state.selected).toBe(ADW_SIDEBAR_NO_SELECTION);
            expect(state.selectedItem).toBeUndefined();
            expect(changes).toStrictEqual([
                { selected: ADW_SIDEBAR_NO_SELECTION, previous: 0, item: undefined, interactive: false },
            ]);
        });

        await it('is a silent no-op when the index does not move', () => {
            const { state, changes } = seeded([{ items: [{ title: 'A' }] }]);
            expect(state.setSelected(0)).toBe(false);
            expect(changes).toHaveLength(0);
        });

        await it('stops notifying an unsubscribed listener', () => {
            const state = new SidebarState();
            state.setSections([{ items: [{ title: 'A' }, { title: 'B' }] }]);
            const changes: SidebarSelectionChange[] = [];
            const unsubscribe = state.subscribe((change) => changes.push(change));

            state.setSelected(1);
            unsubscribe();
            state.setSelected(0);
            expect(changes).toHaveLength(1);
        });
    });

    await describe('SidebarState section mutation (adw_sidebar_insert / remove / remove_all)', async () => {
        const twoSections = [{ items: [{ title: 'a' }] }, { items: [{ title: 'b' }, { title: 'c' }] }];

        await it('appends for a negative position, and for one at or past the end', () => {
            const state = new SidebarState();
            state.setSections(twoSections);
            expect(state.insertSection({ items: [] }, -1)).toBe(2);
            expect(state.insertSection({ items: [] }, 9)).toBe(3);
            // `position >= len` takes the append branch, so this is NOT an insert at 4.
            expect(state.insertSection({ items: [] }, 4)).toBe(4);
        });

        await it('shifts the selection when a section is inserted above it', () => {
            const { state, changes } = seeded(twoSections);
            state.setSelected(1);
            changes.length = 0;

            expect(state.insertSection({ items: [{ title: 'x' }, { title: 'y' }, { title: 'z' }] }, 0)).toBe(0);
            expect(state.selected).toBe(4);
            expect(state.selectedItem?.title).toBe('b');
            expect(changes).toStrictEqual([{ selected: 4, previous: 1, item: { title: 'b' }, interactive: false }]);
        });

        await it('shifts the selection when a section above it is removed', () => {
            const { state } = seeded(twoSections);
            state.setSelected(2);
            expect(state.removeSectionAt(0)).toBe(true);
            expect(state.selected).toBe(1);
            expect(state.selectedItem?.title).toBe('c');
        });

        await it('clears the selection when the section holding it is removed', () => {
            const { state } = seeded(twoSections);
            state.setSelected(0);
            expect(state.removeSectionAt(0)).toBe(true);
            expect(state.selected).toBe(ADW_SIDEBAR_NO_SELECTION);
            expect(state.selectedItem).toBeUndefined();
        });

        await it('reports an out-of-range section index instead of touching anything', () => {
            const { state, changes } = seeded(twoSections);
            expect(state.sectionAt(2)).toBeUndefined();
            expect(state.removeSectionAt(2)).toBe(false);
            expect(state.removeSectionAt(-1)).toBe(false);
            expect(changes).toHaveLength(0);
        });

        await it('clears the selection when every section goes away', () => {
            const { state, changes } = seeded([{ items: [{ title: 'A' }, { title: 'B' }] }]);
            state.setSelected(1);
            changes.length = 0;

            state.removeAllSections();
            expect(state.count).toBe(0);
            expect(state.selected).toBe(ADW_SIDEBAR_NO_SELECTION);
            expect(state.isEmpty).toBe(true);
            expect(changes).toStrictEqual([
                { selected: ADW_SIDEBAR_NO_SELECTION, previous: 1, item: undefined, interactive: false },
            ]);
        });

        await it('replacing the sections re-runs the 0 → n auto-select, once', () => {
            const { state, changes } = seeded([{ items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }]);
            state.setSelected(1);
            changes.length = 0;

            state.setSections([{ items: [{ title: 'X' }, { title: 'Y' }] }]);
            expect(state.selected).toBe(0);
            expect(changes).toStrictEqual([{ selected: 0, previous: 1, item: { title: 'X' }, interactive: false }]);
        });

        await it('returns undefined for an item index that addresses no row', () => {
            const { state } = seeded([{ items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }]);
            expect(state.itemAt(3)).toBeUndefined();
            expect(state.itemAt(-1)).toBeUndefined();
            expect(state.itemAt(1.5)).toBeUndefined();
            expect(state.itemAt(1)?.title).toBe('B');
        });
    });

    await describe('SidebarState.refresh (live item property bindings)', async () => {
        await it('re-derives the label flags without moving or notifying the selection', () => {
            const item = { title: 'A', iconName: '' };
            const { state, changes } = seeded([{ items: [item, { title: 'B' }] }]);
            state.setSelected(1);
            changes.length = 0;

            item.iconName = 'folder-symbolic';
            state.refresh();

            expect(state.items[0]!.iconVisible).toBe(true);
            expect(state.selected).toBe(1);
            expect(changes).toHaveLength(0);
        });
    });
};
