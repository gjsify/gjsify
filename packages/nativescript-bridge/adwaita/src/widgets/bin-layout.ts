// How a button holds its ONE child — the container that is handed the whole allocation.
//
// THE INCIDENT. Learn6502's Android gamepad draws "A" and "B" as `Gtk.Button { label: "A"; }`
// with `width-request: 55; height-request: 55` and the `circular` class, and its d-pad as five
// 50×50 cells. On device (S9, density 3.5) the A button's view measured 193×193 and its label
// sat in the TOP-LEFT of it: the glyph's centre came out 79px left of and 65.5px above the
// button's centre, the d-pad arrows 27.5px left and 41.5px high. The header's open button, an
// `AdwImageButton`, was 120×133 with its icon 20.5px above its own centre. All of them were a
// `GridLayout` with one `star` row and one `star` column holding a child aligned
// `center`/`middle` — the construction that is supposed to centre it.
//
// WHY A STAR CELL CANNOT. `GridLayout.java` measures the tracks and applies the view's floor
// AFTERWARDS: `measureWidth = Math.max(measureWidth, getSuggestedMinimumWidth())` runs after
// `helper.measure()`, and `onLayout` then places every child from the
// `helper.columns/rows.get(i).length` frozen in that pass. So a `min-width` / `min-height`
// floor grows the VIEW and never the cell. That floor is exactly what this port makes of
// `width-request` / `height-request` (`widget-layout.ts`) and of the theme's `min-height: 38`
// on `.adw-button`, so every button whose request or theme floor exceeded its content kept a
// content-sized cell pinned at the padding origin, with the child dutifully centred inside
// that. PADDING does reach the cell — the menu button's 119×119 view centred its 56×56 icon to
// within half a pixel — which is why nothing looked wrong until something made a request, and
// why "the alignment is not being applied" was never the defect.
//
// GTK HAS NO SUCH SPLIT. `GtkButton`'s layout manager is handed the widget's ALLOCATION and
// centres the child in it; the minimum is what that allocation was negotiated from, not a
// correction bolted on after the placement. `DockLayout` with `stretchLastChild` is the one
// `@nativescript/core` layout that does the same: `DockLayout.java`'s `onLayout` computes
// `remainingWidth = right - left - (paddingLeft + paddingRight)` from the allocation it was
// given and hands exactly that rectangle to `CommonLayoutParams.layoutChild`, which honours
// the child's `center` / `middle` gravity. Its `onMeasure` still floors content-plus-padding
// by `getSuggestedMinimum*`, so a request keeps meaning GTK's minimum.
//
// THE THREE THAT WERE MEASURED AND REFUSED, so the next reader need not walk them again:
//
//   · `ContentLayout` / `ContentView`, the obvious "one child" container. The shipped
//     `widgets-release.aar` (`javap -c org.nativescript.widgets.ContentLayout`) computes
//     `childRight = (right - left) - (paddingLeft + paddingRight)` but
//     `childBottom = (bottom - top) - paddingBottom` — the leading padding counted twice on
//     one axis and once on the other, so a padded child lands `paddingLeft / 2` off centre
//     horizontally. A container that mis-centres by construction cannot be the fix for a
//     mis-centring.
//   · `StackLayout`. Its cross axis centres, but the MAIN axis is placed from
//     `LayoutBase.getGravity(this)`, which reads the layout's own parent-assigned
//     `FrameLayout.LayoutParams.gravity` and falls back to `Gravity.FILL` — so whether the
//     button centred its label would depend on what the button's PARENT wrote on it.
//   · writing the request onto NativeScript's `width` / `height` instead. Exact sizes DO reach
//     the cells, which is why `.adw-split-button-dropdown`'s `width: 36` never had this bug,
//     but exact is the wrong word: GTK's `width-request` is a floor a larger child grows past,
//     and `width` would clip it.
//
// `AdwSingleChildBase` (`Adw.Bin`, `Gtk.Revealer`, `Gtk.Overlay`, `Gtk.ScrolledWindow`) keeps
// its grid on purpose, and the difference is which direction the sizing runs. It MEASURES to
// its child when nothing settled its own size, which is the `star` / `auto` switch
// `single-child-cell.ts` drives and which a `DockLayout` cannot say — it has no `auto`. A
// button is the other kind: given a size, and obliged to centre inside it.

import type { DockLayout, View } from '@nativescript/core';

/**
 * Parent `view` as the single child of a bin-shaped `layout`, centred in whatever allocation
 * that layout is given.
 *
 * `stretchLastChild` is WRITTEN rather than left to the platform default (`true`,
 * `ui/layouts/dock-layout/dock-layout-common`), because it is the whole of what makes this a
 * bin: with it the last — here only — child is laid out across the padding box of the real
 * allocation. The two alignments are the child's half of the same statement, `Gtk.Align.CENTER`
 * on both axes, which is what `gtk_widget_set_halign` / `set_valign` would say.
 */
export function adoptIntoBin<T extends View>(layout: DockLayout, view: T): T {
    layout.stretchLastChild = true;
    view.horizontalAlignment = 'center';
    view.verticalAlignment = 'middle';
    layout.addChild(view);
    return view;
}
