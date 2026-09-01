// The ONE API surface — the half that is neither GTK nor React Native. Every widget is a
// prop type here and two implementations elsewhere; `parity.spec.ts` is what holds both
// implementations to this declaration rather than letting each half be internally
// consistent and free to disagree with the other.
//
// PROPS ARE NAMED IN LIBADWAITA'S VOCABULARY, camelCased. `maximumSize` is
// `AdwClamp:maximum-size`, not a React Native `maxWidth` — the package's promise is the
// Adwaita design language on React Native, so the property a reader looks up in
// libadwaita's documentation is the property they write.

import type {
    AdwLengthUnit,
    AdwToolbarStyle,
    AdwWrapBoxJustify,
    AdwWrapBoxOrientation,
    AdwWrapBoxPackDirection,
    AdwWrapPolicy,
} from '@gjsify/adwaita-core';
import type { ReactNode } from 'react';

/**
 * What a widget that HOLDS a child accepts.
 *
 * Not every widget does. `Adw.WindowTitle` is two labels and no child slot, so
 * {@link AdwWindowTitleProps} deliberately does not extend this — a `children` a widget
 * would have to drop is a hole in the surface, not a convenience.
 */
export interface AdwWidgetProps {
    children?: ReactNode;
}

/** `Adw.Bin` — a widget with one child and no layout of its own. */
export type AdwBinProps = AdwWidgetProps;

/**
 * `Adw.Clamp` — constrain a child's size and centre it.
 *
 * The defaults named below are libadwaita's own; in code both halves read them from
 * `@gjsify/adwaita-core`'s `ADW_CLAMP_DEFAULTS` rather than repeating them.
 */
export interface AdwClampProps extends AdwWidgetProps {
    /** `maximum-size` — how wide the child may get. Default 600. */
    maximumSize?: number;
    /** `tightening-threshold` — where the eased tightening starts. Default 400. */
    tighteningThreshold?: number;
}

/**
 * `Adw.HeaderBar` — the start / centre / end bar at the top of a window.
 *
 * THE THREE SLOTS ARE PROPS, NOT CHILDREN, and the names are the GTK host's own slot
 * names (`start`, `end`, `title` — `packages/framework/gtk-host/src/descriptors/adw.ts`),
 * which are `adw_header_bar_pack_start` / `_pack_end` / `:title-widget`. A bare child
 * would have to pick one of them, and `Adw.HeaderBar`'s buildable default picking `start`
 * is a GTK detail no React caller should have to know.
 *
 * PACK ORDER DOES NOT ARISE HERE, and that is the one place this surface is SIMPLER than
 * the imperative API rather than different from it. `adw_header_bar_pack_end` PREPENDS
 * (adw-header-bar.c:1106), so `packEnd(menu); packEnd(search)` draws `search | menu`;
 * `HeaderBarState` in `@gjsify/adwaita-core` stores the end slot in DRAW order for
 * exactly that reason. A prop is already draw order — `end={<><Search /><Menu /></>}` is
 * what it looks like — so there is no order to reverse and no rule to get backwards.
 */
export interface AdwHeaderBarProps {
    /**
     * `title-widget` — a custom centre.
     *
     * Either/or with {@link title}/{@link subtitle}, as `adw_header_bar_set_title_widget`
     * is with the derived label it empties out of the centre bin (:1201).
     */
    titleWidget?: ReactNode;
    /**
     * The centre's title.
     *
     * A DIVERGENCE FROM LIBADWAITA, and the same one both other renderers carry:
     * `Adw.HeaderBar` has NO `title` property at all. Its derived centre is a plain
     * `gtk_label_new (NULL)` (`construct_title_label`, adw-header-bar.c:512) over a title
     * RESOLVED from the navigation page, then the dialog, then the window, then the
     * application name (`update_title`, :475) — and an app that wants a subtitle sets an
     * `AdwWindowTitle` as its title widget. A declarative surface wants the attribute, so
     * authoring one installs an {@link AdwWindowTitleProps} centre; it is recorded as
     * `HeaderBarRenderState.derivedSubtitle` in `@gjsify/adwaita-core`.
     */
    title?: string;
    /** The centre's subtitle. Same divergence as {@link title}. */
    subtitle?: string;
    /** `pack_start` — the leading slot, in draw order. */
    start?: ReactNode;
    /** `pack_end` — the trailing slot, in draw order. */
    end?: ReactNode;
}

