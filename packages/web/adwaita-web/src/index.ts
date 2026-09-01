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

// THE WIDGET CLASSES ARE REACHABLE ONLY AS `Adw.<Name>` / `Gtk.<Name>` (ADR 0034
// clause 2 + § Amendment 6). This line used to be the LAST one in the file, under a
// run of `export { AdwActionRow } …` re-exports it duplicated one for one; those are
// gone, and with them the second spelling. `<adw-action-row>` and `<gtk-entry>` are
// unchanged — this was never about the tags.
//
// IT IS ALSO WHAT PULLS THE ELEMENT MODULES IN, so importing this barrel still
// registers everything. The old order comment ("exported before the widgets that build
// them") described a sequence that is not load-bearing and never was: every host
// imports its prerequisite itself (`import './gtk-switch.js'` in the switch rows,
// `createGtkImage` from `./gtk-image.js` in every widget that draws an icon), so the
// module graph fixes the order whatever a barrel does. The order that IS load-bearing
// is the one inside a single module, and `scripts/check-adwaita-upgrade-order.mjs`
// holds that.
export { Adw, Gtk } from './namespace.js';

// WHAT DID NOT MOVE INTO THE NAMESPACE, and the rule that decides it. A member exists
// for an element whose GIR tag names a real widget; `WEB_ELEMENT_ALIGNMENT` declares the
// rest `webOnly`, meaning no widget in the reference vocabulary stands behind it, so
// there is no GIR name to export it under and inventing one would be held against
// nothing but prose (ADR 0034 § 5). Those classes therefore keep their flat name, and
// that is not a second spelling: it is their only one.
//
// Everything else below is not a widget class at all — a factory, a helper, or a type —
// and a type has no namespace member to move to.

// Two elements with no GTK counterpart: `.adw-card` is a style class here and a styled
// container on GTK, and the grid is presentational where GTK would use a plain Gtk.Grid.
export { AdwCard } from './elements/adw-card.js';
export { AdwDataGrid } from './elements/adw-data-grid.js';
export type {
    AdwDataGridAlign,
    AdwDataGridColumn,
    AdwDataGridRow,
    AdwDataGridRowVariant,
} from './elements/adw-data-grid.js';

// The symbolic-icon FACTORY. `Gtk.Image` is the element; this builds one without a tag,
// which the icon-drawing element modules use internally and a consumer with its own
// chrome needs.
export { createGtkImage } from './elements/gtk-image.js';

// GTK4 has no radio TYPE — a radio is a GtkCheckButton with its `group` set — so
// `Gtk.CheckButton` is the plain form and the grouped one has only this name.
export { AdwRadio } from './elements/checks.js';

// The declarative children of four composites. Each descends from `GObject.Object` and
// not `GtkWidget` on GTK, so the table of concrete widgets has no row for them; the day
// it grows one, its member appears in `namespace.ts` by itself.
export { AdwTabPage } from './elements/adw-tab-view.js';
export { AdwViewSwitcherPage } from './elements/adw-view-switcher.js';
export { AdwViewStackPage } from './elements/adw-inline-view-switcher.js';
export { AdwSidebarItem, AdwSidebarSection } from './elements/adw-sidebar.js';

// Slot wrappers and a declarative response: on GTK these are `set_content()`,
// `set_sheet()` and `add_response()` — calls, not widgets.
export { AdwBottomSheetContent, AdwBottomSheetSheet } from './elements/adw-bottom-sheet.js';
export { AdwAlertResponse } from './elements/adw-alert-dialog.js';

// Supporting types — the option bags, enums and unions the widgets above take and
// return. Not widgets, so clause 2 has nothing to say about them.
export type { GtkPopoverAlign, GtkPopoverPosition, GtkPopoverRole } from './elements/gtk-popover.js';
export type { AdwViewStackPageInfo } from './elements/adw-view-stack.js';
export type { AdwMenuItem } from './elements/gtk-menu-button.js';
export type { GtkDropDownOption } from './elements/gtk-drop-down.js';
export type { AdwDialogPresentationMode } from './elements/adw-dialog.js';
