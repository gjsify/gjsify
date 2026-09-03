# 42. A menu is a value: `GMenuModel`'s own shape, portable across every surface

- Status: **Proposed**
- Date: 2026-09-04
- Deciders: Pascal Garber
- Related: [ADR 0004 (headless Adwaita core)](0004-headless-adwaita-core.md), [ADR 0027 (GTK host layer)](0027-gtk-host-layer.md), [ADR 0033 (declarative templates preferred)](0033-declarative-templates-preferred.md), [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md)

## Context

ADR 0034 unified the widget VOCABULARY: `Adw.SplitButton` is the same name on every
surface. The DATA those widgets consume was not unified, and the menu was the worst of
it — three surfaces, three shapes, one of them absent:

- **GJS/GTK**: `new Gio.Menu()` plus `menu.append(label, action)`, handed over as
  `menuModel`. Imperative, and the only complete one.
- **NativeScript**: `button.menu = ['Save as…', 'Export', 'Print']` — a plain string
  array, which cannot carry an action, an icon, a section or a submenu. A menu written
  for GTK could not be moved to it at all.
- **Browser**: a JSON `menu` attribute of `{label, action?, id?, icon?}` on
  `<adw-split-button>`, and a SECOND, weaker parser on `<gtk-menu-button>` until #1191.
  Neither drew a section, a submenu, an accelerator or a check.
- **Solid / Vue / React**: **nothing.** The website gallery recorded the reason for
  `Adw.SplitButton` and `Gtk.MenuButton` in the same words — *"its menu is a
  `Gio.MenuModel`, built imperatively"* — and a reader saw two blocks with no snippet.

The measurement that made this the next thing to fix: `Gio.MenuModel` appears **26
times** across the renderers, more than any other Gio type; of the gallery's 19 refused
framework snippets, `MenuModel` was the named reason for two and "imperative" for three
more. A `GMenuModel` is a GObject with no literal spelling, so a declarative dialect had
nothing to write — not a gap in the adapters, a gap in the VALUE.

## Decision

### 1. There is one portable menu model, and it mirrors `GMenuModel`

`@gjsify/adwaita-core` gains `menu.ts`: a plain-data tree of three node kinds, which are
`GMenuModel`'s own two LINKS plus the plain ITEM.

```ts
type AdwMenuModel = readonly AdwMenuNode[];
type AdwMenuNode = AdwMenuItem | AdwMenuSection | AdwMenuSubmenu;
```

Every item attribute is one `GtkPopoverMenu` documents itself as reading — `label`,
`action`, `icon`, `verb-icon`, `accel`, `hidden-when`, `custom`, `use-markup` — plus
`id`, which is ours. A section carries `label`, `display-hint`, `text-direction`; a
submenu carries `label` and `icon`. Nothing was invented and nothing was left out.

The shape was **not** designed from taste. It is `refs/gtk/gtk/gtkpopovermenu.c`'s own
`## Menu models` attribute list, and the vectors cite it line by line.

### 2. `enabled` and `checked` are NOT item fields — they come from the ACTION

This is the decision most likely to be "simplified" back into a bug, so it is stated
first among the divergences. Measured in `refs/gtk/gtk/gtkmenutrackeritem.c`:

- `sensitive` is the action's `enabled` flag (`self->sensitive = enabled`, c:333);
- `role` is RADIO when the item has a `target` and the action has a STATE, CHECK when
  the state is a boolean and there is no target (c:551-562);
- `toggled` compares the two;
- an item with no `action` attribute at all is SENSITIVE — C sets it explicitly in the
  else branch (c:588-591) rather than leaving the field false.

So an item field `enabled: false` would be a field no `Gio.Menu` can hold: converting
such a model to GTK would DROP it, silently, which is the exact failure this design
exists to prevent. Instead the action's state is a SECOND input,
`AdwMenuActions` — the portable stand-in for what a `GActionGroup` publishes — and
`resolveMenuItemState(item, actions)` folds the two as C does, `hidden-when` included.

**No action group is not an empty one.** `{}` is a group that knows the action is
missing (so the item is insensitive); `undefined` is a surface with no group to consult
(so nothing is known and nothing is dimmed). Collapsing the two made every actioned item
in the browser renderer arrive `disabled` — measured on the split button's own suite
while this branch was being written, because the common case is an application that
dispatches its own actions and declares none.

### 3. An action is one DETAILED name, not a name plus an encoded target

`action: 'app.view::list'`, which is `g_menu_item_set_detailed_action`'s own input and
`g_action_parse_detailed_name`'s own text form. GIO does the splitting on the way in and
`fromGioMenu` reassembles it on the way out, so a portable model never has to invent a
JSON encoding for a `GVariant` — the place it would otherwise have to guess `int32` from
a JS number.

