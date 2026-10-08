# 97. A `.blp` menu and its actions run on the browser and NativeScript

- Status: **Accepted** (2026-10-08)
- Date: 2026-10-08
- Deciders: Pascal Garber
- Depends on: [ADR 0098 (a minimal Application)](0098-a-minimal-application-runs-on-the-browser-and-nativescript.md)
- Related: [ADR 0042 (portable menu model)](0042-portable-menu-model.md),
  [ADR 0070 (a second specifier)](0070-a-blp-reaches-a-renderer-through-a-second-specifier.md),
  [ADR 0093 (template constructs per renderer)](0093-template-constructs-are-carried-and-each-renderer-declares-what-it-builds.md),
  [ADR 0096 (a GObject subset)](0096-a-gobject-subset-runs-on-the-browser-and-nativescript.md)
- Completes: the `menu` row of ADR 0093 § Construct table, which names "its own ADR" for the item shape.
- Supersedes: the `Dialogs.action()` sheet as the NativeScript menu surface (ADR 0042 § 6, `menu-sheet.ts`).

## Rule for every stage

The API is GTK's. A stage may implement a strict SUBSET: the same names with GJS's semantics, and
what is not implemented throws, naming it. Later stages only add; an application written against an
earlier stage is never rewritten.

## Context

ADR 0042 decided the menu VALUE (`AdwMenuModel`, a `GMenuModel` mirror, with `action` as one
detailed name and `enabled`/`checked` read from the action). Both ports draw it from a
`menuModel` property. What is missing is the way from a `.blp` to that value, and from an item to
a `Gio.SimpleAction`. Measured:

- **The IR carries it.** `packages/infra/blueprint` parses a root `menu id { … }` into `MenuNode`
  (`items: MenuItem[]`, each `kind: 'item' | 'section' | 'submenu'`, string-only `attributes`, an
  optional `id` on sections and submenus) and an inline `menu-model: menu id { … }` into `MenuValue`.
  `emit-xml.mjs` writes both back to `<menu>`.
- **The projection drops it.** `projectToSharedNode` records every `menu`, top-level or inline, as a
  `lost` entry of kind `menu` (`project.mjs`). ADR 0093's table says `port (0042 value)` for both
  ports; that cell is a plan, not a fact. A `.blp` with a menu renders a `GtkMenuButton` with no menu.
- **Web.** `gtk-menu-button`, `adw-split-button` and `popover-menu` take `menuModel` and an
  `actions` property (`AdwMenuActions`) the application fills by hand. Activation is the
  `menu-item-activated` event. `Gio` exports only `Menu` and `MenuItem`; `action-name` is a stored
  string on a few elements and nothing resolves it.
- **NativeScript.** `GtkMenuButton`/`AdwSplitButton` present the value as a `Dialogs.action()`
  sheet (`menu-sheet.ts`). `widgets/actions.ts` has `SimpleAction` (`enabled`, `activate`),
  `SimpleActionGroup`, `insertActionGroup` and `activateWidgetAction`, which walks the parent chain
  for the group under the name's prefix. It has no state, and `GtkButton` is its only caller.
- **Learn6502** (`gjsify/easy6502`, `packages/app-gnome`): one `menu buttonRunMenu` with 14 items,
  all `action: 'win.…'` or `'app.…'`, no `target`, no section `label`, no state. 11 `win.`
  `Gio.SimpleAction`s via `this.add_action(…)` on the window, 3 `app.` actions on the application,
  one `Gio.SimpleActionGroup` inserted as `source-view`, and `set_accels_for_action` for `app.quit`
  and three `win.` file actions. Buttons use `action-name: "win.assemble"` and `"source-view.copy"`;
  two use `navigation.push` with an `action-target`. No stateful action, no radio item.
- **GTK.** An action name resolves through the widget tree: `gtk_widget_insert_action_group` puts a
  group under a prefix on a widget, a lookup walks to the root, `app` and `win` are the groups
  `GtkApplication` and `GtkApplicationWindow` provide (`refs/gtk/gtk/gtkactionmuxer.c`;
  `gtkmenutrackeritem.c` for what an item reads from its action).

## Decision

**A `.blp` menu is projected to the 0042 value; a `.blp` action name resolves through one
renderer-free action registry in `@gjsify/adwaita-core`, with `app.` provided by the Application of
ADR 0098; each port supplies only the door to its widget tree and its popup. On NativeScript the popup
is a native Android `PopupMenu` anchored at the widget. The subset is what Learn6502 uses plus stateful
check/radio; everything else is refused by name.**

### 1. The IR shape

- `SharedNode` gains `menus?: Record<string, AdwMenuModel>` beside `siblings`, keyed by the root
  `menu id`. A property `menu-model: id` stays a scalar id reference, resolved by the builder against
  `menus`; an inline `MenuValue` becomes the `AdwMenuModel` itself at the property. Neither is a
  `lost` entry any more.
