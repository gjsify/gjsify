// @gjsify/adwaita-web — Adwaita/Libadwaita web components for browser targets.
// Importing this module registers all custom elements AND self-applies the
// compiled stylesheet — no separate CSS import is needed. The compiled CSS is
// still exported at `@gjsify/adwaita-web/style.css` (e.g. for a <link>) and the
// SCSS partials at `@gjsify/adwaita-web/scss/...` for custom theming.
// Reference: refs/libadwaita (colors/sizing), refs/adwaita-web (component patterns).

import { ADWAITA_WEB_CSS } from './styles.generated.js';

// NO font import here, and the absence is the decision. This line used to be
// `import '@gjsify/adwaita-fonts';` with the comment "Registers @font-face
// (fontsource pattern)". It registered nothing: that package's `.` export is
// `index.css`, css-as-string turns it into `export default "<css>"`, and a
// SIDE-EFFECT import of a module with no side effect is tree-shaken — measured
// on 0.41.0 as a 0-byte bundle with zero `@font-face`, exit 0. It was invisible
// because the primary target platform installs the typeface system-wide, so
// every local screenshot looked right.
//
// The faces now travel through `@gjsify/adwaita-web/fonts` → the generated
// `@gjsify/adwaita-fonts/embedded`, as `data:` URIs behind a VALUE import, which
// is the shape a bundler cannot discard. It stays OUT of this entry because it
// is 2.39 MB / 1.18 MB gzip of base64 against a 190 KB / 26 KB stylesheet, and
// `--app browser` has no code splitting (`output.inlineDynamicImports`), so a
// lazy face would cost the same bytes as an eager one. The stacks that head with
// `'Adwaita Sans'` / `'Adwaita Mono'` are a progressive enhancement over a
// system-installed face, declared as such in `status/stylesheet-font-families.json`.

// Self-applied so `import '@gjsify/adwaita-web'` styles the components under ANY bundler:
// a separate `import '@gjsify/adwaita-web/style.css'` is a no-op under a gjsify
// `--app browser` build, where css-as-string yields a string a side-effect import
// discards and the consumer ends up unstyled. Idempotent + browser-only.
if (typeof document !== 'undefined' && !document.getElementById('adwaita-web-style')) {
    const style = document.createElement('style');
    style.id = 'adwaita-web-style';
    style.textContent = ADWAITA_WEB_CSS;
    document.head.appendChild(style);
}

// Responsive breakpoints: the browser size source for `@gjsify/adwaita-core`'s
// `AdwBreakpoint`, and the `breakpoint="…"` attribute wiring the split views use.
export { addBreakpoints, bindBreakpointSetter } from './breakpoints.js';

// The accent palette and its OkLab standalone derivation are
// `@gjsify/adwaita-core`'s; this is the browser half that puts them in the cascade.
export {
    ACCENT_BG_PROPERTY,
    ACCENT_PROPERTY,
    applyAdwaitaAccent,
    clearAdwaitaAccent,
    isAdwaitaDark,
} from './accent.js';
export type { ApplyAccentOptions } from './accent.js';

// GtkScrolledWindow's undershoot/overshoot indicators. `adw-toolbar-view` drives
// this itself; exported so a consumer that owns its own chrome can shade a scroller
// without one.
export { AdwScrollShading } from './scroll-shading.js';
export type { AdwUndershootEdges } from './scroll-shading.js';

// The stylesheet compiles a chosen SUBSET of `@gjsify/adwaita-icons` (the whole set is
// ~1.07 MB of data-URI), so a name outside it draws the `image-missing` fallback. This is
// the way in for an app that needs a glyph this package does not ship — see
// `icon-registry.ts` for the full recipe.
export { isIconAvailable, registerIcon } from './icon-registry.js';

