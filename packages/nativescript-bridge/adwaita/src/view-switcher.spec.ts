// AdwViewSwitcher / AdwInlineViewSwitcher / AdwViewSwitcherBar conformance tests,
// driven by the SAME vectors the core suite and the browser suite assert against
// (`@gjsify/adwaita-core/conformance`).
//
// IMPORTANT: this imports `./widgets/view-switcher-model.js`, NOT the widgets — a widget
// module `extends GridLayout`, which evaluates the bare `@nativescript/core` specifier
// at module-eval. The model module is the whole non-NS-core half the widgets delegate
// to: `setViews` forwards to `state.setPages(viewSwitcherPageSpecs(pages))`, the
// `selected` accessors forward to the same state, `_applySelection` paints
// `buildViewSwitcherButtons(...)` and pushes `applyViewSwitcherVisibility`, and the
// bar's `revealed` is `ViewSwitcherBarState`. Nothing here is a stand-in for any of it.
import { describe, expect, it } from '@gjsify/unit';

import {
    INLINE_TOGGLE_VECTORS,
    INLINE_TOOLTIP_VECTORS,
    VIEW_SWITCHER_BADGE_VECTORS,
    VIEW_SWITCHER_BAR_REVEAL_VECTORS,
    VIEW_SWITCHER_BAR_VECTORS,
    VIEW_SWITCHER_BUTTON_VECTORS,
    VIEW_SWITCHER_BUTTON_VISIBILITY_VECTORS,
    VIEW_SWITCHER_ICON_VECTORS,
    VIEW_SWITCHER_MNEMONIC_VECTORS,
    VIEW_SWITCHER_REBUILD_VECTORS,
    VIEW_SWITCHER_SELECTION_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import type {
    ViewSwitcherVectorChange,
    ViewSwitcherVectorOp,
    ViewSwitcherVectorPage,
} from '@gjsify/adwaita-core/conformance';
import {
    VIEW_SWITCHER_FALLBACK_ICON,
    buildInlineToggles,
    buildViewSwitcherButtons,
    createViewSwitcherPage,
    inlineToggleTooltip,
    isViewSwitcherButtonVisible,
    pageIndexForToggle,
    shouldRevealViewSwitcherBar,
    stripMnemonic,
    toggleIndexForPage,
    viewSwitcherBadgeLabel,
    viewSwitcherIconName,
    viewSwitcherIndicatorDescription,
} from '@gjsify/adwaita-core';
import type { ViewSwitcherState } from '@gjsify/adwaita-core';
import type { View } from '@nativescript/core';

import {
    applyViewSwitcherVisibility,
    createViewSwitcherBarState,
    createViewSwitcherState,
    nsIconSvg,
    pageVisibilities,
    switcherButtonVisible,
    viewSwitcherNotifyPayload,
    viewSwitcherPageSpecs,
    type AdwViewPage,
    type NsPageVisibility,
} from './widgets/view-switcher-model.js';

/**
 * A stand-in for a page's content view. Only `visibility` is ever touched by a
 * switcher, so this is the whole contract — not a re-implementation of anything.
 */
function fakeView(): View {
    return { visibility: 'visible' } as unknown as View;
}

/**
 * A vector page as `setViews` receives it.
 *
 * `icon` is an Adwaita symbolic SVG DOCUMENT on NativeScript, but the core only
 * ever asks whether it is absent or empty, so a vector's icon NAME rides in that
 * slot unchanged — which is exactly how a real SVG rides through it on device.
 */
function nsPage(page: ViewSwitcherVectorPage): AdwViewPage {
    return {
        name: page.name,
        // `AdwViewPage` spells "the page has no title" as an ABSENT field, which
        // is the same C NULL a vector writes as `null`.
        title: page.title ?? undefined,
        icon: page.iconName ?? undefined,
        visible: page.visible,
        useUnderline: page.useUnderline,
        badgeNumber: page.badgeNumber,
        needsAttention: page.needsAttention,
        content: fakeView(),
    };
}

/** Apply one vector op through the surface the widget's accessors forward to. */
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

export const AdwViewSwitcherNsTest = async () => {
    await describe('AdwViewSwitcher selection (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_SWITCHER_SELECTION_VECTORS) {
            await it(vector.rule, () => {
                const pages = vector.pages.map((page) => nsPage(page));
                const state = createViewSwitcherState();
                const changes: ViewSwitcherVectorChange[] = [];
                state.subscribe((change) => changes.push(viewSwitcherNotifyPayload(change)));

                state.setPages(viewSwitcherPageSpecs(pages));
                expect(changes).toStrictEqual([...vector.setupChanges]);

                changes.length = 0;
                const results = vector.ops.map((op) => applyOp(state, op));

                expect(results).toStrictEqual([...vector.opResults]);
                expect(changes).toStrictEqual([...vector.changes]);
                expect(state.selected).toBe(vector.selected);
                expect(state.selectedName).toBe(vector.selectedName);

                // The native projection must agree with the model: exactly the
                // selected page is `visible`, and NOTHING is when the selection
                // is -1. The old port collapsed every page at once whenever the
                // stored index was unreachable (`selected = 1.5`).
                const expected: NsPageVisibility[] = pages.map(() => 'collapse');
                if (vector.selected >= 0) expected[vector.selected] = 'visible';
                expect(pageVisibilities(pages, state.selected)).toStrictEqual(expected);

                applyViewSwitcherVisibility(pages, state.selected);
                expect(pages.map((page) => page.content.visibility)).toStrictEqual(expected);
            });
        }

        await it('emits a payload that carries no live model object', () => {
            const state = createViewSwitcherState();
            const payloads: ViewSwitcherVectorChange[] = [];
            state.subscribe((change) => payloads.push(viewSwitcherNotifyPayload(change)));
            state.setPages(viewSwitcherPageSpecs([nsPage({ name: 'learn', title: 'Learn' })]));

            expect(payloads).toStrictEqual([{ selected: 0, name: 'learn', title: 'Learn', interactive: false }]);
            expect(Object.keys(payloads[0]!).sort()).toStrictEqual(['interactive', 'name', 'selected', 'title']);
        });
    });

    await describe('AdwViewSwitcher.setViews rebuild (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_SWITCHER_REBUILD_VECTORS) {
            await it(vector.rule, () => {
                const state = createViewSwitcherState();
                state.setPages(viewSwitcherPageSpecs(vector.pages.map((page) => nsPage(page))));
                if (vector.select !== undefined) state.selectName(vector.select);

                const changes: ViewSwitcherVectorChange[] = [];
                state.subscribe((change) => changes.push(viewSwitcherNotifyPayload(change)));
                state.setPages(viewSwitcherPageSpecs(vector.nextPages.map((page) => nsPage(page))));

                expect(changes).toStrictEqual([...vector.changes]);
                expect(state.selected).toBe(vector.selected);
                expect(state.selectedName).toBe(vector.selectedName);
            });
        }

        await it('names a page by its POSITION when the caller gave none', () => {
            // `setViews` is positional, so an unnamed page still needs a stable
            // id for the name-preserving rebuild to work at all.
            const specs = viewSwitcherPageSpecs([
                { title: 'A', content: fakeView() },
                { title: 'B', content: fakeView() },
            ]);
            expect(specs.map((spec) => spec.name)).toStrictEqual(['0', '1']);
        });
    });

    await describe('AdwViewSwitcher button models (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_SWITCHER_BUTTON_VECTORS) {
            await it(vector.rule, () => {
                const specs = viewSwitcherPageSpecs(vector.pages.map((page) => nsPage(page)));
                const pages = specs.map((spec) => createViewSwitcherPage(spec));
                expect(buildViewSwitcherButtons(pages, vector.selected, vector.policy)).toStrictEqual([
                    ...vector.buttons,
                ]);
            });
        }

        for (const vector of VIEW_SWITCHER_BUTTON_VISIBILITY_VECTORS) {
            await it(`button visibility — ${vector.rule}`, () => {
                const [spec] = viewSwitcherPageSpecs([
                    {
                        name: 'a',
                        title: vector.title ?? undefined,
                        icon: vector.iconName ?? undefined,
                        visible: vector.visible,
                        content: fakeView(),
                    },
                ]);
                expect(isViewSwitcherButtonVisible(createViewSwitcherPage(spec!))).toBe(vector.buttonVisible);
            });
        }
    });

    await describe('AdwInlineViewSwitcher toggles + the two index spaces', async () => {
        for (const vector of INLINE_TOGGLE_VECTORS) {
            await it(vector.rule, () => {
                const specs = viewSwitcherPageSpecs(vector.pages.map((page) => nsPage(page)));
                const pages = specs.map((spec) => createViewSwitcherPage(spec));

                expect(buildInlineToggles(pages, vector.displayMode)).toStrictEqual([...vector.toggles]);
                expect(pages.map((_page, index) => toggleIndexForPage(pages, index))).toStrictEqual([
                    ...vector.toggleIndexByPage,
                ]);
                expect(vector.toggles.map((_toggle, index) => pageIndexForToggle(pages, index))).toStrictEqual([
                    ...vector.pageIndexByToggle,
                ]);
            });
        }

        for (const vector of INLINE_TOOLTIP_VECTORS) {
            await it(`tooltip in ${vector.displayMode} — ${vector.rule}`, () => {
                expect(
                    inlineToggleTooltip({ title: vector.title, useUnderline: vector.useUnderline }, vector.displayMode),
                ).toBe(vector.tooltip);
            });
        }
    });

    await describe('switcherButtonVisible — the two switchers gate differently', async () => {
        // `AdwViewSwitcher` needs a title or an icon ON TOP OF `visible`
        // (adw-view-switcher.c:178); `AdwInlineViewSwitcher`'s `populate_group`
        // gates on `visible` alone (adw-inline-view-switcher.c:370-378). The
        // inline widget inherited the stricter rule and dropped toggles
        // libadwaita draws, for its whole life, because the rule lived in a
        // class that `extends GridLayout` and no spec could import it.
        await it('drops a titleless, iconless page from the CLASSIC switcher', () => {
            expect(switcherButtonVisible('switcher', false, true)).toBe(false);
        });

        await it('keeps that same page as an empty INLINE toggle', () => {
            expect(switcherButtonVisible('inline', false, true)).toBe(true);
        });

        await it('hides a page marked invisible in both', () => {
            expect(switcherButtonVisible('switcher', false, false)).toBe(false);
            expect(switcherButtonVisible('inline', false, false)).toBe(false);
        });

        await it('shows an ordinary page in both', () => {
            expect(switcherButtonVisible('switcher', true, true)).toBe(true);
            expect(switcherButtonVisible('inline', true, true)).toBe(true);
        });
    });

    await describe('AdwViewSwitcherBar reveal (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_SWITCHER_BAR_REVEAL_VECTORS) {
            await it(vector.rule, () => {
                expect(shouldRevealViewSwitcherBar(vector.reveal, vector.pages)).toBe(vector.revealed);
            });
        }

        for (const vector of VIEW_SWITCHER_BAR_VECTORS) {
            await it(vector.rule, () => {
                const bar = createViewSwitcherBarState();
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

        await it('starts COLLAPSED — the NS bar used to start visible', () => {
            // `private _revealed = true` plus a constructor that never touched
            // `visibility` meant a freshly built bar covered the screen bottom
            // until someone set it false. PROP_REVEAL defaults to FALSE.
            const bar = createViewSwitcherBarState();
            expect(bar.reveal).toBe(false);
            expect(bar.revealed).toBe(false);
        });
    });

    await describe('NativeScript icon projection', async () => {
        for (const vector of VIEW_SWITCHER_ICON_VECTORS) {
            await it(`icon ${JSON.stringify(vector.iconName)} — ${vector.rule}`, () => {
                expect(viewSwitcherIconName(vector.iconName)).toBe(vector.resolved);
            });
        }

        await it('resolves the fallback SENTINEL to a real symbolic document', () => {
            // On the browser side `image-missing` becomes a CSS mask class; here
            // it has to become the SVG itself, because GtkImage rasterises path
            // data and would render nothing for a bare name.
            const svg = nsIconSvg(viewSwitcherIconName(null));
            expect(svg).not.toBe(VIEW_SWITCHER_FALLBACK_ICON);
            expect(svg.startsWith('<svg')).toBe(true);
        });

        await it('passes a real icon through untouched', () => {
            const svg = '<svg viewBox="0 0 16 16"><path d="M0 0"/></svg>';
            expect(nsIconSvg(viewSwitcherIconName(svg))).toBe(svg);
        });
    });

    await describe('badge, description and mnemonic (AdwIndicatorBin + adw_strip_mnemonic)', async () => {
        for (const vector of VIEW_SWITCHER_BADGE_VECTORS) {
            await it(`badge ${vector.badgeNumber}, attention ${vector.needsAttention} — ${vector.rule}`, () => {
                expect(viewSwitcherBadgeLabel(vector.badgeNumber)).toBe(vector.badgeLabel);
                expect(viewSwitcherIndicatorDescription(vector.needsAttention, vector.badgeNumber)).toBe(
                    vector.description,
                );
            });
        }

        for (const vector of VIEW_SWITCHER_MNEMONIC_VECTORS) {
            await it(`mnemonic ${JSON.stringify(vector.label)} — ${vector.rule}`, () => {
                expect(stripMnemonic(vector.label)).toBe(vector.stripped);
            });
        }
    });
};