- Item attributes map to 0042's fields by name (`label`, `icon`, `verb-icon`, `use-markup`,
  `hidden-when`, `accel`, `display-hint`, `submenu-action`). `target` is folded into the detailed
  action (`action` + `target: "'list'"` → `app.view::list`); no field is added, as in 0042 § 3. A
  `target` with no `action` is a build error naming the line.
- An item attribute 0042 has no field for is refused by name at projection, not dropped. `custom`
  is refused at the renderer (0042 § 6), because it needs a widget.

### 2. Rendering

| | browser | NativeScript |
|---|---|---|
| `Gtk.MenuButton`, `Adw.SplitButton` | popover with sections, submenu pages, check/radio rows (0042) | native `PopupMenu` anchored at the button (below) |
| standalone `Gtk.PopoverMenu` with `menu-model` | `popover-menu` element | implemented as the same `PopupMenu`, anchored at its parent (below) |
| `Gtk.PopoverMenuBar` | `gtk-popover-menu-bar` (exists) | refused by name |

On both, the element reads `actions` from the registry (§ 3) instead of waiting for the application to
set it, and activation calls `activate` on the resolved action. An explicit `actions` assignment still
wins, so today's applications keep working.

**NativeScript `PopupMenu`.** `new PopupMenu(context, anchor)`; the anchor is the button, so the menu
is placed where the user tapped, which the sheet could not do. Mapping:

| 0042 part | `PopupMenu` |
|---|---|
| item | `Menu.add(groupId, itemId, order, title)`; the id maps back to the model PATH, as `menu-sheet.ts` does by position |
| section | a distinct `groupId`, with `setGroupDividerEnabled(true)` (API 28) so a rule is drawn; below API 28 sections are inlined without a rule |
| submenu | `Menu.addSubMenu`, which `PopupMenu` shows as a nested popup |
| insensitive item | shown disabled (`setEnabled(false)`), not omitted: with an anchored native menu the dimmed row is the platform's own idiom. This replaces 0042 § 6's "availability" rule for NativeScript; `hidden-when` still omits |
| CHECK | `setCheckable(true)` + `setChecked` from the action state |
| RADIO | its section is a group with `setGroupCheckable(group, true, exclusive: true)`; one radio run per section |

What `PopupMenu` cannot express, refused by name when the model is applied (not silently drawn wrong):

- a RADIO run and a CHECK item in the same section, or two radio runs in one section: the checkable
  flag is per group, so a model that mixes them throws naming the section;
- `custom` items (0042 § 6); a section `label` (heading): drawn as a disabled, non-selectable first row
  would invent a widget GTK does not have, so it is a build-time refusal on this surface, not a decoration;
- `icon`, `verb-icon`, `accel`, `use-markup`, `display-hint` stay best-effort decoration (0042 § 6) and
  are not drawn.

**`Gtk.PopoverMenu` standalone.** GTK's `GtkPopoverMenu` is a popover: `set_parent(widget)`, `popup()`,
`popdown()`, `menu-model`. A `PopupMenu` is exactly a menu anchored at a view, so the subset that maps
is the one with a parent: `popup()` shows it, `popdown()` dismisses it, `menu-model` as above. It is a
true subset: the same names and semantics, and the rest throws by name: `pointing_to`, `position`
other than the default, `has_arrow`, `autohide = false`, `add_child` (custom children) and `flags`
beyond nested. `Gtk.PopoverMenuBar` stays refused: Android has no menu-bar surface, a row of N
`PopupMenu`s is a design choice and not GTK's widget, and nothing in Learn6502 uses it. It can be added
later without rewriting anything.

### 3. The portable action subset

The registry moves from `nativescript-bridge/adwaita/src/widgets/actions.ts` into `@gjsify/adwaita-core`,
which reaches no DOM and no NativeScript. Each port exports it as the `Gio` members `SimpleAction` and
`SimpleActionGroup`, routed by `GI_RENDERERS` like `GObject` in ADR 0096, and supplies `parent(widget)`.
ADR 0098 § 1 owns `add_action`/`lookup_action`/`remove_action` on the application and windows and § 2
owns the walk to `app`; this ADR owns the widget side.

