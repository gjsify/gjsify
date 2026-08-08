// AdwSidebar conformance tests for the NativeScript renderer, driven by the SAME
// vectors the browser renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// IMPORTANT: this suite must NOT import `./widgets/adw-sidebar.js`. That module
// `extends ScrollView`, which evaluates the bare `@nativescript/core` specifier
// at module-eval and is unresolvable on GJS/Node. It imports the widget's PURE
// half instead — `./widgets/sidebar-model.js`, which carries type-only NS
// imports — so what runs here is the REAL code the widget runs, not a mirror of
// it. (A spec that transcribes its subject cannot detect the drift it exists to
// catch; the avatar lift deleted one of those.)
//
// What used to be here: nothing. The NativeScript sidebar carried a re-typed
// copy of `ToggleGroupState`, so setting an out-of-range index was silently
// dropped, a fractional index was stored verbatim and highlighted no row, an
// empty sidebar reported selection 0, and there was no `activated` signal at all
// — making the documented split-view reveal gesture impossible on this renderer.
import { describe, expect, it } from '@gjsify/unit';

import { adjustSidebarSelection } from '@gjsify/adwaita-core';
import {
    SIDEBAR_ACTIVATION_VECTORS,
    SIDEBAR_CLAMP_VECTORS,
    SIDEBAR_FILTER_VECTORS,
    SIDEBAR_ITEMS_CHANGED_VECTORS,
    SIDEBAR_MODEL_VECTORS,
    SIDEBAR_MODE_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import { SidebarState, sidebarRowClassName, sidebarSectionsFromLabels } from './widgets/sidebar-model.js';
import type { AdwSidebarSectionSpec } from './widgets/sidebar-model.js';

/**
 * The rows `AdwSidebar._rebuild` + `_applySelection` would put on screen: one
 * class string per rendered row, in render order. This is the widget's whole
 * visual output for a given state, minus the NS view construction.
 */
function renderedRowClasses(state: SidebarState): string[] {
    return state.visibleItems.map((flat) => sidebarRowClassName(flat.index === state.selected, state.selectionVisible));
}

/** A state seeded the way `setItems(labels)` seeds it. */
function fromLabels(labels: readonly string[]): SidebarState {
    const state = new SidebarState();
    state.setSections(sidebarSectionsFromLabels(labels));
    return state;
}

function seeded(sections: readonly AdwSidebarSectionSpec[]): SidebarState {
    const state = new SidebarState();
    state.setSections(sections);
    return state;
}

export const AdwSidebarNsTest = async () => {
    await describe('AdwSidebar.setItems → the flat section model', async () => {
        await it('turns a label list into one untitled, header-less section', () => {
            const sections = sidebarSectionsFromLabels(['Inbox', 'Starred', 'Sent']);
            expect(sections).toHaveLength(1);
            expect(sections[0]!.title).toBeUndefined();
            expect(sections[0]!.items.map((item) => item.title)).toStrictEqual(['Inbox', 'Starred', 'Sent']);

            const state = fromLabels(['Inbox', 'Starred', 'Sent']);
            expect(state.count).toBe(3);
            expect(state.headers).toHaveLength(0);
            expect(state.selected).toBe(0);
        });

        await it('reports NO selection for an empty sidebar, not 0', () => {
            // The old widget initialised `_selected = 0` and reset to 0 whenever
            // the list shrank, so an empty sidebar claimed to have row 0 selected.
            const state = fromLabels([]);
            expect(state.count).toBe(0);
            expect(state.selected).toBe(-1);
            expect(state.selectedItem).toBeUndefined();
            expect(state.isEmpty).toBe(true);
        });
    });

    await describe('AdwSidebar.selected bounds (libadwaita conformance vectors)', async () => {
        for (const { index, count, selected, rule } of SIDEBAR_CLAMP_VECTORS) {
            await it(`selected = ${index} on ${count} rows → ${selected} — ${rule}`, () => {
                const state = fromLabels(Array.from({ length: count }, (_, i) => `Item ${i}`));
                state.setSelected(index);

                expect(state.selected).toBe(selected);
                expect(renderedRowClasses(state).filter((cls) => cls.includes('active'))).toHaveLength(
                    selected === -1 ? 0 : 1,
                );
            });
        }

        await it('highlights exactly the selected row', () => {
            const state = fromLabels(['A', 'B', 'C']);
            state.setSelected(1);
            expect(renderedRowClasses(state)).toStrictEqual([
                'adw-sidebar-row',
                'adw-sidebar-row active',
                'adw-sidebar-row',
            ]);
        });

        await it('emits notify::selected for a programmatic set too', () => {
            // The old setter was the ONLY notify path, so a model change that
            // moved the selection was silent.
            const state = fromLabels(['A', 'B']);
            const seen: { selected: number; interactive: boolean }[] = [];
            state.subscribe((change) => seen.push({ selected: change.selected, interactive: change.interactive }));

            state.setSelected(1);
            expect(seen).toStrictEqual([{ selected: 1, interactive: false }]);
        });
    });

    await describe('AdwSidebar activation (libadwaita conformance vectors)', async () => {
        for (const vector of SIDEBAR_ACTIVATION_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const state = seeded(vector.sections);
                state.setSelected(vector.initialSelected);

                const notifications: number[] = [];
                state.subscribe((change) => notifications.push(change.selected));

                const result = state.activate(vector.activate);
                expect(result.activated).toBe(vector.activated);
                expect(result.selectionChanged).toBe(vector.selectionChanged);
                expect(state.selected).toBe(vector.selected);
                expect(notifications).toHaveLength(vector.selectionChanged ? 1 : 0);
            });
        }

        await it('re-tapping the selected row still activates — the split-view reveal', () => {
            const state = fromLabels(['A', 'B']);
            state.setSelected(1);

            const first = state.activate(1);
            expect(first.activated).toBe(true);
            expect(first.selectionChanged).toBe(false);
            expect(state.selected).toBe(1);
        });

        await it('tags a tap as interactive', () => {
            const state = fromLabels(['A', 'B']);
            const flags: boolean[] = [];
            state.subscribe((change) => flags.push(change.interactive));

            state.activate(1);
            state.setSelected(0);
            expect(flags).toStrictEqual([true, false]);
        });
    });

    await describe('AdwSidebar section model (libadwaita conformance vectors)', async () => {
        for (const vector of SIDEBAR_MODEL_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const state = seeded(vector.sections);

                expect(state.count).toBe(vector.count);
                expect(state.visibleItems.map((flat) => flat.index)).toStrictEqual(
                    vector.flat.map((entry) => entry.index),
                );
                expect(state.visibleItems.map((flat) => flat.item.title)).toStrictEqual(
                    vector.flat.map((entry) => entry.title),
                );
                expect(vector.sections.map((_, i) => state.sectionFirstIndex(i))).toStrictEqual([
                    ...vector.sectionFirstIndex,
                ]);
                expect(state.headers).toStrictEqual([...vector.headers]);
            });
        }
    });

    await describe('AdwSidebar model changes (items_changed_cb)', async () => {
        for (const vector of SIDEBAR_ITEMS_CHANGED_VECTORS) {
            const { selected, oldCount, newCount, position, removed, added, expected, rule } = vector;
            await it(`${selected} + splice(${position}, -${removed}, +${added}) → ${expected} — ${rule}`, () => {
                expect(adjustSidebarSelection(selected, oldCount, newCount, position, removed, added)).toBe(expected);
            });
        }

        await it('shifts the selection when a section is inserted above it', () => {
            // The old widget only ever reset to 0 when the list got shorter: it
            // never shifted, never cleared, and never notified.
            const state = seeded([{ items: [{ title: 'a' }] }, { items: [{ title: 'b' }, { title: 'c' }] }]);
            state.setSelected(1);

            state.insertSection({ items: [{ title: 'x' }, { title: 'y' }] }, 0);
            expect(state.selected).toBe(3);
            expect(state.selectedItem?.title).toBe('b');
        });

        await it('clears the selection when the section holding it is removed', () => {
            const state = seeded([{ items: [{ title: 'a' }] }, { items: [{ title: 'b' }] }]);
            state.setSelected(0);

            expect(state.removeSectionAt(0)).toBe(true);
            expect(state.selected).toBe(-1);
        });
    });

    await describe('AdwSidebar filter + empty state (libadwaita conformance vectors)', async () => {
        for (const vector of SIDEBAR_FILTER_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const state = seeded(vector.sections);
                state.setFilter((item) => vector.keepTitles.includes(item.title));

                expect(state.count).toBe(vector.count);
                expect(state.visibleItems.map((flat) => flat.index)).toStrictEqual([...vector.visibleIndices]);
                expect(renderedRowClasses(state)).toHaveLength(vector.visibleIndices.length);
                expect(state.isEmpty).toBe(vector.isEmpty);
            });
        }
    });

    await describe('AdwSidebar mode (libadwaita conformance vectors)', async () => {
        for (const { mode, selectionVisible, rule } of SIDEBAR_MODE_VECTORS) {
            await it(`${mode} paints the selection: ${selectionVisible} — ${rule}`, () => {
                const state = fromLabels(['A', 'B', 'C']);
                state.setMode(mode);
                state.setSelected(1);

                expect(state.selectionVisible).toBe(selectionVisible);
                expect(renderedRowClasses(state)[1]).toBe(
                    selectionVisible ? 'adw-sidebar-row active' : 'adw-sidebar-row',
                );
                // Tracked either way, so switching back restores the highlight.
                expect(state.selected).toBe(1);
            });
        }

        await it('restores the highlight when page mode is left again', () => {
            const state = fromLabels(['A', 'B']);
            state.setSelected(1);
            state.setMode('page');
            expect(renderedRowClasses(state)[1]).toBe('adw-sidebar-row');

            state.setMode('sidebar');
            expect(renderedRowClasses(state)[1]).toBe('adw-sidebar-row active');
        });
    });
};
