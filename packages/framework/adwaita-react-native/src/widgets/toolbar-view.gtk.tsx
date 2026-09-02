/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwToolbarView` on GTK — the real `Adw.ToolbarView`. (The pragma above is required of
// every platform module; the reason is in `bin.gtk.tsx`.)
//
// EACH BAR SLOT GETS ONE `GtkBox`, for the reason spelled out in `header-bar.gtk.tsx`:
// gtk-host routes a child by the `slot` prop on the CHILD, a prop of this component is an
// arbitrary `ReactNode`, and `cloneElement` cannot put a `slot` on a composite component.
// A vertical box is also what libadwaita puts there itself — `add_top_bar` appends into
// one — and what both other renderers use (`div.adw-toolbar-view-top`, a vertical
// `StackLayout`). The cost is that several bars share ONE revealer and one style class
// instead of getting one each; a caller composing several bars would have written that
// box by hand anyway.
//
// `children` GOES TO `content` WITH NO SLOT, which is the descriptor's `defaultSlot`, and
// it is deliberately NOT wrapped. `set_content` takes one widget and a box around it
// would break the common case: a `Gtk.ScrolledWindow` given to `set_content` fills the
// slot, while the same scroller inside a `GtkBox` gets its natural height unless someone
// also sets `vexpand`. The price is the one-child eviction every `single` slot in this
// package has, named once in the README.
//
// THE FOUR STYLE CLASSES ARE LIBADWAITA'S JOB HERE. `update_undershoots` reads the
// ALLOCATED bar heights and derives `undershoot-top`/`undershoot-bottom` in C, and the
// two bar styles derive `raised`/`border` there too — `@gjsify/adwaita-core`'s
// `toolbarViewClasses` exists for the renderers that have no libadwaita, and computing
// the same classes here would give one widget two authorities for its own appearance.
// That is the same rule `clamp.gtk.tsx` states for `clampAllocate`.

import type { ReactElement } from 'react';

import type { AdwToolbarViewProps } from '../props.js';

/** {@link import('./toolbar-view.js').AdwToolbarView} on GTK. */
export function AdwToolbarView({
    children,
    topBar,
    bottomBar,
    topBarStyle,
    bottomBarStyle,
    extendContentToTopEdge,
    extendContentToBottomEdge,
}: AdwToolbarViewProps): ReactElement | null {
    return (
        <adw-toolbar-view
            top-bar-style={topBarStyle}
            bottom-bar-style={bottomBarStyle}
            extend-content-to-top-edge={extendContentToTopEdge}
            extend-content-to-bottom-edge={extendContentToBottomEdge}
        >
            {topBar === undefined ? null : (
                <gtk-box slot="top" orientation="vertical">
                    {topBar}
                </gtk-box>
            )}
            {children}
            {bottomBar === undefined ? null : (
                <gtk-box slot="bottom" orientation="vertical">
                    {bottomBar}
                </gtk-box>
            )}
        </adw-toolbar-view>
    );
}
