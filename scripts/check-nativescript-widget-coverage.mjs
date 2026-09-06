#!/usr/bin/env node
// Every NativeScript widget against the scalar GIR properties of the widget it NAMES —
// the direction `check-vocabulary-alignment.mjs` does not measure — and the check proves
// itself on broken input before it looks at the repository.
//
// WHY THIS EXISTS, AND WHAT WAS INVISIBLE
//
// `NS_PROPERTY_ALIGNMENT` holds the port's SETTABLE properties against the counterpart's
// `ConstructorProps` and asks "does this name agree?". A GIR property the port simply
// does not HAVE is invisible to it, and to every other gate: nothing iterates the
// counterpart's side. So the printed line "Distance to one vocabulary: N property
// name(s)" measures disagreement among the properties that EXIST and says nothing about
// the ones that do not.
//
// Measured instance, on the commit this check landed against: `AdwAvatar` set `text` and
// `size` while `AdwAvatar` declares four scalar properties — `icon-name`,
// `show-initials`, `size`, `text`. Two of four, with every check green, for as long as
// the widget existed. `<adw-avatar>` on the web surface has been held against the same
// four since 2026-08-26 by `check-adwaita-element-properties.mjs`; this is that ratchet,
// one renderer over, and the ONE fact it adds is that the two surfaces are now measured
// against the same denominator by the same reader (`gir-scalar-properties.mjs`).
//
// THE DENOMINATOR, SAID EXACTLY, BECAUSE THE HONESTY OF IT IS THE WHOLE DELIVERABLE
//
// For each widget: the properties its counterpart GTYPE DECLARES ITSELF, in
// `packages/framework/gtk-host/src/generated/props.ts` — the own interface body, not the
// `extends` chain — minus signal handlers and minus widget-valued slots. Every one of
// those four choices removes a number nobody could act on:
//
//   · the CHAIN would put `GtkWidget` plus `GtkAccessible`/`GtkBuildable`/
//     `GtkConstraintTarget` behind every widget, nearly all of it reading as "missing"
//     on a port whose views are `GridLayout`s. The ladder's three rungs are MEASURED in
//     `status/open-todos.md`, not written here: a count in a comment is the copy that
//     drifts, and the one that stood here contradicted that ladder in the same change. A
//     property a GIR type inherits from a GIR ancestor is measured on THAT ancestor's row
//     when the port ships the ancestor as a widget too
//     (`AdwSwitchRow`'s `subtitle` is `AdwActionRow`'s, counted on `adw-action-row`) and
//     not at all when it does not (`AdwSwitchRow`'s `title` is `AdwPreferencesRow`'s and
//     the port ships no `adw-preferences-row`) — the one under-count, stated not hidden.
//   · `onNotify*`/`on<Signal>` are a JSX convention. A NativeScript view takes
//     `addEventListener`, so there is no property to be missing.
//   · a widget-valued key (`child`, `content`, `sidebar`, `title-widget`) is a SLOT.
//     `component-builder` assigns `instance[name] = "<raw string>"` from an XML
//     attribute; a view cannot arrive that way on either renderer.
//   · the generator emits multiword properties twice (`canOpen` beside `'can-open'`), so
//     without the dedupe every multiword gap would count double.
//
// Each exclusion is STATED with what it removes and pinned by its own vector in the
// shared reader's self-test, and a fifth would have to be added in
// `gir-scalar-properties.mjs`, where BOTH ratchets would carry it. What no run prints is
// how many keys each one removes: the ladder in `status/open-todos.md` measures that, and
// its 293 → 231 rung IS the slot exclusion.
//
// THE PORT SIDE RESOLVES THE PORT'S OWN `extends` CHAIN, AND THAT IS NOT A DETAIL
//
// `settablePropertiesOfClass` reads ONE class body. `AdwOverlaySplitView` declares one
// setter and inherits seven from `AdwSplitViewBase`, which lives in `split-view-base.ts`
// — not a `<library>-<name>.ts` widget file. Reading the class body alone reports
// `collapsed`, `showSidebar`, `minSidebarWidth`, `maxSidebarWidth`,
// `sidebarWidthFraction` and `sidebarPosition` as six properties the port does not have,
// on a widget that has all six. A false red is the expensive kind: the fix that makes it
// green is deleting the rule. So the chain is walked across the whole package, and where
// it LEAVES the package it must land on a class `ns-core.d.ts` declares — a base this
// reader cannot follow is a failure with its own message, never a silently shorter
// setter set.
//
// WHICH HALF CAN GO RED
//
//   CAN. The two sides are independent and neither reads the other: the port's setters
//   are hand-typed accessors, and `generated/props.ts` is emitted from the GIR by a
//   generator that reads none of them. A gap that is not declared fails. A declared gap
//   the widget now sets fails, so a gap that closes cannot leave its reason standing. A
//   declared gap that is no longer a scalar property of that GType fails, so a @girs
//   bump that drops a property cannot leave a ledger row describing something that does
//   not exist. The TOTAL is not the invariant and does not only fall — a new widget, or
//   a @girs bump that ADDS a property, raises it. What holds is that neither direction
//   is silent: a new gap costs a written reason here, a closed one costs deleting it.
//
//   CANNOT. The `why` floor holds a table in this file against a constant in this file:
//   it refuses a blank, it judges nothing. And the comparison target is a file this
//   repository generates from the same `.gir` ts-for-gir reads — agreement is evidence
//   about two hand-typed vocabularies, never proof about GTK.
//
//   WHAT NO HALF PROVES: that a property the port DOES have carries the same kind of
//   value. `Gtk.Image:icon-size` is a `GtkIconSize` enum and the port's `iconSize` is a
//   size in DIPs; both gates read that as agreement, because both compare names. The
//   census behind that is in `status/open-todos.md`.
//
// SCOPE: the widgets whose file spelling IS a GTK tag. The three that are not
// (`adw-image-button`, `adw-slider-row`, `adw-data-grid`) are declared divergences that
// `NS_WIDGET_ALIGNMENT` owns, and reading their ledger from here would be a second copy
// of it. The count of them is printed, so "not measured" cannot be mistaken for "none".

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { adwaitaNativeScriptWidgets, settablePropertiesOfClass, tagClass } from './adwaita-elements.mjs';
// The GIR side is the SAME reader `check-adwaita-element-properties.mjs` uses for the
// web surface. Two definitions of "a scalar property" is two backlogs that can disagree
// about what they are counting while both stay green.
import { girReaderSelfTest, propsBodies, scalarPropertyNames, tagGTypes } from './gir-scalar-properties.mjs';
import { stripComments } from '../packages/infra/manifest-conformance/lib/strip-comments.mjs';