The cost is stated where it lives: `parseDetailedAction` does NOT parse the `GVariant`,
so comparing a target against an action's state is a STRING comparison. Exact for the
string and boolean targets a menu actually uses; not canonicalising, so `app.zoom(2)`
and `app.zoom( 2 )` name the same action to GLib and different targets to us.

### 4. Input widens, the stored value is normalised

`normalizeMenuModel` takes what an author writes and answers the tree every renderer
walks — the `AdwComboOptionInput` → `AdwComboOption` pattern this workspace already has.
A **bare string** is a label-only item, a `section:` or `submenu:` key IS the link, and
an already-normalised node is legal input, which makes the function IDEMPOTENT. That
last part is not decoration: a renderer hands its own model back in (`setMenuModel(
state.menuModel)`), and a normalised section carries its children under `items` rather
than `section`.

The normaliser is TOTAL — the input reaches it from author markup and a typo must not
take the widget down. It throws nothing; the loud half is § 6.

### 5. The bare `string[]` STAYS — as the model's own shorthand, not as a second spelling

The NativeScript array form is a published API, and ADR 0034 spent this cycle removing
second spellings, so this needed deciding rather than assuming.

It stays, and the reason it is not what ADR 0034 removed: that ADR removed two NAMES for
one widget. This is one VALUE TYPE with a shorthand for its commonest case, exactly as
`AdwComboOptionInput` accepts a bare string for `{value, label}`. And the shorthand is no
longer NativeScript's private shape — it widens INTO the union, so `['Save as…']` is now
legal on the browser, on GTK and in a JSX attribute too. The surfaces converge by the
shorthand becoming portable, not by one of them keeping a private door.

What DID go is the third spelling: the browser's `{label, action?, id?, icon?}` entry
type (`AdwMenuEntry`) and its `parseMenuEntries`. One type, one parser.

### 6. What a surface cannot draw is declared; `custom` is refused by name

Three tiers, and the split is what keeps the refusal usable:

- **STRUCTURE** — items, sections, submenus, labels, actions — is portable and never
  lost. A flat surface INLINES a section (a section is a visual grouping GTK itself
  draws inline, so a flat list loses a rule and no item) and OPENS a submenu as a second
  list (inlining one would offer items nobody asked for).
- **DECORATION** — `icon`, `verb-icon`, `accel`, `use-markup`, `display-hint` — is
  best-effort per surface. NativeScript's `action()` sheet renders text and draws none of
  it; refusing per decoration would fire on every well-formed menu and be switched off
  within a day.
- **`custom`** is refused. It names an application WIDGET (`gtk_popover_menu_add_child`),
  so a surface that ignored it would draw a BLANK ROW where a control belongs — the one
  drop a reader cannot diagnose. `assertMenuRenderable(model, surface)` throws at the
  ASSIGNMENT, naming every refusal rather than the first.

`AdwMenuSurface` has exactly ONE capability field today, and that is deliberate: all
three surfaces nest and all three draw what they have a place for, so a second field
would be `true` everywhere and its refusal arm unreachable — the shape this repository
pays most for. A second field lands with the first surface that needs it.

### 7. `@gjsify/adwaita-core` is the home, and `@gjsify/gtk-host` now depends on it

Confirmed rather than assumed. The core is the shared answer both non-GTK renderers are
already held against, it has the conformance-vector machinery per module, and
`AdwMenuEntry` already lived there. What is new is the third consumer: `gtk-host` (tier
3) gains a `dependencies` edge on `adwaita-core` (tier 2) — allowed by ADR 0003's
direction rule, and anticipated by ADR 0004's own Consequences, which names "GTK-side
helpers" as a future user.

The SHAPE is shared; the CONSTRUCTION cannot be, because ADR 0015 forbids the headless
core a `gi://` import. So `gtk-host/src/menu.ts` owns `buildGioMenu` — and its inverse
`fromGioMenu`, which exists so that "the model maps onto `Gio.Menu` losslessly" is a
measurement (every vector round-trips) instead of a sentence in this file.

### 8. `coerce` is the seam, so a JSX attribute can be a menu

`props.ts`'s `coerce` gains a `GMenuModel` branch: a property whose ParamSpec type is a
`GMenuModel`, authored as an ARRAY, becomes a real `Gio.Menu`. Same seam and same reason
as the enum branch beside it — GObject cannot store what was written, and the ParamSpec
is what says so. An actual `Gio.MenuModel` passes straight through, so every existing
imperative GJS application is untouched.