/** `Adw.StatusPage` — a centred empty state: icon, title, description and one child. */
export interface AdwStatusPageProps extends AdwWidgetProps {
    /**
     * `icon-name` — the symbolic icon above the title.
     *
     * CARRIED ON BOTH HALVES AND DRAWN ONLY ON GTK. An icon NAME needs an icon theme to
     * resolve it, and React Native has none — the same wall `@gjsify/adwaita-nativescript`
     * hit, which took an SVG string instead. The README names it; `status-page.native.spec.tsx`
     * pins that the tree has no icon node, so the day one appears is a decision and not a
     * drift.
     */
    iconName?: string;
    /** `title` — the bold line. An empty title takes no space (`string_is_not_empty`). */
    title?: string;
    /** `description` — the dim line below it. Empty takes no space. */
    description?: string;
}

/**
 * `Adw.ToolbarView` — a content area framed by top and/or bottom bars.
 *
 * `children` IS THE CONTENT, i.e. `Adw.ToolbarView:content`: the buildable default child
 * on GTK, the unnamed slot in `@gjsify/adwaita-web` and the fallback slot in
 * `@gjsify/adwaita-nativescript`. The two bar slots are props under the names all three
 * renderers already give their bar containers.
 */
export interface AdwToolbarViewProps extends AdwWidgetProps {
    /** `adw_toolbar_view_add_top_bar` — what sits above the content. */
    topBar?: ReactNode;
    /** `adw_toolbar_view_add_bottom_bar` — what sits below it. */
    bottomBar?: ReactNode;
    /** `top-bar-style`. Default `flat`. */
    topBarStyle?: AdwToolbarStyle;
    /** `bottom-bar-style`. Default `flat`. */
    bottomBarStyle?: AdwToolbarStyle;
    /** `extend-content-to-top-edge` — the content runs UNDER the top bar. Default false. */
    extendContentToTopEdge?: boolean;
    /** `extend-content-to-bottom-edge`. Default false. */
    extendContentToBottomEdge?: boolean;
}

/** `Adw.WindowTitle` — a title over a subtitle, for the centre of a header bar. */
export interface AdwWindowTitleProps {
    /** `title`. The label is HIDDEN when this is empty, not merely blank. */
    title?: string;
    /** `subtitle`. Hidden when empty, by the same rule. */
    subtitle?: string;
}

/**
 * `Adw.WrapBox` — a box whose children flow onto new lines when they run out of room.
 *
 * All fourteen properties, each under libadwaita's own name. The three length properties
 * come in pairs with their unit, which is why `childSpacing` and `childSpacingUnit` are
 * two props and not one string: they are two GObject properties, and they are resolved
 * against the unit SEPARATELY, so the two spacings can legitimately disagree about it.
 */
export interface AdwWrapBoxProps extends AdwWidgetProps {
    /** `child-spacing` — the gap between children on one line, in {@link childSpacingUnit}. Default 0. */
    childSpacing?: number;
    /** `child-spacing-unit`. Default `px` — NOT the split views' `sp`. */
    childSpacingUnit?: AdwLengthUnit;
    /** `line-spacing` — the gap between lines, in {@link lineSpacingUnit}. Default 0. */
    lineSpacing?: number;
    /** `line-spacing-unit`. Default `px`. */
    lineSpacingUnit?: AdwLengthUnit;
    /** `align` — where the children sit ALONG the line: 0 start, 0.5 middle, 1 end. Default 0. */
    align?: number;
    /** `justify` — whether and how a COMPLETE line is stretched. Default `none`. */
    justify?: AdwWrapBoxJustify;
    /** `justify-last-line` — whether the FINAL line is stretched too. Default false. */
    justifyLastLine?: boolean;
    /** `line-homogeneous` — whether every line takes the same space. Default false. */
    lineHomogeneous?: boolean;
    /** `natural-line-length`, in {@link naturalLineLengthUnit}. `-1` (the default) is UNSET. */
    naturalLineLength?: number;
    /** `natural-line-length-unit`. Default `px`. */
    naturalLineLengthUnit?: AdwLengthUnit;
    /** `pack-direction` — which end of a line children are packed from. Default `start-to-end`. */
    packDirection?: AdwWrapBoxPackDirection;
    /** `wrap-reverse` — whether lines wrap upwards. Default false. */
    wrapReverse?: boolean;
    /** `wrap-policy` — whether an overflowing line squeezes its children. Default `natural`. */
    wrapPolicy?: AdwWrapPolicy;
    /** `orientation` — the axis children are packed along. Default `horizontal`. */
    orientation?: AdwWrapBoxOrientation;
}
