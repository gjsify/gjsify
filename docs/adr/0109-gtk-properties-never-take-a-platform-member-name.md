# 109. A GTK property never takes a platform member's name as a JS accessor

- Status: **Proposed**
- Date: 2026-10-13
- Deciders: Pascal Garber
- Related: `packages/nativescript-bridge/adwaita/src/widgets/shadowed-properties.ts` (the table and
  the router); `scripts/check-gtk-host-member-clashes.mjs` (the gate);
  `scripts/generate-nativescript-member-snapshot.mjs` (the two ledgers it reads);
  `tests/e2e/consumer-types-adwaita` (the consumer type check); ADR 0096 (the GObject door)

## Context

A port widget is a GTK widget and a platform object at once, and the two vocabularies overlap.
`AdwSplitButton:direction` is a `Gtk.ArrowType`; `ViewCommon.direction` is NativeScript's CSS layout
direction. `AdwBottomSheet:modal` is the scrim flag; `ViewCommon.modal` is the view a page was shown
modally from, getter-only. `GridLayoutBase.rows`/`.columns` are the track specs; `AdwDataGrid` used
the same names for its data.

The NativeScript port re-declared all four as JS accessors. Every consumer that compiles our
`lib/types` without `skipLibCheck` got TS2416, and `tests/e2e/consumer-types-adwaita` listed them as
`KNOWN_GAPS`. At runtime the accessor took the name away from NativeScript's own machinery: the
layout pass reads `direction`, and `grid.rows = 'auto,*'` stopped meaning a track spec. A fifth
clash, `AdwToggle.name`, came from our own `GtkWidgetLayoutMembers.name` (a `string`) meeting a
`string | null` getter. Nothing measured the overlap, so the next one would have shipped the same way.

## Decision

1. **The rule.** A port class never declares a JS accessor under a name its platform base already
   declares. The GTK property keeps every door GJS has that is not the accessor: `get_<p>()` /
   `set_<p>()`, `get_property` / `set_property('<p>')`, `notify::<p>`, the construct-props bag, and a
   Blueprint or `.ui` `<property name>`. The builder and the bag route the name to the verb. This is
   a true subset of GJS: `button.set_direction(Gtk.ArrowType.UP)` runs verbatim, while
   `button.direction = …` reaches the platform member, as on any other view.
2. **One table.** `SHADOWED_PROPERTIES` in `widgets/shadowed-properties.ts` decides each name:
   - **routed**: the port implements the property behind the verbs (`AdwSplitButton.direction`,
     `AdwBottomSheet.modal`, `AdwDataGrid.rows`/`columns`);
   - **refused**: the port does not implement it, and a write is an error that names the platform
     member (`GtkWindow.modal`, `GtkMenuButton.direction`, `GtkEntry.visibility`,
     `GtkWidget.css-classes`);
   - **shared** (`SHARED_PROPERTIES`): the platform member means the same thing, so it is the door
     (`margin-top`, `margin-bottom`, `opacity`, `orientation`).
   `gtkPropertyDoor` is the one router: the builder, `applyConstructProps`, `get_property` /
   `set_property` and `bind` all go through it.
3. **The gate measures, it does not trust.** `scripts/check-gtk-host-member-clashes.mjs` intersects
   every port class's GTK side (GIR properties of its GType, its own accessors, the shadowed keys of
   its `ConstructProps<Self, {…}>` bag) with the members its platform base declares. The member list
   is read from `@nativescript/core`'s own typings by the TypeScript checker into
   `status/nativescript-base-members.json`; the gate itself runs on plain Node with no install. The
   measured set must equal the table's keys, a routed class must have both verbs and no accessor on
   its chain, and the NativeScript XML writer in `adwaita-core/src/markup.ts` must refuse exactly the
   shadowed names.
4. **The web side is measured the same way**, against `HTMLElement` members read from TypeScript's
   `lib.dom.d.ts` into `status/html-element-members.json`. Five names overlap (`title`, `attributes`,
   `prefix`, `popover`, `id`), and each is recorded with its reason in the gate. The four NativeScript
   names are not `HTMLElement` members, so `adwaita-web` keeps its accessors and offers the verbs too
   (`<adw-data-grid>`, `<adw-bottom-sheet>`), so one code-behind runs on both.
5. **`AdwToggle.name` is not a platform clash.** Its getter returns `string` (`''` when unset), as the
   layout mixin declares, and the toggle group maps `''` back to `null`.

## Known deviations

- **NativeScript XML has no spelling for a shadowed name.** `Builder` assigns an attribute as
  `instance[name] = value`, so `<adw:BottomSheet modal="false">` reaches `ViewCommon.modal`. The XML
  writer refuses such a tree, and the gallery's bottom sheet now relies on the `modal` default
  (`true`, as in libadwaita). Set the value from Blueprint, a `.ui` file, or the verb.
- **`Gtk.Widget.get_direction` is shadowed on `AdwSplitButton`**, returning a `Gtk.ArrowType` instead
  of a `Gtk.TextDirection`. GJS does the same.
- **On web, `title` is also HTML's advisory tooltip.** A titled element shows a native tooltip on
  hover.

## Consequences

- `KNOWN_GAPS` in the consumer type check is empty; the port's typings compile without
  `skipLibCheck`.
- Code that wrote `sheet.modal`, `button.direction`, `grid.rows` or `grid.columns` on NativeScript
  must call the verbs. Code that wrote `grid.rows = 'auto,*'` on a plain `GridLayout` keeps working.
- A new GTK property whose name lands on a platform member fails CI until the table decides it.
- Bumping `@nativescript/core` means regenerating the ledger; a member it adds can surface a new
  clash in the gate.