const ROOT = process.cwd();
const NS_SRC = 'packages/nativescript-bridge/adwaita/src';
const NS_CORE_TYPES = `${NS_SRC}/ns-core.d.ts`;
const PROPS = 'packages/framework/gtk-host/src/generated/props.ts';
const WIDGETS = 'packages/framework/gtk-host/src/generated/widgets.ts';

/** Named in every failure that asks for an edit to the ledger below. */
const LEDGER_SOURCE = 'KNOWN_GAPS in scripts/check-nativescript-widget-coverage.mjs';

/**
 * The floor a declared gap has to clear, borrowed rather than invented:
 * `check-vocabulary-alignment.mjs`, `check-storybook-widget-coverage.mjs` and
 * `check-nativescript-theme-classes.mjs` all buy an exemption with a sentence and all
 * set it here. It refuses a blank; it judges nothing.
 */
const MIN_REASON = 40;

/**
 * Scalar GIR properties the NativeScript port does not set, per widget, with the reason.
 *
 * ONE ENTRY PER WIDGET, NOT PER PROPERTY, and that is a decision rather than a shortcut.
 * `check-adwaita-element-properties.mjs` carries the same backlog for the web surface as
 * a bare list and argues for it in place: "inventing a rationale per entry would be
 * worse than naming none". A per-WIDGET reason is a different object — it says what this
 * port BUILDS and therefore which part of the GTK widget it does not reach, which is a
 * statement about the file it names and can be checked by reading it. A per-property one
 * would be one sentence per gap below, most of them that same sentence restated.
 *
 * THE RATCHET, in both directions. A gap not listed here fails. A listed gap the widget
 * now sets fails, so closing one is an edit here. A listed name that is no longer a
 * scalar property of that GType fails, so a @girs bump cannot leave a row describing a
 * property that does not exist. The total is not the invariant and does not only fall —
 * a new widget, or a @girs bump that ADDS a property, raises it. What holds is that
 * neither direction happens without this edit.
 *
 * NO COUNT IS WRITTEN IN THIS COMMENT. The summary at the bottom derives every number it
 * prints, for the reason ADR 0034 § *Why the distance has to be PRINTED by a gate* gives
 * — a hand-kept count beside a printed one is the copy that drifts, and in this area it
 * has drifted twice.
 */