export { AdwAvatar } from './elements/adw-avatar.js';
export { AdwBanner } from './elements/adw-banner.js';
export { AdwCard } from './elements/adw-card.js';
export { AdwDataGrid } from './elements/adw-data-grid.js';
export type {
    AdwDataGridAlign,
    AdwDataGridColumn,
    AdwDataGridRow,
    AdwDataGridRowVariant,
} from './elements/adw-data-grid.js';
export { AdwClamp } from './elements/adw-clamp.js';
export { AdwSpinner } from './elements/adw-spinner.js';
export { AdwStatusPage } from './elements/adw-status-page.js';
export { AdwWindow } from './elements/adw-window.js';
export { AdwHeaderBar } from './elements/adw-header-bar.js';
export { AdwWindowTitle } from './elements/adw-window-title.js';
export { GtkButton } from './elements/gtk-button.js';
export { AdwButtonContent } from './elements/adw-button-content.js';
// The ONE symbolic-icon node and the ONE toggle, exported before the widgets that build
// them so the barrel's definition order matches theirs. Each host ALSO imports them
// directly, which is what actually guarantees the tags are defined before a
// server-rendered host upgrades.
export { GtkImage, createGtkImage } from './elements/gtk-image.js';
export { GtkSwitch } from './elements/gtk-switch.js';
// The two form-control primitives. ONE module, because upstream merges their
// stylesheet (`_checks.scss`; there is no `_radio.scss` in libadwaita) and
// everything but the corner radius, the glyph and the group is shared.
export { GtkCheckButton, AdwRadio } from './elements/checks.js';
// The determinate progress indicator — <adw-spinner> covers only the indeterminate case.
export { GtkProgressBar } from './elements/gtk-progress-bar.js';
// A keyboard shortcut, drawn as keycaps. The accelerator GRAMMAR lives in
// @gjsify/adwaita-core; this element only builds the nodes.
export { AdwShortcutLabel } from './elements/adw-shortcut-label.js';
// The ONE popover surface, exported before its three hosts for the same reason as
// <gtk-image> above.
export { GtkPopover } from './elements/gtk-popover.js';
export type { GtkPopoverAlign, GtkPopoverPosition, GtkPopoverRole } from './elements/gtk-popover.js';
export { AdwSplitButton } from './elements/adw-split-button.js';
export { AdwToggle, AdwToggleGroup } from './elements/adw-toggle-group.js';
export { GtkEntry } from './elements/gtk-entry.js';
export { AdwPreferencesGroup } from './elements/adw-preferences-group.js';
export { AdwActionRow } from './elements/adw-action-row.js';
export { AdwEntryRow } from './elements/adw-entry-row.js';
export { AdwSwitchRow } from './elements/adw-switch-row.js';
export { AdwComboRow } from './elements/adw-combo-row.js';
export { AdwSpinRow } from './elements/adw-spin-row.js';
export { AdwButtonRow } from './elements/adw-button-row.js';
export { AdwExpanderRow } from './elements/adw-expander-row.js';
export { AdwPasswordEntryRow } from './elements/adw-password-entry-row.js';
export { AdwToastOverlay } from './elements/adw-toast-overlay.js';
export { AdwToolbarView } from './elements/adw-toolbar-view.js';
export { AdwWrapBox } from './elements/adw-wrap-box.js';
export { AdwOverlaySplitView } from './elements/adw-overlay-split-view.js';
export { AdwNavigationSplitView } from './elements/adw-navigation-split-view.js';
export { AdwCarousel, AdwCarouselIndicatorDots, AdwCarouselIndicatorLines } from './elements/adw-carousel.js';
export { AdwTabPage, AdwTabView } from './elements/adw-tab-view.js';
export { AdwViewSwitcher, AdwViewSwitcherPage } from './elements/adw-view-switcher.js';
export { AdwInlineViewSwitcher, AdwViewStackPage } from './elements/adw-inline-view-switcher.js';
export { AdwViewStack } from './elements/adw-view-stack.js';
export type { AdwViewStackPageInfo } from './elements/adw-view-stack.js';
export { AdwViewSwitcherBar } from './elements/adw-view-switcher-bar.js';
export { GtkMenuButton } from './elements/gtk-menu-button.js';
export type { AdwMenuItem } from './elements/gtk-menu-button.js';
export { GtkDropDown } from './elements/gtk-drop-down.js';
export type { GtkDropDownOption } from './elements/gtk-drop-down.js';
export { AdwNavigationPage, AdwNavigationView } from './elements/adw-navigation-view.js';
export { AdwBottomSheet, AdwBottomSheetContent, AdwBottomSheetSheet } from './elements/adw-bottom-sheet.js';
export { AdwSidebar, AdwSidebarItem, AdwSidebarSection } from './elements/adw-sidebar.js';
export { AdwAboutDialog } from './elements/adw-about-dialog.js';
export { AdwAlertDialog, AdwAlertResponse } from './elements/adw-alert-dialog.js';
export { AdwPreferencesDialog, AdwPreferencesPage } from './elements/adw-preferences-dialog.js';
export { AdwDialog } from './elements/adw-dialog.js';
export type { AdwDialogPresentationMode } from './elements/adw-dialog.js';

// ADR 0034 clause 2 — the same widgets, reachable as `Adw.ActionRow` / `Gtk.Entry`. LAST,
// so every element module above is already evaluated and no tag is defined later than it
// was: this line only adds a second spelling, it must not move a registration.
export { Adw, Gtk } from './namespace.js';
