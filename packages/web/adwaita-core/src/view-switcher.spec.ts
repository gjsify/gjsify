// View-switcher specs — driven by the shared conformance vectors, so this suite
// and the two renderer suites assert the SAME tables.

import { describe, expect, it } from '@gjsify/unit';

import {
    DEFAULT_INDICATOR_DESCRIPTION_STRINGS,
    INLINE_VIEW_SWITCHER_DISPLAY_MODES,
    VIEW_SWITCHER_DRAG_SWITCH_DELAY,
    VIEW_SWITCHER_FALLBACK_ICON,
    VIEW_SWITCHER_NO_SELECTION,
    VIEW_SWITCHER_POLICIES,
    ViewSwitcherBarState,
    ViewSwitcherDragSwitch,
    ViewSwitcherState,
    buildInlineToggles,
    buildViewSwitcherButtons,
    createViewSwitcherPage,
    inlineToggleTooltip,
    isInlineViewSwitcherDisplayMode,
    isViewSwitcherButtonVisible,
    isViewSwitcherPolicy,
    pageIndexForToggle,
    shouldRevealViewSwitcherBar,
    stripMnemonic,
    toggleIndexForPage,
    viewSwitcherBadgeLabel,
    viewSwitcherButtonOrientation,
    viewSwitcherIconName,
    viewSwitcherIndicatorDescription,
    viewSwitcherLabel,
    viewSwitcherPagesFromStack,
} from './view-switcher.js';
import type { AdwViewSwitcherPage } from './view-switcher.js';
import { ViewStackState } from './view-stack.js';
import {
    INLINE_TOOLTIP_VECTORS,
    INLINE_TOGGLE_VECTORS,
    VIEW_SWITCHER_BADGE_VECTORS,
    VIEW_SWITCHER_BAR_REVEAL_VECTORS,
    VIEW_SWITCHER_BAR_VECTORS,
    VIEW_SWITCHER_BUTTON_VECTORS,
    VIEW_SWITCHER_BUTTON_VISIBILITY_VECTORS,
    VIEW_SWITCHER_DRAG_VECTORS,
    VIEW_SWITCHER_ICON_VECTORS,
    VIEW_SWITCHER_MNEMONIC_VECTORS,
    VIEW_SWITCHER_REBUILD_VECTORS,
    VIEW_SWITCHER_SELECTION_VECTORS,
    createViewSwitcherClock,
} from './conformance/view-switcher.js';
import type { ViewSwitcherVectorChange, ViewSwitcherVectorOp } from './conformance/view-switcher.js';

/** Apply one selection-vector op through the state's public surface. */
function applyOp(state: ViewSwitcherState, op: ViewSwitcherVectorOp): boolean {
    switch (op.kind) {
        case 'selectIndex':
            return state.setSelected(op.index);
        case 'selectName':
            return state.selectName(op.name);
        case 'setPageVisible':
            return state.setPageVisible(op.name, op.visible);
    }
}