const KNOWN_GAPS = {
    'adw-about-dialog': {
        gaps: [
            'appdataResourcePath',
            'artists',
            'debugInfo',
            'debugInfoFilename',
            'designers',
            'developers',
            'documenters',
            'issueUrl',
            'license',
            'licenseType',
            'otherAppsTitle',
            'releaseNotes',
            'releaseNotesVersion',
            'supportUrl',
            'translatorCredits',
        ],
        why: 'The port builds the identity CARD and none of the pages behind it: "the app icon glyph, name, version, developer, comments, and a close button" (adw-about-dialog.ts:3-4), which is exactly the seven properties it sets. Credits (artists, designers, developers, documenters, translator-credits), the legal text (license, license-type), the release notes, the debug-info tab, the other-apps list and the two extra link rows are sections it does not render, so there is nothing for the value to reach. `<adw-about-dialog>` declares twelve of the same names on the web surface, which is the same absence measured by the sibling ratchet.',
    },
    'adw-action-row': {
        gaps: ['iconName', 'subtitleLines', 'subtitleSelectable', 'titleLines'],
        why: 'The prefix is a SLOT here, not a property: the port takes a prefix VIEW and the consumer puts a `GtkImage` in it (adw-action-row.ts:3-6), where `Adw.ActionRow:icon-name` is a shortcut GTK resolves against the icon theme this port has no lookup for. The three label knobs are Pango properties of the GTK label — line counts and selectable text — and a NativeScript `Label` exposes neither. Same four names as `<adw-action-row>` on the web surface.',
    },
    'adw-alert-dialog': {
        gaps: ['bodyUseMarkup', 'headingUseMarkup', 'preferWideLayout'],
        why: "There is no in-app dialog to carry them: this class maps onto the platform `confirm()` / `action()` sheet so the dialog looks like the user's OS rather than a libadwaita card (adw-alert-dialog.ts:12-16). A native sheet takes PLAIN strings — no Pango markup to enable — and picks its own width, so the wide-layout hint has nothing to hint to.",
    },
    'adw-avatar': {
        gaps: ['iconName', 'showInitials'],
        why: 'The port renders one thing: "a circular accent-tinted background and a centered initials `Label`" (adw-avatar.ts:3-5). `Adw.Avatar` falls back to an icon when the text is empty or `show-initials` is FALSE, and neither the fallback nor the switch exists here — the initials are the only content path. This is the measured instance that motivated this check, and `<adw-avatar>` carries `icon-name` on the web surface for the same reason.',
    },
    'adw-bottom-sheet': {
        gaps: ['align', 'canOpen', 'fullWidth', 'modal', 'revealBottomBar', 'showDragHandle'],
        why: 'The sheet is bottom-aligned in a `GridLayout` and toggled by `visibility` — "no upward slide, no dimming scrim/backdrop-blur" (adw-bottom-sheet.ts, FIDELITY). Alignment, full-width and modality are properties of a presentation this port does not perform; the bottom bar and the drag handle are the two sub-widgets it does not build, and `can-open` gates an interaction that is a plain `open` write here.',
    },
    'adw-carousel': {
        gaps: ['allowLongSwipes', 'allowMouseDrag', 'allowScrollWheel', 'revealDuration', 'spacing'],
        why: 'The file states two of these itself: "No scroll wheel and no reveal animation, so `allow-scroll-wheel` and `reveal-duration` are absent rather than present and inert" (adw-carousel.ts, FIDELITY 4). The swipe knobs go with it — an NS `ScrollView` has no snap-to-page and no long-swipe concept, so there is no behaviour for them to switch. Page spacing is not settable because the pages are fixed-width children whose offsets `pageWidth` computes.',
    },
    'adw-clamp': {
        gaps: ['unit'],
        why: "Every size in this port is a DIP: `clampAllocationFor` is evaluated against the container's real width in DIPs on `layoutChanged` (adw-clamp.ts, FIDELITY). `Adw.LengthUnit` chooses between px, pt and sp, and a port with one unit has no second one to name. `<adw-clamp>` declares the same gap on the web surface.",
    },
    'adw-combo-row': {
        gaps: ['enableSearch', 'searchMatchMode', 'useSubtitle'],
        why: 'The chooser is the platform `action()` sheet (adw-combo-row.ts:4-6), which has no search field to enable and no match mode to set. `use-subtitle` puts the selected item into the row\'s subtitle instead of the suffix, and this port renders the value inline in the suffix — "the suffix shows the SELECTED value inline plus a small down-chevron" — so the alternative it switches to does not exist.',
    },
    'adw-entry-row': {
        gaps: ['enableEmojiCompletion', 'inputHints', 'inputPurpose'],
        why: 'All three are GTK INPUT-METHOD properties on the inner text widget. A NativeScript `TextField` exposes its keyboard through a different vocabulary (`keyboardType`, `autocorrect`, `secure`), so there is no key to write these onto and mapping them would be inventing a translation table rather than a property. `<adw-entry-row>` declares the same three on the web surface.',
    },
    'adw-expander-row': {
        gaps: ['enableExpansion', 'iconName', 'showEnableSwitch', 'subtitleLines', 'titleLines'],
        why: "The disclosure is a `visibility` toggle over a second grid row (adw-expander-row.ts:2-8) and carries no ENABLE switch: `enable-expansion` and `show-enable-switch` are the pair that puts a `GtkSwitch` in the header and gates the row on it, which this port does not build. `icon-name` and the two label line-counts inherit `AdwActionRow`'s answer above — a slot and two Pango properties.",
    },
    'adw-header-bar': {
        gaps: [
            'centeringPolicy',
            'decorationLayout',
            'showBackButton',
            'showEndTitleButtons',
            'showStartTitleButtons',
            'showTitle',
        ],
        why: "Five of the six are WINDOW CHROME, and a NativeScript app has none: there is no window to decorate, no close/minimise/maximise triple to lay out and no navigation stack owning a back button at this level (the port's navigation views own theirs). `show-title` and `centering-policy` belong to the title-centring machinery `Adw.HeaderBar` runs against those buttons; this bar centres its title widget in a three-column grid unconditionally. Same six names as `<adw-header-bar>` on the web surface.",
    },
    'adw-inline-view-switcher': {
        gaps: ['canShrink', 'homogeneous'],
        why: "Both are GTK SIZE-NEGOTIATION properties — whether the switcher may go below its natural width, and whether every button gets the widest button's width. NativeScript has no minimum/natural size protocol: a `StackLayout` of buttons is laid out by the layout pass, so neither switch has an allocation decision to change. `<adw-inline-view-switcher>` declares the same two.",
    },
    'adw-navigation-split-view': {
        gaps: ['sidebarWidthUnit'],
        why: "The same one-unit answer as `adw-clamp`: `sidebarWidth`, `minSidebarWidth` and `maxSidebarWidth` are DIP numbers here, so `Adw.LengthUnit`'s px/pt/sp choice has nothing to choose between. Declared rather than mapped, because a unit property that only ever accepts one value is worse than none.",
    },
    'adw-navigation-view': {
        gaps: ['hhomogeneous', 'vhomogeneous'],
        why: 'Two size-negotiation properties again: they make the stack request the widest and tallest page rather than the visible one. The port overlays its pages in one `GridLayout` and shows the top by `visibility` (adw-navigation-view.ts:3-4), which means the grid already measures every child — the behaviour is fixed, not settable.',
    },
    'adw-overlay-split-view': {
        gaps: ['enableHideGesture', 'enableShowGesture', 'sidebarWidthUnit'],
        why: 'The two gestures are GTK swipe-tracker switches; this port dismisses the collapsed sidebar by a tap on the scrim and has no swipe tracker to enable or disable (adw-overlay-split-view.ts:3-5). `sidebar-width-unit` gets the same answer its sibling above gets: every width here is a DIP number.',
    },
    'adw-preferences-dialog': {
        gaps: ['searchEnabled', 'visiblePageName'],
        why: 'The search MODEL is implemented and the UI is not — "a search UI (the toggle button, the entry, the results list) is not built yet; the model is" (adw-preferences-dialog.ts) — so `search-enabled` would switch a control that does not exist. The dialog hosts its pages in a plain scroller rather than a view stack, so there is no visible-page name to write. `<adw-preferences-dialog>` declares the same two.',
    },
    'adw-preferences-group': {
        gaps: ['separateRows'],
        why: 'It selects between one boxed list and one card per row. The port renders the `.boxed-list` container only (adw-preferences-group.ts:3-7), so the alternative arrangement the property switches to is not built. `<adw-preferences-group>` declares the same gap on the web surface.',
    },
    'adw-preferences-page': {
        gaps: ['description', 'descriptionCentered'],
        why: 'The page carries its IDENTITY — title, name, icon-name, use-underline — because the dialog binds those onto the view-stack page and the search results need them back (adw-preferences-page.ts). The description is the one field that is PAINTED by the page rather than read off it, and this port paints the groups only. `<adw-preferences-page>` declares the same pair.',
    },
    'adw-sidebar': {
        gaps: ['dropPreload'],
        why: "A drag-and-drop hover behaviour: whether hovering a drag over an item selects it. The port's rows are tappable labels with no drop target and no drag protocol (adw-sidebar.ts, FIDELITY), so there is no hover-during-drag to gate. `<adw-sidebar>` declares the same gap.",
    },
    'adw-spin-row': {
        gaps: ['climbRate', 'digits', 'numeric', 'snapToTicks', 'updatePolicy', 'wrap'],
        why: "All six are `GtkSpinButton` knobs that `Adw.SpinRow` re-exposes, and this row has no spin button: it installs a `[−] value [+]` triplet of two Buttons and a Label in the suffix slot (adw-spin-row.ts:3-8). There is no press-and-hold acceleration, no editable text field to parse or restrict, and no tick snapping — the buttons step by the adjustment's increment and clamp. `<adw-spin-row>` declares the same six.",
    },
    'adw-split-button': {
        gaps: ['canShrink'],
        why: 'The size-negotiation property once more: it lets the button ellipsize below its natural width. NativeScript has no minimum/natural protocol for a `GridLayout` of two tappable parts, so there is no allocation the switch could change. `<adw-split-button>` declares the same gap.',
    },
    'adw-tab-view': {
        gaps: ['shortcuts'],
        why: 'A `Adw.TabViewShortcuts` flag set naming the keyboard accelerators the tab view handles itself (Ctrl+Tab, Alt+digit, …). This port is a touch tab bar on a phone with no key events reaching it, so there is no shortcut to enable or suppress. `<adw-tab-view>` declares the same gap.',
    },
    'adw-toggle-group': {
        gaps: ['activeName', 'canShrink', 'homogeneous'],
        why: '`active-name` addresses a toggle by the `Adw.Toggle:name` its objects carry; this port builds its segments from a label array and per-toggle icons (adw-toggle-group.ts:5-8), so a toggle has no name to be addressed by — the index is its identity. The other two are the size-negotiation pair, with no minimum/natural protocol behind them. `<adw-toggle-group>` declares the same three.',
    },
    'adw-toolbar-view': {
        gaps: ['revealBottomBars', 'revealTopBars'],
        why: 'They animate the bars in and out of the view. This port arranges the bars as `GridLayout` rows and does not reproduce the size allocation libadwaita runs over them (adw-toolbar-view.ts, "NOT reproduced: the two chained CLAMPs"), so there is no reveal to drive; a consumer hides a bar by removing it. `<adw-toolbar-view>` declares the same pair.',
    },
    'adw-view-stack': {
        gaps: ['enableTransitions', 'hhomogeneous', 'transitionDuration', 'vhomogeneous'],
        why: 'Pages swap by toggling `visibility` — "instant, no cross-fade (the CSS subset has" no transition) (adw-view-stack.ts, FIDELITY) — so the two transition properties would switch and time an animation that is not there. The two homogeneity flags are the same size-negotiation pair `adw-navigation-view` answers above. `<adw-view-stack>` declares the same four.',
    },
    'adw-view-switcher': {
        gaps: ['policy'],
        why: 'The port HAS this control and not under this name: `AdwViewSwitcherBase` declares a PROTECTED `policy` getter for the button orientation and exposes the settable door as `switcherPolicy` beside it (view-switcher-base.ts:89-99). So the GIR name is taken by a port-owned member, which ADR 0034 § Amendment 11 records as a question about that member rather than a reason the name cannot converge — the getter is internal and could be renamed. Listed here because until it is, the widget does not answer to `policy`.',
    },
    'gtk-button': {
        gaps: ['canShrink', 'hasFrame', 'iconName', 'label', 'useUnderline'],
        why: "This class extends the REAL NativeScript `Button` (gtk-button.ts:9) and adds exactly one property, `variant`. The label is NS `Button.text` — the same control under the platform's name, which is a divergence no gate sees because `text` is inherited rather than declared here. `has-frame` and the mnemonic underline are GTK chrome with no NS counterpart, `icon-name` is what `AdwImageButton` is for, and `can-shrink` is the size-negotiation property. `<gtk-button>` declares four of the five on the web surface.",
    },
    'gtk-drop-down': {
        gaps: ['enableSearch', 'searchMatchMode', 'showArrow'],
        why: 'The chooser is the platform `action()` sheet, exactly as in `adw-combo-row`, so there is no search field to enable and no match mode. The chevron is drawn unconditionally by the render half (gtk-drop-down.ts:8-10) rather than gated by a property. `<gtk-drop-down>` declares two of the three.',
    },
    'gtk-entry': {
        gaps: [
            'activatesDefault',
            'enableEmojiCompletion',
            'hasFrame',
            'imModule',
            'inputHints',
            'inputPurpose',
            'invisibleChar',
            'invisibleCharSet',
            'menuEntryIconPrimaryText',
            'menuEntryIconSecondaryText',
            'overwriteMode',
            'primaryIconActivatable',
            'primaryIconName',
            'primaryIconSensitive',
            'primaryIconTooltipMarkup',
            'primaryIconTooltipText',
            'progressFraction',
            'progressPulseStep',
            'secondaryIconActivatable',
            'secondaryIconName',
            'secondaryIconSensitive',
            'secondaryIconTooltipMarkup',
            'secondaryIconTooltipText',
            'showEmojiIcon',
            'truncateMultiline',
            'visibility',
        ],
        why: 'The port is "the bare input" (gtk-entry.ts:8-10) — a `TextField` in a `GridLayout` with four properties. Three whole families of `Gtk.Entry` are absent: the two ICON packs (activatable, name, sensitive and two tooltip spellings each), the PROGRESS bar drawn inside the entry, and the INPUT-METHOD group (`im-module`, hints, purpose, emoji, overwrite, the invisible-char pair) that a NativeScript `TextField` spells with `keyboardType`/`secure`/`autocorrect` instead. `visibility` is the sharpest of them: `Gtk.Entry:visibility` is password masking, and the port already answers to `visibility` from NativeScript `View` meaning show-or-hide — the same name for two controls, which is why it is listed rather than mapped. `<gtk-entry>` declares 28 names on the web surface, this one 26; the two the web still lists are `max-length` and `placeholder-text`, which converged here.',
    },
    'gtk-image': {
        gaps: ['file', 'pixelSize', 'resource', 'useFallback'],
        why: "The port renders ONE source: an Adwaita symbolic SVG resolved by name through `renderSymbolicIcon` (gtk-image.ts:14-17), so `file`, `resource` and the icon-theme `use-fallback` name loading paths it does not have. `pixel-size` is the one to read twice: it is GTK's NUMBER for the rendered size, and this widget already answers to `iconSize` as \"the icon size in DIPs\" (gtk-image.ts:109) where `Gtk.Image:icon-size` is a `GtkIconSize` ENUM. So the port carries GTK's `pixel-size` under GTK's `icon-size` name, which is a false friend a name comparison cannot see. `<gtk-image>` declares five on the web surface, `icon-size` among them.",
    },
    'gtk-menu-button': {
        gaps: ['active', 'alwaysShowArrow', 'canShrink', 'direction', 'hasFrame', 'label', 'primary', 'useUnderline'],
        why: 'The menu is the platform `action()` sheet, not a popover (gtk-menu-button.ts, FIDELITY), so `active` — whether the popover is shown — has no state to hold, and the arrow that `always-show-arrow` and `direction` position is not drawn. The button itself extends `AdwImageButton`: it is an ICON button, so `label` and the mnemonic underline have nothing to label, and `has-frame`/`can-shrink` are the GTK chrome and size-negotiation properties this port does not model. `primary` marks the app menu for the F10 accelerator, and there are no key events on a phone. `<gtk-menu-button>` declares seven of the eight.',
    },
};

