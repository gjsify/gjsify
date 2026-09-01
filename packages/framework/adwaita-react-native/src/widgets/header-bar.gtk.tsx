/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwHeaderBar` on GTK — the real `Adw.HeaderBar`. (The pragma above is required of
// every platform module; the reason is in `bin.gtk.tsx`.)
//
// THE THREE SLOTS ARE REACHED BY `slot`, WHICH ONLY A HOST ELEMENT CAN CARRY. gtk-host
// routes a child through `pack_start` / `pack_end` / `set_title_widget` by the `slot`
// prop on the CHILD (descriptors/adw.ts), and a prop of this component is an arbitrary
// `ReactNode` — a `<AdwBin>`, a fragment, a list — so there is nothing to write `slot` on.
// `cloneElement` is not the way out: it sets a prop on a COMPOSITE component, which
// forwards nothing, so the slot would silently be dropped for exactly the children this
// package ships. Each slot therefore gets one container widget, which is also what the
// widget itself is made of — libadwaita packs into a `GtkBox` at each end
// (adw-header-bar.ui) and holds the centre in an `AdwBin` — and what both other renderers
// do (`div.adw-header-bar-start`, a `StackLayout` per side).
//
// THE DERIVED CENTRE IS INSTALLED ONLY WHEN SOMETHING IS AUTHORED, and that is the one
// place this half is better than a faithful port of the other two. `Adw.HeaderBar` with
// no title widget runs `update_title` (adw-header-bar.c:475) and shows the navigation
// page's, the dialog's or the window's title; installing an empty `AdwWindowTitle`
// unconditionally — which `@gjsify/adwaita-web` and `@gjsify/adwaita-nativescript` both
// do, because a DOM element and an NS view have no such chain to give up — would replace
// a resolved title with a blank centre. So the centre is only taken when the caller asks
// for it. `header-bar.gtk.spec.tsx` asserts both branches, the resolved one against a
// window title.

import type { ReactElement } from 'react';

import type { AdwHeaderBarProps } from '../props.js';

/** {@link import('./header-bar.js').AdwHeaderBar} on GTK. */
export function AdwHeaderBar({ titleWidget, title, subtitle, start, end }: AdwHeaderBarProps): ReactElement | null {
    // The either/or `adw_header_bar_set_title_widget` has: the centre bin holds the
    // custom widget OR the derived title, never both (:1201, :1209).
    const centre =
        titleWidget !== undefined ? (
            <adw-bin slot="title">{titleWidget}</adw-bin>
        ) : title !== undefined || subtitle !== undefined ? (
            <adw-window-title slot="title" title={title} subtitle={subtitle} />
        ) : null;

    return (
        <adw-header-bar>
            {start === undefined ? null : (
                <gtk-box slot="start" orientation="horizontal">
                    {start}
                </gtk-box>
            )}
            {centre}
            {end === undefined ? null : (
                <gtk-box slot="end" orientation="horizontal">
                    {end}
                </gtk-box>
            )}
        </adw-header-bar>
    );
}
