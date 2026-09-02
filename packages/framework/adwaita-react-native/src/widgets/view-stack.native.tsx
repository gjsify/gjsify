/** @jsxImportSource react */
// `AdwViewStack` on React Native — `@gjsify/adwaita-core`'s selection machine. (On the
// pragma, see `bin.native.tsx`.)
//
// THE STATE CLASS IS `ViewSwitcherState` AND THAT IS NOT A MISNOMER. Core's own header
// says its selection is DELEGATED to `ViewStackState` — the integer/range/hidden guards,
// the by-name lookup, the first-VISIBLE-page auto-pick and the hide-fallback all come
// from there, with their conformance vectors. What it adds on top is `setPages`, a
// name-preserving wholesale replace, and that is exactly the seam a React renderer needs:
// the page list here is a PROP ARRAY that a caller rebuilds on every render, where the
// browser and NativeScript renderers hold long-lived page nodes and can add and remove
// them one at a time. Diffing the array into `ViewStackState.addPage`/`removePage` would
// be a second, private copy of `setPages` — and libadwaita's selection follows the page
// OBJECT across such a rebuild, not the index, which is the part a hand-written diff gets
// wrong.
//
// `visibleChildName` IS AUTHORED, NOT OWNED, and both halves answer that the same way. An
// absent one leaves the stack on its auto-pick, which NOTIFIES — `adw_view_stack_add`
// selects the first VISIBLE page and a switcher that is not told would need a manual
// refresh. An unknown one is REFUSED and not clamped, so the notification a caller gets
// back may not be the name it asked for. Re-applying it on every commit is what makes a
// controlled stack controlled; `selectName(…, false)` marks it non-interactive, because a
// prop is not a click.
//
// EVERY PAGE STAYS MOUNTED and the unselected ones are `display: 'none'` — `hidden` on
// the browser half, `visibility: 'collapse'` on the NativeScript one. Rendering only the
// selected page would unmount the others and lose their state on every switch.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { View } from 'react-native';

import { ViewSwitcherState, type AdwViewSwitcherPageInit } from '@gjsify/adwaita-core';

import type { AdwViewStackPageProps, AdwViewStackProps } from '../props.js';

/**
 * One page prop object as the core's page record, with this surface's defaults applied.
 *
 * `title` and `iconName` collapse to `null` and NOT to `''`, which is load-bearing rather
 * than tidy: `isViewSwitcherButtonVisible` tests `title != NULL`, so an EMPTY title keeps
 * its button and an absent one does not. `createViewSwitcherPage` applies the same rule to
 * the fields left out here.
 */
function pageSpec(page: AdwViewStackPageProps): AdwViewSwitcherPageInit {
    return {
        name: page.name,
        title: page.title ?? null,
        iconName: page.iconName ?? null,
        visible: page.visible ?? true,
        badgeNumber: page.badgeNumber ?? 0,
        needsAttention: page.needsAttention ?? false,
        useUnderline: page.useUnderline ?? false,
    };
}

/**
 * The page model and its selection, shared with `view-switcher.native.tsx`.
 *
 * Exported because the switcher bundles the same stack; `parity.spec.ts` allows a
 * platform-only export beside the widget, and a second copy of this wiring is where the
 * two would come to disagree about what an unknown name does.
 */
export function useViewStackSelection(
    pages: readonly AdwViewStackPageProps[],
    visibleChildName: string | undefined,
    onNotifyVisibleChild: ((name: string) => void) | undefined,
): ViewSwitcherState {
    const [, repaint] = useState(0);
    const store = useRef<ViewSwitcherState | null>(null);
    if (store.current === null) {
        // Built AND filled before anything subscribes: the auto-pick emits, and a
        // listener that called `setState` there would be updating a component while it
        // renders. The effect below is what installs it.
        const created = new ViewSwitcherState();
        created.setPages(pages.map(pageSpec));
        if (visibleChildName !== undefined) created.selectName(visibleChildName, false);
        store.current = created;
    }
    const state = store.current;

    // The callback lives in a ref so the subscription is installed once — re-subscribing
    // for every fresh arrow a caller passes would drop and re-add a listener per render.
    const notify = useRef(onNotifyVisibleChild);
    notify.current = onNotifyVisibleChild;

    useEffect(
        () =>
            state.subscribe((change) => {
                notify.current?.(change.name);
                repaint((count) => count + 1);
            }),
        [state],
    );

    // No dependency list: the page array is rebuilt on every render, so any dependency
    // over its contents would be a second hand-maintained copy of the same record.
    // `setPages` emits only when the SELECTION moved, so this settles in one pass.
    useEffect(() => {
        state.setPages(pages.map(pageSpec));
        if (visibleChildName !== undefined) state.selectName(visibleChildName, false);
    });

    return state;
}

/**
 * The page bodies, one per page, with only the selected one displayed.
 *
 * Shared with the switcher for the reason {@link useViewStackSelection} gives.
 */
export function viewStackBodies(pages: readonly AdwViewStackPageProps[], selected: number): ReactElement[] {
    return pages.map((page, index) => (
        <View key={page.name} style={index === selected ? { flex: 1 } : { display: 'none' }}>
            {page.child}
        </View>
    ));
}

/** {@link import('./view-stack.js').AdwViewStack} on React Native. */
export function AdwViewStack({
    pages,
    visibleChildName,
    onNotifyVisibleChild,
}: AdwViewStackProps): ReactElement | null {
    const list = pages ?? [];
    const state = useViewStackSelection(list, visibleChildName, onNotifyVisibleChild);
    return <View style={{ flex: 1 }}>{viewStackBodies(list, state.selected)}</View>;
}