// ------------------------------------------------------------------ readers

/** Every `.ts` source in the port, `.d.ts` and specs excluded. */
function packageSources(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) out.push(...packageSources(path));
        else if (entry.endsWith('.ts') && !entry.includes('.spec.') && !entry.endsWith('.d.ts')) out.push(path);
    }
    return out;
}

/**
 * `class <Name>[<T>] [extends <Base>]` over one source, comments stripped.
 *
 * The type arguments are what makes this a reader rather than a one-liner:
 * `AdwOverlaySplitView extends AdwSplitViewBase<NsOverlaySplitViewState>` names its base
 * with a generic, and a pattern that stops at the identifier before `<` reads the base as
 * missing — which ends the chain walk and hands the widget a setter set seven short.
 *
 * @param {string} source
 * @returns {Map<string, string | null>} class -> base class name, or null
 */
export function classBases(source) {
    const bases = new Map();
    for (const [, name, base] of stripComments(source).matchAll(
        /\bclass\s+([A-Za-z0-9_$]+)(?:<[^>]*>)?(?:\s+extends\s+([A-Za-z0-9_$]+))?/g,
    )) {
        bases.set(name, base ?? null);
    }
    return bases;
}

/** Every class `ns-core.d.ts` declares — where the port's chains are allowed to end. */
export function ambientCoreClasses(source) {
    return new Set(classBases(source).keys());
}