| GJS spelling | on the browser and NativeScript |
|---|---|
| `new Gio.SimpleAction({ name, enabled? })`, `connect('activate', …)`, `enabled`, `activate(param)` | implemented. `enabled = false` makes `activate` a no-op and the item insensitive |
| `Gio.SimpleActionGroup`: `add_action`, `lookup_action`, `remove_action` | implemented |
| `widget.insert_action_group(prefix, group)` | implemented on every widget; resolution starts at the widget, walks to the root, nearest group with the prefix wins |
| `win.` and `app.` | `win.` is the window's group; `app.` resolves through `window.application` (ADR 0098 § 2). No explicit `app` group is needed |
| `action-name`, `action-target` on `Gtk.Button`, `Gtk.ToggleButton`, `Gtk.MenuButton` items | implemented, same lookup |
| stateful action: `state` boolean or string, `change-state` (stage 3) | implemented with 0042's rule: boolean without target is CHECK, string with target is RADIO. `GLib.Variant` is only `new_boolean`, `new_string`, `get_boolean`, `get_string`; any other variant type is refused |
| `hidden-when: action-missing / action-disabled` | implemented through `resolveMenuItemState` |

**Popover resolution on the web.** Popover content lives in a layer outside the owner's subtree, so
resolution starts from the owning `MenuButton`, not the row. This is accepted. **Stage 1 is gated on a
conformance vector, run against GJS, that proves it**: an action inserted on an ancestor of a
`MenuButton` is found by its menu item, and a nearer group shadows a farther one. Stage 2 does not
start before that vector is green.

A missing action makes the item insensitive and `action-name` logs once, as GTK does. No group for the
prefix is not an empty group (0042 § 2): nothing is dimmed.

Refused by name, at registration or at the first resolution: an `action-name` or `action` without a
prefix; `Gio.PropertyAction`, `add_action_entries`, other `Gio.ActionGroup`/`ActionMap` implementations;
`parameter_type` checking beyond null-or-not.

### 4. Accelerators

Not here: ADR 0098 § 4 stage 1 owns `set_accels_for_action` (browser keydown listener, NativeScript
refusal). Until it lands the call throws rather than leaving a dead shortcut (ADR 0071 § 3). An item's
`accel` is decoration (0042 § 6) and is drawn where the surface draws one.

### 5. Proof

- `MENU_ACTION_VECTORS` in `@gjsify/adwaita-core/conformance`, run on the web driver, the NativeScript
  driver and GJS (GTK on a headless display). GJS is the oracle.
- Vectors: projection equals `fromGioMenu` of the `blueprint-compiler` output for the same `.blp`; a
  tap on `win.x` activates it once; `app.x` resolves through the Application; the popover-from-button
  resolution of § 3; a disabled action is dimmed (web) and shown disabled (NativeScript); a missing
  action is insensitive; a nearer group shadows a farther one; no group dims nothing; CHECK toggles
  and RADIO selects. Refusal vectors (unprefixed name, `custom`, a mixed-section radio, a
  `PopoverMenu` `pointing_to`) are subset-only and are not run on GJS.
- The `PopupMenu` mapping is verified on an Android device or emulator before the NativeScript cell
  says `implemented`; the pure half (model → group/item plan) is specced off-device like `menu-sheet.ts`.
- ADR 0093's table row for `menu` is corrected by the first PR; its gate applies: a claim needs a
  vector, a refusal must throw.

## Consequences

- Learn6502's `menu-button.blp` and its `win.`/`app.` actions run unchanged on the web and Android;
  the hand-written menus in its web and Android copies can go.
- The action registry is one class model for three targets; `actions.ts` on NativeScript shrinks to the door.
- NativeScript menus become anchored and native. `menu-sheet.ts` is replaced by a plan builder for
  `PopupMenu`; the submenu-as-second-sheet and omit-insensitive behaviour end.
- Refusals are named, so a component using `Gio.PropertyAction` or a mixed radio section fails at the
  build or registration, not at the tap.

## Alternatives rejected

- **Keep the `lost` entry and let each application set `menuModel` in code.** That is the second
  source ADR 0051 exists to remove.
- **Keep the `Dialogs.action()` sheet.** It is not anchored and cannot show a disabled row or a check;
  rejected by the maintainer.
- **Add an `enabled` or `checked` item field.** 0042 § 2: `Gio.Menu` cannot hold it.
- **Silently ignore accelerators or unsupported `PopupMenu` shapes.** A dead shortcut or a wrong
  radio group is an undiagnosable drop.

## What this does not decide

- `GLib.Variant` in general, and `Gio.Settings`/`Gio.PropertyAction`.
- NativeScript keyboard shortcuts, `Gtk.PopoverMenuBar`, and iOS.

## Implementation

Tracked in `status/open-todos/adwaita-core.md`. Stage 1: projection of `menus` and the inline value,
the 0093 row corrected, the differential vector and the popover-from-button vector. Stage 2: the
registry in `adwaita-core`, the web and NativeScript doors, `action-name` resolution, activation,
`PopupMenu` and `PopoverMenu`. Stage 3: state, check and radio. First consumer: Learn6502's `menu-button.blp`.
