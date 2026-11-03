// The CSS node name of each widget class — the word a type selector (`button { … }`) uses.
//
// The names are GTK's own, `gtk_widget_class_set_css_name` in each class, read from GTK 4 and
// libadwaita at runtime (`Widget.get_css_name()` on an instance of every class below). Two
// classes can share one (`GtkButton` and `GtkToggleButton` are both `button`, every
// `Adw*Row` is `row`): a GTK stylesheet is written against that, so a port that tells them
// apart would match less than GTK does.
//
// Not listed, because no GTK/libadwaita class of that name was available to ask: `AdwDataGrid`,
// `AdwImageButton`, `AdwSliderRow`, `AdwToggle`. They keep NativeScript's derived name.
//
// NativeScript's selector parser lowercases a type selector and drops its FIRST hyphen
// (`css-selector.js`: `ast.name.replace('-', '').toLowerCase()`), so `toggle-group` is looked
// up as `togglegroup`. A widget's `cssType` must be spelled that way to be found.

import type { GTypeNamed } from './gtype-name.js';

export const GTK_CSS_NAMES: Readonly<Record<string, string>> = {
    AdwAboutDialog: 'dialog',
    AdwActionRow: 'row',
    AdwAlertDialog: 'dialog',
    AdwApplicationWindow: 'window',
    AdwAvatar: 'widget',
    AdwBanner: 'banner',
    AdwBin: 'widget',
    AdwBottomSheet: 'bottom-sheet',
    AdwButtonContent: 'buttoncontent',
    AdwButtonRow: 'row',
    AdwCarouselIndicatorDots: 'carouselindicatordots',
    AdwCarouselIndicatorLines: 'carouselindicatorlines',
    AdwCarousel: 'carousel',
    AdwClamp: 'clamp',
    AdwComboRow: 'row',
    AdwDialog: 'dialog',
    AdwEntryRow: 'row',
    AdwExpanderRow: 'row',
    AdwHeaderBar: 'headerbar',
    AdwInlineViewSwitcher: 'inline-view-switcher',
    AdwNavigationPage: 'navigation-view-page',
    AdwNavigationSplitView: 'navigation-split-view',
    AdwNavigationView: 'navigation-view',
    AdwOverlaySplitView: 'overlay-split-view',
    AdwPasswordEntryRow: 'row',
    AdwPreferencesGroup: 'preferencesgroup',
    AdwPreferencesPage: 'preferencespage',
    AdwShortcutLabel: 'shortcut-label',
    AdwSidebar: 'sidebar',
    AdwSpinner: 'image',
    AdwSpinRow: 'row',
    AdwSplitButton: 'splitbutton',
    AdwStatusPage: 'statuspage',
    AdwSwitchRow: 'row',
    AdwTabView: 'tabview',
    AdwToastOverlay: 'toastoverlay',
    AdwToggleGroup: 'toggle-group',
    AdwToolbarView: 'toolbarview',
    AdwViewStack: 'stack',
    AdwViewSwitcherBar: 'viewswitcherbar',
    AdwViewSwitcher: 'viewswitcher',
    AdwWindowTitle: 'windowtitle',
    AdwWindow: 'window',
    AdwWrapBox: 'wrap-box',
    GtkActionBar: 'actionbar',
    GtkBox: 'box',
    GtkButton: 'button',
    GtkCheckButton: 'checkbutton',
    GtkDrawingArea: 'widget',
    GtkDropDown: 'dropdown',
    GtkEntry: 'entry',
    GtkFrame: 'frame',
    GtkGrid: 'grid',
    GtkImage: 'image',
    GtkLabel: 'label',
    GtkListBox: 'list',
    GtkMenuButton: 'menubutton',
    GtkOverlay: 'overlay',
    GtkPopoverMenu: 'popover',
    GtkRevealer: 'revealer',
    GtkScrolledWindow: 'scrolledwindow',
    GtkSeparator: 'separator',
    GtkStack: 'stack',
    GtkTextView: 'textview',
    GtkToggleButton: 'button',
    GtkWindow: 'window',
};

/** The `cssType` a CSS node name is matched under, spelled as NativeScript's parser spells a selector. */
export function nsTypeSelector(cssName: string): string {
    return cssName.replace('-', '').toLowerCase();
}

/**
 * The `cssType` of a widget class: the nearest class in its chain that declares a `GTypeName`
 * in {@link GTK_CSS_NAMES}. An application's `class Mine extends GtkBox` is a `box`, as a GTK
 * subclass inherits its parent's CSS name; `undefined` when no ancestor is listed.
 */
export function cssTypeOf(ctor: Function): string | undefined {
    for (let c: unknown = ctor; typeof c === 'function' && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
        const named = c as GTypeNamed;
        if (!Object.hasOwn(named, 'GTypeName') || typeof named.GTypeName !== 'string') continue;
        const cssName = GTK_CSS_NAMES[named.GTypeName];
        if (cssName !== undefined) return nsTypeSelector(cssName);
    }
    return undefined;
}