// ------------------------------------------------------------------ rules

/**
 * A declared gap has to say WHY, in a sentence rather than a word.
 *
 * @param {string} subject already-phrased subject of the failure
 * @param {string | undefined} reason the field as written
 * @returns {string[]}
 */
function reasonProblems(subject, reason) {
    const written = typeof reason === 'string' ? reason.trim() : '';
    if (written === '') {
        return [
            `${subject} with no reason. Add a 'why' to ${LEDGER_SOURCE} saying what the port BUILDS and ` +
                'therefore which part of the GTK widget it does not reach — a gap with no reason is ' +
                'indistinguishable from an oversight.',
        ];
    }
    if (written.length < MIN_REASON) {
        return [
            `${subject} with a ${written.length}-character reason, under the ${MIN_REASON}-character floor ` +
                `the sibling ledgers set: "${written}". Say what the port builds, and cite it, in ${LEDGER_SOURCE}.`,
        ];
    }
    return [];
}

/**
 * Every rule, as one pure function over plain data.
 *
 * Pure so the self-test can hand it a broken world without materialising files, and so a
 * rule with no failing vector is visible as one.
 *
 * @param {{
 *   measured: {tag: string, klass: string, gtype: string,
 *              scalars: Map<string, string> | null, setters: Set<string> | null,
 *              chainEnd: string | null}[],
 *   unmeasured: string[],
 *   coreClasses: Set<string>,
 *   ledger: Record<string, {gaps?: string[], why?: string}>,
 * }} world
 * @returns {string[]} problems, empty when every gap is declared
 */
