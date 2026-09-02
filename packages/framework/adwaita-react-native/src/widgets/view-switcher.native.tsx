/** @jsxImportSource react */
// `AdwViewSwitcher` on React Native — `buildViewSwitcherButtons` over the same stack
// `view-stack.native.tsx` runs. (On the pragma, see `bin.native.tsx`.)
//
// NOT ONE BUTTON DECISION IS MADE IN THIS FILE. `buildViewSwitcherButtons` returns one
// model per PAGE — libadwaita's `populate_switcher` adds a button for every page and
// `update_button` merely hides the ones that fail the visibility rule, so the index
// spaces line up — carrying whether the button exists at all (a page with NEITHER a
// title NOR an icon has none, and an EMPTY title is not that case), the mnemonic-stripped
// label, the badge text (`999+` above the limit), the needs-attention dot and the
// screen-reader description. libadwaita derives the same on GTK from the stack's pages
// model, so the two halves differ in what they can DRAW and never in which buttons exist.
//
// A HIDDEN BUTTON IS RENDERED AND NOT DISPLAYED, which is what both other renderers do
// (`button.hidden` on the browser half, `visibility` on the NativeScript one) and what
// libadwaita does itself. Dropping the node instead would make "this page has no button"
// indistinguishable from "this page is not in the model", which is the assertion
// `view-switcher.native.spec.tsx` needs to be able to make.
//
// THE TAP TARGET IS A `Text`, AND BOTH TEXTS CARRY THE HANDLER. React Native's tappable
// primitives — `Pressable`, `TouchableOpacity` — are COMPOSITES, and this package's test
// double may only stand in for a component that IS a host element with its props
// forwarded (`testing/react-native.ts` states the rule; `spinner.native.tsx` is the
// precedent for refusing one). `Text` has `onPress` on its own props, so the button is a
// `View` in the model's orientation holding a label `Text` and, when there is one, a badge
// `Text` — each with the same handler, so the whole button is tappable rather than only
// its left half.
//
// NO ICON IS DRAWN, so a page with an icon and no title gets a button with an empty
// label. That is the icon-theme divergence the README already names for `AdwStatusPage`,
// `AdwAvatar` and `AdwButtonContent`: `iconName` names an entry in a theme React Native
// has none of, and drawing the name as text would put `folder-symbolic` on screen. The
// ORIENTATION is still applied, because it is what arranges the label and the badge.

import { type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { buildViewSwitcherButtons } from '@gjsify/adwaita-core';

import type { AdwViewSwitcherProps } from '../props.js';
import { useViewStackSelection, viewStackBodies } from './view-stack.native.js';

/** {@link import('./view-switcher.js').AdwViewSwitcher} on React Native. */
export function AdwViewSwitcher({
    pages,
    policy,
    visibleChildName,
    onNotifyVisibleChild,
}: AdwViewSwitcherProps): ReactElement | null {
    const list = pages ?? [];
    const state = useViewStackSelection(list, visibleChildName, onNotifyVisibleChild);
    const buttons = buildViewSwitcherButtons(state.pages, state.selected, policy ?? 'narrow');

    return (
        <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row' }}>
                {buttons.map((button) => {
                    const press = (): void => {
                        state.setSelected(button.pageIndex);
                    };
                    return (
                        <View
                            key={button.name}
                            accessible={true}
                            accessibilityRole="button"
                            accessibilityState={{ selected: button.selected }}
                            style={{
                                flexDirection: button.orientation === 'horizontal' ? 'row' : 'column',
                                display: button.visible ? 'flex' : 'none',
                            }}
                        >
                            <Text onPress={press}>{button.label}</Text>
                            {button.badgeLabel.length === 0 ? null : <Text onPress={press}>{button.badgeLabel}</Text>}
                        </View>
                    );
                })}
            </View>
            {viewStackBodies(list, state.selected)}
        </View>
    );
}