export default async () => {
    await describe('stripMnemonic (adw_strip_mnemonic)', async () => {
        for (const { label, stripped, rule } of VIEW_SWITCHER_MNEMONIC_VECTORS) {
            await it(`${JSON.stringify(label)} → ${JSON.stringify(stripped)} — ${rule}`, () => {
                expect(stripMnemonic(label)).toBe(stripped);
            });
        }

        await it('reads code points, so an astral character next to a marker survives', () => {
            // A UTF-16-unit loop would split the surrogate pair when it skipped
            // the marker before it.
            expect(stripMnemonic('_\u{1D49C}da')).toBe('\u{1D49C}da');
            expect([...stripMnemonic('_\u{1D49C}')]).toHaveLength(1);
        });
    });

    await describe('viewSwitcherIconName (image-missing fallback)', async () => {
        for (const { iconName, resolved, rule } of VIEW_SWITCHER_ICON_VECTORS) {
            await it(`${JSON.stringify(iconName)} → ${JSON.stringify(resolved)} — ${rule}`, () => {
                expect(viewSwitcherIconName(iconName)).toBe(resolved);
            });
        }

        await it('never returns the empty string, so a renderer always has something to paint', () => {
            for (const { iconName } of VIEW_SWITCHER_ICON_VECTORS) {
                expect(viewSwitcherIconName(iconName).length > 0).toBe(true);
            }
            expect(viewSwitcherIconName(null)).toBe(VIEW_SWITCHER_FALLBACK_ICON);
        });
    });

    await describe('isViewSwitcherButtonVisible (adw-view-switcher.c:178)', async () => {
        for (const vector of VIEW_SWITCHER_BUTTON_VISIBILITY_VECTORS) {
            await it(vector.rule, () => {
                expect(
                    isViewSwitcherButtonVisible({
                        visible: vector.visible,
                        title: vector.title,
                        iconName: vector.iconName,
                    }),
                ).toBe(vector.buttonVisible);
            });
        }

        await it('reads an ABSENT property as NULL, so a partial page still decides correctly', () => {
            // `createViewSwitcherPage` applies the C defaults, both of which are NULL.
            expect(isViewSwitcherButtonVisible(createViewSwitcherPage({ name: 'a' }))).toBe(false);
            expect(isViewSwitcherButtonVisible(createViewSwitcherPage({ name: 'a', title: '' }))).toBe(true);
        });
    });

    await describe('viewSwitcherBadgeLabel + viewSwitcherIndicatorDescription (AdwIndicatorBin)', async () => {
        for (const vector of VIEW_SWITCHER_BADGE_VECTORS) {
            await it(`badge ${vector.badgeNumber}, attention ${vector.needsAttention} — ${vector.rule}`, () => {
                expect(viewSwitcherBadgeLabel(vector.badgeNumber)).toBe(vector.badgeLabel);
                expect(viewSwitcherIndicatorDescription(vector.needsAttention, vector.badgeNumber)).toBe(
                    vector.description,
                );
            });
        }

        await it('puts the BADGE clause first — the C format is "%s %s", badge, attention', () => {
            const description = viewSwitcherIndicatorDescription(true, 7);
            expect(description.indexOf('badge') < description.indexOf('Attention')).toBe(true);
        });

        await it('takes an injected catalogue, so a renderer can translate without forking the order', () => {
            const localized = viewSwitcherIndicatorDescription(true, 7, {
                attentionRequested: 'Achtung erforderlich.',
                badgeOverflow: 'Hat eine Plakette: mehr als 999.',
                badge: (n) => `Hat eine Plakette: ${n}.`,
            });
            expect(localized).toBe('Hat eine Plakette: 7. Achtung erforderlich.');
            expect(DEFAULT_INDICATOR_DESCRIPTION_STRINGS.badge(7)).toBe('Has a badge: 7.');
        });

        await it('reads a badge that cannot exist in C as no badge at all', () => {
            // `badge-number` is a guint; a negative or fractional value has no C
            // spelling, and wrapping it around G_MAXUINT would invent a "999+".
            expect(viewSwitcherBadgeLabel(-5)).toBe('');
            expect(viewSwitcherBadgeLabel(Number.NaN)).toBe('');
            expect(viewSwitcherBadgeLabel(2.7)).toBe('2');
        });
    });

    await describe('shouldRevealViewSwitcherBar (update_bar_revealed)', async () => {
        for (const vector of VIEW_SWITCHER_BAR_REVEAL_VECTORS) {
            await it(vector.rule, () => {
                expect(shouldRevealViewSwitcherBar(vector.reveal, vector.pages)).toBe(vector.revealed);
            });
        }

        await it('accepts a wave-1 view-stack page list unchanged', () => {
            // The bar binds to an `Adw.ViewStack`, so the shape it can actually
            // feed this must be the stack's own page descriptor.
            const stack = new ViewStackState();
            stack.addPage({ name: 'a' });
            expect(shouldRevealViewSwitcherBar(true, stack.pages)).toBe(false);
            stack.addPage({ name: 'b' });
            expect(shouldRevealViewSwitcherBar(true, stack.pages)).toBe(true);
        });
    });

    await describe('inlineToggleTooltip (update_tooltip)', async () => {
        for (const vector of INLINE_TOOLTIP_VECTORS) {
            await it(`${vector.displayMode}: ${vector.rule}`, () => {
                expect(
                    inlineToggleTooltip({ title: vector.title, useUnderline: vector.useUnderline }, vector.displayMode),
                ).toBe(vector.tooltip);
            });
        }
    });

    await describe('buildViewSwitcherButtons (populate_switcher + update_button)', async () => {
        for (const vector of VIEW_SWITCHER_BUTTON_VECTORS) {
            await it(vector.rule, () => {
                const pages = vector.pages.map((page) => createViewSwitcherPage(page));
                expect(buildViewSwitcherButtons(pages, vector.selected, vector.policy)).toStrictEqual([
                    ...vector.buttons,
                ]);
            });
        }

        await it('keeps a model for EVERY page — the index space is the page one', () => {
            const pages = [
                createViewSwitcherPage({ name: 'a' }),
                createViewSwitcherPage({ name: 'b', title: 'B', visible: false }),
            ];
            const buttons = buildViewSwitcherButtons(pages, 0, 'narrow');
            expect(buttons).toHaveLength(2);
            expect(buttons.map((button) => button.pageIndex)).toStrictEqual([0, 1]);
            expect(buttons.map((button) => button.visible)).toStrictEqual([false, false]);
        });

        await it('derives the orientation from the policy alone', () => {
            expect(viewSwitcherButtonOrientation('wide')).toBe('horizontal');
            expect(viewSwitcherButtonOrientation('narrow')).toBe('vertical');
        });
    });

    await describe('buildInlineToggles + the two index spaces (populate_group)', async () => {
        for (const vector of INLINE_TOGGLE_VECTORS) {
            await it(vector.rule, () => {
                const pages = vector.pages.map((page) => createViewSwitcherPage(page));

                expect(buildInlineToggles(pages, vector.displayMode)).toStrictEqual([...vector.toggles]);
                expect(pages.map((_page, index) => toggleIndexForPage(pages, index))).toStrictEqual([
                    ...vector.toggleIndexByPage,
                ]);
                expect(vector.toggles.map((_toggle, index) => pageIndexForToggle(pages, index))).toStrictEqual([
                    ...vector.pageIndexByToggle,
                ]);
                // One past the last toggle is the sentinel, not a wrap-around.
                expect(pageIndexForToggle(pages, vector.toggles.length)).toBe(VIEW_SWITCHER_NO_SELECTION);
            });
        }

        await it('round-trips every visible page through both mappings', () => {
            const pages = [
                createViewSwitcherPage({ name: 'a' }),
                createViewSwitcherPage({ name: 'b', visible: false }),
                createViewSwitcherPage({ name: 'c' }),
            ];
            for (const [pageIndex, page] of pages.entries()) {
                const toggleIndex = toggleIndexForPage(pages, pageIndex);
                if (!page.visible) {
                    expect(toggleIndex).toBe(VIEW_SWITCHER_NO_SELECTION);
                    continue;
                }
                expect(pageIndexForToggle(pages, toggleIndex)).toBe(pageIndex);
            }
        });

        await it('refuses a fractional or negative index in either direction', () => {
            const pages = [createViewSwitcherPage({ name: 'a' }), createViewSwitcherPage({ name: 'b' })];
            expect(toggleIndexForPage(pages, 1.5)).toBe(VIEW_SWITCHER_NO_SELECTION);
            expect(toggleIndexForPage(pages, -1)).toBe(VIEW_SWITCHER_NO_SELECTION);
            expect(pageIndexForToggle(pages, 1.5)).toBe(VIEW_SWITCHER_NO_SELECTION);
            expect(pageIndexForToggle(pages, -1)).toBe(VIEW_SWITCHER_NO_SELECTION);
        });
    });

    await describe('policy + display-mode enums', async () => {
        await it('rejects an unknown value instead of coercing it to a default', () => {
            // `g_return_if_fail (mode <= ADW_INLINE_VIEW_SWITCHER_BOTH)` REJECTS
            // the call; the browser port replaced the current mode with 'both'.
            expect(isInlineViewSwitcherDisplayMode('bogus')).toBe(false);
            expect(isInlineViewSwitcherDisplayMode('labels')).toBe(true);
            expect(isViewSwitcherPolicy('bogus')).toBe(false);
            expect(isViewSwitcherPolicy('wide')).toBe(true);
        });

        await it('lists every enum member, so a renderer toggles classes from data', () => {
            expect([...VIEW_SWITCHER_POLICIES]).toStrictEqual(['narrow', 'wide']);
            expect([...INLINE_VIEW_SWITCHER_DISPLAY_MODES]).toStrictEqual(['labels', 'icons', 'both']);
            expect(VIEW_SWITCHER_POLICIES.every((policy) => isViewSwitcherPolicy(policy))).toBe(true);
            expect(INLINE_VIEW_SWITCHER_DISPLAY_MODES.every((mode) => isInlineViewSwitcherDisplayMode(mode))).toBe(
                true,
            );
        });
    });

    await describe('ViewSwitcherBarState (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_SWITCHER_BAR_VECTORS) {
            await it(vector.rule, () => {
                const bar = new ViewSwitcherBarState();
                const changes: { reveal: boolean; revealed: boolean }[] = [];
                bar.subscribe((change) => changes.push(change));

                const results: boolean[] = [];
                const states: { reveal: boolean; revealed: boolean }[] = [];
                for (const step of vector.steps) {
                    results.push(step.kind === 'reveal' ? bar.setReveal(step.value) : bar.setPages(step.pages));
                    states.push({ reveal: bar.reveal, revealed: bar.revealed });
                }

                expect(results).toStrictEqual([...vector.stepResults]);
                expect(states).toStrictEqual([...vector.states]);
                expect(changes).toStrictEqual([...vector.changes]);
            });
        }

        await it("starts collapsed, which is where PROP_REVEAL's FALSE default puts it", () => {
            const bar = new ViewSwitcherBarState();
            expect(bar.reveal).toBe(false);
            expect(bar.revealed).toBe(false);
        });
    });

    await describe('ViewSwitcherState selection (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_SWITCHER_SELECTION_VECTORS) {
            await it(vector.rule, () => {
                const state = new ViewSwitcherState();
                const changes: ViewSwitcherVectorChange[] = [];
                state.subscribe((change) => changes.push(change));

                state.setPages(vector.pages);
                expect(changes).toStrictEqual([...vector.setupChanges]);

                changes.length = 0;
                const results = vector.ops.map((op) => applyOp(state, op));

                expect(results).toStrictEqual([...vector.opResults]);
                expect(changes).toStrictEqual([...vector.changes]);
                expect(state.selected).toBe(vector.selected);
                expect(state.selectedName).toBe(vector.selectedName);
                expect(state.selectedPage ? viewSwitcherLabel(state.selectedPage) : '').toBe(vector.selectedTitle);
                expect(state.count).toBe(vector.pages.length);
                if (vector.diagnostics) expect(state.diagnostics).toStrictEqual([...vector.diagnostics]);
            });
        }

        await it('hands out a frozen page list, so a renderer cannot mutate the model', () => {
            const state = new ViewSwitcherState();
            state.setPages([{ name: 'a', title: 'A' }]);
            expect(Object.isFrozen(state.pages)).toBe(true);
        });

        await it('keeps the switcher pages and the delegated stack in step when a page is hidden', () => {
            const state = new ViewSwitcherState();
            state.setPages([
                { name: 'a', title: 'A' },
                { name: 'b', title: 'B' },
            ]);
            state.setPageVisible('b', false);
            // The derived toggle list is what would drift if only one of the two
            // sides had been updated.
            expect(state.pages.map((page) => page.visible)).toStrictEqual([true, false]);
            expect(buildInlineToggles(state.pages, 'labels').map((toggle) => toggle.pageIndex)).toStrictEqual([0]);
            expect(state.setSelected(1)).toBe(false);
        });

        await it('is a no-op for an unknown page name and for a redundant visibility flip', () => {
            const state = new ViewSwitcherState();
            state.setPages([{ name: 'a', title: 'A' }]);
            expect(state.setPageVisible('missing', false)).toBe(false);
            expect(state.setPageVisible('a', true)).toBe(false);
        });
    });

    await describe('ViewSwitcherState.setPages rebuild (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_SWITCHER_REBUILD_VECTORS) {
            await it(vector.rule, () => {
                const state = new ViewSwitcherState();
                state.setPages(vector.pages);
                if (vector.select !== undefined) state.selectName(vector.select);

                const changes: ViewSwitcherVectorChange[] = [];
                state.subscribe((change) => changes.push(change));
                state.setPages(vector.nextPages);

                expect(changes).toStrictEqual([...vector.changes]);
                expect(state.selected).toBe(vector.selected);
                expect(state.selectedName).toBe(vector.selectedName);
            });
        }
    });

    await describe('ViewSwitcherState drag-hover auto-switch (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_SWITCHER_DRAG_VECTORS) {
            await it(vector.rule, () => {
                const clock = createViewSwitcherClock();
                const state = new ViewSwitcherState({ scheduler: clock });
                state.setPages(vector.pages);
                state.setSelected(vector.initial);

                const changes: ViewSwitcherVectorChange[] = [];
                state.subscribe((change) => changes.push(change));

                for (const step of vector.steps) {
                    if (step.kind === 'enter') state.dragEnter(step.index);
                    else if (step.kind === 'leave') state.dragLeave(step.index);
                    else clock.advance(step.ms);
                }

                expect(changes).toStrictEqual([...vector.changes]);
                expect(state.selected).toBe(vector.selected);
            });
        }

        await it('is inert without an injected scheduler — core never reaches for a global timer', () => {
            const state = new ViewSwitcherState();
            state.setPages([
                { name: 'a', title: 'A' },
                { name: 'b', title: 'B' },
            ]);
            state.dragEnter(1);
            expect(state.pendingDragSwitches).toStrictEqual([]);
            expect(state.selected).toBe(0);
        });

        await it('drops pending dwells when the page list is rebuilt under the drag', () => {
            const clock = createViewSwitcherClock();
            const state = new ViewSwitcherState({ scheduler: clock });
            state.setPages([
                { name: 'a', title: 'A' },
                { name: 'b', title: 'B' },
            ]);
            state.dragEnter(1);
            expect(state.pendingDragSwitches).toStrictEqual([1]);

            state.setPages([{ name: 'a', title: 'A' }]);
            clock.advance(VIEW_SWITCHER_DRAG_SWITCH_DELAY);
            // Page 1 no longer exists; a surviving timer would have selected a
            // page that is not there.
            expect(state.pendingDragSwitches).toStrictEqual([]);
            expect(state.selected).toBe(0);
        });

        await it('arms one timer per hovered button, as each C widget owns its own', () => {
            const clock = createViewSwitcherClock();
            const switched: number[] = [];
            const drag = new ViewSwitcherDragSwitch({ scheduler: clock, onSwitch: (index) => switched.push(index) });

            expect(drag.enter(1, 0)).toBe(true);
            expect(drag.enter(2, 0)).toBe(true);
            expect(drag.enter(0, 0)).toBe(false); // already active
            expect(drag.enter(1, 0)).toBe(false); // already armed
            expect(drag.pending).toStrictEqual([1, 2]);

            drag.leave(1);
            expect(drag.pending).toStrictEqual([2]);
            drag.leave(99); // unknown index is a no-op, not a throw
            clock.advance(VIEW_SWITCHER_DRAG_SWITCH_DELAY);
            expect(switched).toStrictEqual([2]);
            expect(clock.pending).toBe(0);
        });
    });

    await describe('viewSwitcherPagesFromStack (a switcher BOUND to an Adw.ViewStack)', async () => {
        await it("maps the stack's empty icon back onto NULL so the fallback applies", () => {
            const stack = new ViewStackState();
            stack.addPage({ name: 'a', title: 'A' });
            stack.addPage({ name: 'b', title: 'B', icon: 'go-next-symbolic' });

            const pages: AdwViewSwitcherPage[] = viewSwitcherPagesFromStack(stack.pages);
            expect(pages.map((page) => page.iconName)).toStrictEqual([null, 'go-next']);
            expect(buildViewSwitcherButtons(pages, 0, 'narrow').map((button) => button.iconName)).toStrictEqual([
                'image-missing',
                'go-next',
            ]);
        });

        await it("carries the stack page's visibility, so a hidden page loses its button", () => {
            const stack = new ViewStackState();
            stack.addPage({ name: 'a', title: 'A' });
            stack.addPage({ name: 'b', title: 'B', visible: false });
            expect(
                viewSwitcherPagesFromStack(stack.pages).map((page) => isViewSwitcherButtonVisible(page)),
            ).toStrictEqual([true, false]);
        });
    });
};