export function coverageProblems(world) {
    const { measured, coreClasses, ledger } = world;
    const problems = [];

    // The controls. Each of these would make the whole check pass while measuring
    // nothing, which is the one failure a ratchet cannot be allowed to have.
    if (measured.length === 0) {
        problems.push(
            'no NativeScript widget could be measured against a GIR counterpart — the widget reader, the ' +
                'tag table or the props file moved, and an empty comparison agrees with everything',
        );
        return problems;
    }
    const unreadable = measured.filter((widget) => widget.scalars === null);
    if (unreadable.length > 0) {
        problems.push(
            `no props interface found for ${unreadable.map((w) => `${w.klass} (${w.gtype})`).join(', ')} — a ` +
                'widget with no comparison target drops out of the census as a fully covered one',
        );
    }
    const classless = measured.filter((widget) => widget.setters === null);
    if (classless.length > 0) {
        problems.push(
            `the settable-property reader found no class for ${classless.map((w) => w.klass).join(', ')} — a ` +
                'widget whose accessors cannot be read reads as one that sets nothing, i.e. maximally short',
        );
    }
    if (problems.length > 0) return problems;

    // …and the one that keeps a SHORT read from looking like a real gap. A port class
    // whose base is neither another class in the package nor a class `ns-core.d.ts`
    // declares means the chain walk stopped early, and every setter above that point is
    // reported as a property the widget does not have.
    for (const widget of measured) {
        if (widget.chainEnd === null || coreClasses.has(widget.chainEnd)) continue;
        problems.push(
            `${widget.klass}'s inheritance chain leaves the package at '${widget.chainEnd}', which ` +
                `${NS_CORE_TYPES} does not declare. The setter reader cannot follow it, so every property ` +
                'declared above that point would be reported as missing. Teach the reader, or declare the base.',
        );
    }
    const scalarTotal = measured.reduce((sum, widget) => sum + widget.scalars.size, 0);
    if (scalarTotal === 0) {
        problems.push(
            'no scalar GIR property found on any counterpart — the props reader or the generated shape ' +
                'moved, and an empty denominator makes every widget complete',
        );
    }
    if (measured.every((widget) => widget.setters.size === 0)) {
        problems.push(
            'no settable property found on any NativeScript widget — the accessor convention or the chain ' +
                'walk moved, and a surface that sets nothing makes every gap look declared-or-new at once',
        );
    }
    if (problems.length > 0) return problems;

    const declaredTags = new Set(Object.keys(ledger));
    for (const widget of measured) {
        const entry = ledger[widget.tag];
        const gaps = Array.isArray(entry?.gaps) ? entry.gaps : null;
        if (entry !== undefined && gaps === null) {
            problems.push(
                `${widget.klass} has a ledger entry with no 'gaps' array — an entry names the properties it ` +
                    `covers, or it covers nothing. Fix it in ${LEDGER_SOURCE}.`,
            );
            continue;
        }
        const declared = new Set(gaps ?? []);
        if (gaps !== null && declared.size !== gaps.length) {
            problems.push(
                `${widget.klass} lists a property twice in ${LEDGER_SOURCE} — a repeated name counts one gap ` +
                    'as two and makes the printed backlog larger than the tree',
            );
        }
        for (const [property] of widget.scalars) {
            const set = widget.setters.has(property);
            if (set && declared.has(property)) {
                problems.push(
                    `${widget.klass} now sets '${property}' — delete it from ${LEDGER_SOURCE}. A declaration ` +
                        'whose gap is closed is a stale reason left standing, and the next reader believes it.',
                );
                continue;
            }
            if (set || declared.has(property)) continue;
            problems.push(
                `${widget.klass} does not set '${property}', a scalar property of ${widget.gtype}. Implement ` +
                    `it, or add it to that widget's 'gaps' in ${LEDGER_SOURCE} with the reason the port does ` +
                    'not reach it. An undeclared gap is an undecided one, and undecided is what fails here.',
            );
        }
        for (const property of declared) {
            if (widget.scalars.has(property)) continue;
            problems.push(
                `${LEDGER_SOURCE} lists ${widget.klass}.${property}, which is not a scalar property of ` +
                    `${widget.gtype} any more — drop the entry. A ledger describing a property that does not ` +
                    'exist tells the next reader something false.',
            );
        }
        if (gaps === null) continue;
        if (gaps.length === 0) {
            problems.push(
                `${widget.klass} has a ledger entry declaring no gap at all — a widget that holds every ` +
                    `scalar property of its counterpart has no entry. Delete it from ${LEDGER_SOURCE}.`,
            );
            continue;
        }
        problems.push(...reasonProblems(`${widget.klass} declares ${gaps.length} property gap(s)`, entry.why));
    }
    const present = new Set(measured.map((widget) => widget.tag));
    for (const tag of declaredTags) {
        if (present.has(tag)) continue;
        problems.push(
            `${LEDGER_SOURCE} declares '${tag}', which is not a NativeScript widget with a GIR counterpart ` +
                'any more — drop the entry, or say where the widget went',
        );
    }
    return problems;
}

// ------------------------------------------------------------------ self-test

const FIXTURE_REASON = 'a fixture reason, written long enough to clear the floor this file sets';

/**
 * `adw-demo` sets one of its two scalars and declares the other; `adw-plain` sets both.
 * Without a widget that has NO gap the "an entry declaring no gap" rule is vectorless.
 */
const WORLD = () => ({
    measured: [
        {
            tag: 'adw-demo',
            klass: 'AdwDemo',
            gtype: 'AdwDemo',
            scalars: new Map([
                ['label', 'label'],
                ['canShrink', 'can-shrink'],
            ]),
            setters: new Set(['label']),
            chainEnd: 'GridLayout',
        },
        {
            tag: 'adw-plain',
            klass: 'AdwPlain',
            gtype: 'AdwPlain',
            scalars: new Map([['title', 'title']]),
            setters: new Set(['title']),
            chainEnd: 'StackLayout',
        },
    ],
    unmeasured: ['adw-own'],
    coreClasses: new Set(['GridLayout', 'StackLayout']),
    ledger: { 'adw-demo': { gaps: ['canShrink'], why: FIXTURE_REASON } },
});

