/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwViewSwitcher` on GTK — the real `Adw.ViewSwitcher` over a real `Adw.ViewStack`.
// (On the pragma, see `bin.gtk.tsx`.)
//
// THE STACK IS BUILT HERE AND POINTED AT, WHICH IS THE ONE THING THAT MAKES THE BUNDLED
// SURFACE HONEST. `Adw.ViewSwitcher:stack` is a widget-valued property, so this file
// renders both widgets and binds one to the other; nothing about the switcher is
// simulated and `buildViewSwitcherButtons` is not run on this half at all — libadwaita
// derives its own buttons from the stack's pages model. `props.ts` carries why the two
// are bundled and that both other renderers bundle them too.
//
// THE BINDING NEEDS A RENDER, NOT A REF, and that is why the stack lands in `useState`.
// A `useRef` is populated during commit and never re-renders, so `stack={ref.current}`
// would be `null` on the first pass and stay null forever — the switcher would be a row
// of nothing, at exit 0, which is this host's whole failure signature. The state costs
// one extra render at mount and makes the property write happen.
//
// THE PAGE PROPERTIES COME FROM `view-stack.gtk.tsx`, imported rather than repeated:
// seven `Adw.ViewStackPage` writes and one `slot`-carrying child are exactly what a
// second copy would drift on, and `parity.spec.ts` allows a platform-only export beside
// the widget for this.

import type Adw from 'gi://Adw?version=1';
import { useState, type ReactElement } from 'react';

import type { AdwViewSwitcherProps } from '../props.js';
import { useViewStackPageProperties, viewStackChildren, visibleChildNotifier } from './view-stack.gtk.js';

/** {@link import('./view-switcher.js').AdwViewSwitcher} on GTK. */
export function AdwViewSwitcher({
    pages,
    policy,
    visibleChildName,
    onNotifyVisibleChild,
}: AdwViewSwitcherProps): ReactElement | null {
    const [stack, setStack] = useState<Adw.ViewStack | null>(null);
    useViewStackPageProperties(stack, pages ?? []);

    return (
        <gtk-box orientation="vertical">
            <adw-view-switcher policy={policy} stack={stack} />
            <adw-view-stack
                ref={setStack}
                vexpand={true}
                visible-child-name={visibleChildName}
                onNotifyVisibleChild={visibleChildNotifier(stack, onNotifyVisibleChild)}
            >
                {viewStackChildren(pages ?? [])}
            </adw-view-stack>
        </gtk-box>
    );
}