The type half is `WithPortableMenu<T>` in `attrs.ts`, applied by all three dialect
surfaces. It is a NAME LIST of the six `GMenuModel`-typed prop spellings rather than a
type test, because `Gio.MenuModel extends NonNullable<T[K]>` is also true for any
property typed as a wider GObject.

### 9. One name on every surface: `menuModel`

The property is `menuModel` on the browser elements, on the NativeScript widgets and in
`gtk-host`; the browser attribute is `menu-model`. That is the GObject property's own
name, so ADR 0034 clause 1's rule — name it for the library that owns the GType — decides
it. It replaces `menuItems` (browser, NativeScript menu button), `menu` (NativeScript
split button) and the `menu` attribute.

## Consequences

- **Breaking, and small.** `AdwMenuEntry`, `parseMenuEntries` and
  `SplitButtonState.activateMenuEntry(index)` are gone; the renderers' `menuItems` /
  `menu` properties and the `menu` attribute are `menuModel` / `menu-model`. Activation
  reports a `path` (`[1, 0]`) instead of an `index`, because a link is a model of its own
  and a flat index cannot name an item inside a submenu. The release train carries it.
- **Two gallery refusals become snippets.** `Adw.SplitButton` and `Gtk.MenuButton` have
  Solid, Vue and React snippets, compiled and asserted against the real GTK tree by
  `showcases/gtk/adwaita-gallery-{solid,vue,react}` like every other block.
  `Gtk.DropDown` stays refused: a `Gtk.StringList` has had no portable form built for it,
  which is a different decision and this ADR does not make it.
- **The browser menu grew what it never had**: sections with a heading and a separator,
  submenus as popover pages with a back row, accelerators, and check/radio rows whose
  `role`/`aria-checked` come from the action state rather than from a field.
- **A defect in `writeProperty` came out with it.** Removing ANY nullable property from a
  mounted widget did nothing: `set_property(name, null)` guesses `gpointer`, GObject logs
  a CRITICAL and keeps the old value, at exit 0. Measured on both an object and a string
  property. `null` now takes the accessor route arrays already took, for the same reason.
  It was invisible because no earlier test removed an object-valued prop after mount.
- **Cost.** One more module in `adwaita-core` (39 → 40) with its conformance table, one
  in `gtk-host`, one dependency edge, and a `PopoverMenuView` shared by the two browser
  elements that previously built their own rows.

## What this does NOT decide

- **`Gtk.StringList` / `Gio.ListModel`.** `Gtk.DropDown` and `Adw.ComboRow` take a list
  model and stay refused in the gallery. The same treatment may suit them; nothing here
  argues it, and `normalizeComboOptions` already covers the two renderers that have one.
- **Action DISPATCH.** The model names actions; it does not invoke them. The browser and
  NativeScript renderers still emit an activation event carrying the detailed action, and
  what an application does with it is its own business. A portable `GActionGroup` is a
  separate question.
- **The NativeScript XML door.** `menuModel` deliberately does NOT accept a JSON string,
  although NativeScript's Builder writes an XML attribute straight onto the property and
  it would therefore work. The gallery probe that would have to prove it compares a
  read-back by IDENTITY (`showcases/dom/adwaita-gallery-nativescript/app/gallery-page.ts`),
  which no structured value can satisfy — so the two NativeScript refusals stand, and
  opening the door needs that probe first.
- **Pango markup on the web.** `use-markup` round-trips and the browser renderer shows
  the label verbatim. Handing author markup to `innerHTML` would be an injection door in
  a renderer that has no other one.
- **`display-hint` rendering.** A section that asks to be drawn as a row of icon buttons
  is carried and reaches GTK; the browser and NativeScript renderers draw an ordinary
  list. Decoration, per § 6.

## Implementation

1. `packages/web/adwaita-core/src/menu.ts` — the model, the normaliser, the flattener,
   the action-state fold, the refusal; `conformance/menu.ts` — six vector tables.
2. `SplitButtonState` stores an `AdwMenuModel` and activates by path.
3. `@gjsify/adwaita-web` — `PopoverMenuView`, shared by `<adw-split-button>` and
   `<gtk-menu-button>`; the four new popover-menu rules in `scss/_popover.scss`.
4. `@gjsify/adwaita-nativescript` — `widgets/menu-sheet.ts`, shared by `AdwSplitButton`
   and `GtkMenuButton`; a submenu opens a second sheet.
5. `@gjsify/gtk-host` — `src/menu.ts` (`buildGioMenu` / `fromGioMenu`), the `coerce`
   branch, `WithPortableMenu<T>` on all three dialect surfaces.
6. `scripts/adwaita-gallery-trees.mjs` — two trees replace two refusals; the snippet
   generator emits object arrays and the probe driver reads the real `Gio.MenuModel`.