/** Each vector breaks exactly one rule and names the substring its failure must contain. */
const VECTORS = [
    ['the declared baseline', (w) => w, null],
    ['nothing measured at all', (w) => ({ ...w, measured: [] }), 'no NativeScript widget could be measured'],
    [
        'a counterpart with no props interface',
        (w) => ({ ...w, measured: [{ ...w.measured[0], scalars: null }, w.measured[1]] }),
        'no props interface found for AdwDemo',
    ],
    [
        'a widget class the setter reader could not find',
        (w) => ({ ...w, measured: [{ ...w.measured[0], setters: null }, w.measured[1]] }),
        'the settable-property reader found no class for AdwDemo',
    ],
    [
        'an inheritance chain that leaves the package at an unknown base',
        (w) => ({ ...w, measured: [{ ...w.measured[0], chainEnd: 'MysteryBase' }, w.measured[1]] }),
        "AdwDemo's inheritance chain leaves the package at 'MysteryBase'",
    ],
    [
        'a denominator that read nothing',
        (w) => ({ ...w, measured: w.measured.map((m) => ({ ...m, scalars: new Map() })) }),
        'no scalar GIR property found on any counterpart',
    ],
    [
        'a surface that sets nothing',
        (w) => ({ ...w, measured: w.measured.map((m) => ({ ...m, setters: new Set() })), ledger: {} }),
        'no settable property found on any NativeScript widget',
    ],
    ['an undeclared gap', (w) => ({ ...w, ledger: {} }), "AdwDemo does not set 'canShrink'"],
    [
        'a declared gap the widget now sets',
        (w) => ({
            ...w,
            measured: [{ ...w.measured[0], setters: new Set(['label', 'canShrink']) }, w.measured[1]],
        }),
        "AdwDemo now sets 'canShrink'",
    ],
    [
        'a declared gap that is not a property of the widget',
        (w) => ({ ...w, ledger: { 'adw-demo': { gaps: ['canShrink', 'ghost'], why: FIXTURE_REASON } } }),
        'lists AdwDemo.ghost, which is not a scalar property of AdwDemo',
    ],
    [
        'a declaration for a widget that is not measured',
        (w) => ({ ...w, ledger: { ...w.ledger, 'adw-vanished': { gaps: ['x'], why: FIXTURE_REASON } } }),
        "declares 'adw-vanished', which is not a NativeScript widget",
    ],
    [
        'an entry with no gaps array',
        (w) => ({ ...w, ledger: { 'adw-demo': { why: FIXTURE_REASON } } }),
        "AdwDemo has a ledger entry with no 'gaps' array",
    ],
    [
        'an entry declaring no gap at all',
        (w) => ({ ...w, ledger: { ...w.ledger, 'adw-plain': { gaps: [], why: FIXTURE_REASON } } }),
        'AdwPlain has a ledger entry declaring no gap at all',
    ],
    [
        'the same property listed twice',
        (w) => ({ ...w, ledger: { 'adw-demo': { gaps: ['canShrink', 'canShrink'], why: FIXTURE_REASON } } }),
        'lists a property twice',
    ],
    [
        'a gap declared with no reason',
        (w) => ({ ...w, ledger: { 'adw-demo': { gaps: ['canShrink'] } } }),
        'AdwDemo declares 1 property gap(s) with no reason',
    ],
    [
        'a reason under the floor',
        (w) => ({ ...w, ledger: { 'adw-demo': { gaps: ['canShrink'], why: 'later' } } }),
        'AdwDemo declares 1 property gap(s) with a 5-character reason',
    ],
];

/**
 * The READERS get their own vectors, because the rules above cannot cover them.
 *
 * `coverageProblems` takes plain data, so every vector proves a rule and none of them
 * proves that the thing which BUILT the data read the source correctly. That gap is not
 * hypothetical here: a base pattern that stops at the identifier before `<` reads
 * `extends AdwSplitViewBase<NsOverlaySplitViewState>` as no base at all, ends the chain
 * walk, and reports seven properties the widget has as seven it does not.
 */
const BASE_VECTORS = [
    ['export class AdwDemo extends GridLayout {}', 'AdwDemo', 'GridLayout'],
    ['export abstract class AdwBase<T> extends GridLayout {}', 'AdwBase', 'GridLayout'],
    ['class AdwDemo extends AdwBase<NsState> {}', 'AdwDemo', 'AdwBase'],
    ['class AdwDemo extends AdwBase<NsState<Deep>> {}', 'AdwDemo', 'AdwBase'],
    ['export class AdwGroup extends StackLayout implements NsSearchableGroup {}', 'AdwGroup', 'StackLayout'],
    ['export class AdwRoot {}', 'AdwRoot', null],
    // A class named inside a comment is prose, and these files explain their own
    // hierarchies in prose — `adw-combo-row.ts` opens with "Extends {@link AdwActionRow}".
    ['// class AdwGhost extends GridLayout\nexport class AdwDemo extends Image {}', 'AdwGhost', undefined],
];

function readerSelfTest() {
    const failures = [];
    for (const [source, klass, want] of BASE_VECTORS) {
        const bases = classBases(source);
        const got = bases.has(klass) ? bases.get(klass) : undefined;
        if (got !== want) {
            failures.push(`classBases(${JSON.stringify(source)}).get('${klass}') is ${got}, wanted ${want}`);
        }
    }
    return failures;
}

function selfTest() {
    const failures = [...girReaderSelfTest(), ...readerSelfTest()];
    for (const [label, mutate, expected] of VECTORS) {
        let problems;
        try {
            problems = coverageProblems(mutate(WORLD()));
        } catch (error) {
            // A REAL throw path, and the reason to catch it is attribution rather than
            // tolerance: the two vectors that hand this rule a `null` side exist because
            // the CONTROL in front of them must return early. Delete that control and the
            // rules behind it dereference the null — the check still exits 1, but as a
            // stack trace naming a line instead of as "that rule is not holding", which
            // is the difference between a suite that reports a broken rule and one that
            // looks broken itself. Measured by disabling each control in turn.
            failures.push(
                `${label} THREW instead of reporting: ${error.message} — a control in front of a ` +
                    'rule was removed, or a rule reads a side the control was there to reject',
            );
            continue;
        }
        if (expected === null) {
            if (problems.length > 0) failures.push(`${label} should be clean, got: ${problems.join(' | ')}`);
            continue;
        }
        if (problems.length === 0) failures.push(`${label} produced NO problem — that rule is not holding`);
        else if (!problems.some((problem) => problem.includes(expected))) {
            failures.push(`${label} failed for the wrong reason (wanted "${expected}"): ${problems.join(' | ')}`);
        }
    }
    return failures;
}

// ------------------------------------------------------------------ run

const selfTestFailures = selfTest();
if (selfTestFailures.length > 0) {
    console.error('check-nativescript-widget-coverage: SELF-TEST failed — the check itself is broken:');
    for (const failure of selfTestFailures) console.error(`  - ${failure}`);
    process.exit(1);
}

let world;
try {
    const read = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');
    const bodies = propsBodies(read(PROPS));
    const tagToGType = new Map([...tagGTypes(read(WIDGETS))].map(([tag, gtype]) => [tag, gtype]));
    const coreClasses = ambientCoreClasses(read(NS_CORE_TYPES));

    // Every class in the package and where it lives, so the chain walk can cross files:
    // a widget's base is often a shared abstract class that is not a widget file itself.
    const declaredIn = new Map();
    const baseOf = new Map();
    for (const file of packageSources(join(ROOT, NS_SRC))) {
        const source = readFileSync(file, 'utf8');
        for (const [name, base] of classBases(source)) {
            declaredIn.set(name, file);
            baseOf.set(name, base);
        }
    }
    /** Every setter reachable on a class, plus where the chain left the package. */
    const surfaceOf = (klass) => {
        const setters = new Set();
        const seen = new Set();
        let name = klass;
        while (name !== null && declaredIn.has(name) && !seen.has(name)) {
            seen.add(name);
            const own = settablePropertiesOfClass(readFileSync(declaredIn.get(name), 'utf8'), name);
            if (own === null) return { setters: null, chainEnd: name };
            for (const property of own) setters.add(property);
            name = baseOf.get(name) ?? null;
        }
        return { setters, chainEnd: name };
    };

    const widgetFiles = adwaitaNativeScriptWidgets(ROOT);
    const measured = [];
    const unmeasured = [];
    for (const tag of [...widgetFiles.keys()].sort()) {
        const gtype = tagToGType.get(tag);
        // A widget whose file spelling is not a GTK tag is a declared divergence
        // `NS_WIDGET_ALIGNMENT` owns; reading that ledger from here would be a second
        // copy of it. Counted and printed, never silently dropped.
        if (gtype === undefined) {
            unmeasured.push(tag);
            continue;
        }
        const body = bodies.get(gtype);
        const { setters, chainEnd } = surfaceOf(tagClass(tag));
        measured.push({
            tag,
            klass: tagClass(tag),
            gtype,
            // KEYED ON THE CAMEL SPELLING, because that is what a NativeScript setter and
            // therefore the ledger is written in; the kebab one rides along so a failure
            // could name it. The generator emits both, so neither is derived here.
            scalars:
                body === undefined
                    ? null
                    : new Map([...scalarPropertyNames(body)].map(([kebab, camel]) => [camel, kebab])),
            setters,
            chainEnd,
        });
    }
    world = { measured, unmeasured, coreClasses, ledger: KNOWN_GAPS };
} catch (error) {
    console.error(`check-nativescript-widget-coverage: cannot read an input — ${error.message}`);
    console.error('If a file moved, teach this check where it went. Do not delete it.');
    process.exit(1);
}

const problems = coverageProblems(world);
if (problems.length > 0) {
    console.error('check-nativescript-widget-coverage: a widget and its GIR counterpart disagree:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}

// EVERY NUMBER HERE IS DERIVED, for the reason ADR 0034 gives about this exact area: a
// count written into prose beside a count a run computes is the copy that drifts, and it
// has drifted twice here already.
const scalarTotal = world.measured.reduce((sum, widget) => sum + widget.scalars.size, 0);
const backlog = Object.values(KNOWN_GAPS).reduce((sum, entry) => sum + entry.gaps.length, 0);
const withGaps = Object.keys(KNOWN_GAPS).length;
// A counterpart declaring NO scalar property of its OWN gives its widget an empty
// denominator — `AdwPasswordEntryRow` introduces nothing over `AdwEntryRow` — and "holds
// every one" is then true of it vacuously. Counted with the real ones it would be this
// gate reporting a pass it did not measure, so they are named apart; the control above
// is what catches the day ALL of them read that way.
const held = world.measured.filter((widget) => widget.scalars.size > 0);
const vacuous = world.measured.filter((widget) => widget.scalars.size === 0).map((widget) => widget.tag);
const complete = held.filter((widget) => KNOWN_GAPS[widget.tag] === undefined).length;
console.log(
    `check-nativescript-widget-coverage: self-test green — ${VECTORS.length - 1} failing vector(s), ` +
        `${BASE_VECTORS.length} reader vector(s). ${world.measured.length} NativeScript widgets share a ` +
        `spelling with a GTK tag and are held against ${scalarTotal} scalar GIR propert(y|ies) their ` +
        `counterparts declare — ${scalarTotal - backlog} are set, ${backlog} across ${withGaps} widgets remain ` +
        `a declared backlog, and ${complete} widgets hold every one their counterpart declares. ` +
        `${vacuous.length} counterpart(s) declare no scalar property of their own, so those widgets have ` +
        `nothing to hold and are not evidence of anything${vacuous.length > 0 ? ` (${vacuous.join(', ')})` : ''}. ` +
        `${world.unmeasured.length} widget(s) have no GTK tag of their own and are NOT measured here ` +
        `(${world.unmeasured.join(', ')}) — check-vocabulary-alignment.mjs is what declares what they are.`,
);
