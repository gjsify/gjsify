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

The attribute set is `refs/gtk/gtk/gtkpopovermenu.c:99-131` — its own `## Menu models`
list — enumerated so the claim is checkable:

| node | attributes |
|---|---|
| item | `label`, `use-markup`, `action`, `icon`, `verb-icon`, `hidden-when`, `custom`, plus `accel` and `id` |
| section | `label`, `display-hint`, `text-direction` |
| submenu | `label`, `icon`, `submenu-action`, `gtk-macos-special` |

Two of those are not in the popovermenu list and are here anyway. `accel` is read at
`gtkmenutrackeritem.c:731`, so the list is the incomplete one. `id` is **ours**, and it
survives because a `GMenuModel`'s attribute space is open — an attribute GTK does not
read, exactly like an application's own.

`target` has no field: it travels inside the detailed action name (§ 3), and GIO writes
it back out.

**The first cut of this ADR claimed "nothing was invented and nothing was left out" and
was wrong twice**: `submenu-action` (`gtkpopovermenu.c:106-107`, read at
`gtkmenutrackeritem.c:822` and `:1049`) and `gtk-macos-special` (`:130-131`, read at
`:761`) had no field, and both came back `null` through a measured GIO round trip. Both
are fields now. A completeness claim nothing enumerates is one nobody can check, which is
why the table is above and the round trip in `@gjsify/gtk-host`'s `menu.spec.ts` is what
holds it.

### 2. `enabled` and `checked` are NOT item fields — they come from the ACTION

This is the decision most likely to be "simplified" back into a bug, so it is stated
first among the divergences. Measured in `refs/gtk/gtk/gtkmenutrackeritem.c`:

- `sensitive` is the action's `enabled` flag (`self->sensitive = enabled`, c:332);
- `role` is RADIO when the item has a `target` and the action has a STATE, CHECK when
  the state is a boolean and there is no target (c:551-562);
- `toggled` compares the two;
- an item with no `action` attribute at all is SENSITIVE — C sets it explicitly in the
  else branch (c:591-595, the assignment at c:594) rather than leaving the field false.

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
so comparing a target against an action's state is a STRING comparison. It compares the
target's CONTENT, not its `GVariant` text — `app.v::list` and `app.v('list')` are the
same detailed action to GLib and must yield the same target here, so a quoted `(…)`
target is unquoted. For the same reason `AdwMenuAction.state` is the state's content
(`list`, `true`), NOT `variant.print(false)`, which would quote a string and leave every
radio row reading OFF.

What it does not close: WHITESPACE. `win.zoom(2)` and `win.zoom( 2 )` name the same
action to GLib and different targets to us, and a portable model with no `GVariant`
implementation cannot fix that. The GIO round trip NORMALISES both cases — a quoted
target comes back in the `::` form, and inner whitespace is gone — which is a
normalisation and not a loss, and `menu.spec.ts` pins both.

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

Four tiers, and the split is what keeps the refusal usable:

- **STRUCTURE** — items, sections, submenus, labels, actions — survives every LAYOUT
  limitation. A flat surface INLINES a section (a section is a visual grouping GTK itself
  draws inline, so a flat list loses a rule and no item) and OPENS a submenu as a second
  list (inlining one would offer items nobody asked for).
- **DECORATION** — `icon`, `verb-icon`, `accel`, `use-markup`, `display-hint` — is
  best-effort per surface. NativeScript's `action()` sheet renders text and draws none of
  it; refusing per decoration would fire on every well-formed menu and be switched off
  within a day.
- **AVAILABILITY** is the one place structure yields, and it yields to STATE rather than
  to layout. GTK and the browser DIM an insensitive item; a `Dialogs.action()` sheet has
  no disabled row at all, so NativeScript does not OFFER one — a row that can be tapped
  and does nothing is the one shape a reader cannot diagnose, and it is worse than a row
  that is absent. Stated here rather than left as a contradiction of the first bullet:
  the item is still in the model, and the same menu on the same device becomes visible
  again the moment its action is enabled.
- **`custom`** is refused. It names an application WIDGET (`gtk_popover_menu_add_child`),
  so a surface that ignored it would draw a BLANK ROW where a control belongs — the one
  drop a reader cannot diagnose. Refusing only the property setter left a `custom` item
  written in MARKUP drawing exactly that row, so both doors refuse.

**The two doors refuse differently, and the difference is which side can hear it.** A
property assignment is a CALL: `assertMenuRenderable(model, surface)` throws and the
caller can catch. An attribute is MARKUP, parsed by the browser — a throw from
`connectedCallback` is not delivered to whoever appended the element, it is reported as an
uncaught PAGE error, which nobody can handle and every other page-level assertion pays
for (measured: it broke `adwaita-upgrade-order.spec.ts`). So the attribute path refuses
the MENU — the element keeps none, and a menu-less dropdown is insensitive, which is
visible — and writes the reason to `console.error`.

A REFUSAL AND A TYPO ARE DIFFERENT THINGS, and only the second may be swallowed.
`parseMenuModel` stays total because malformed JSON is an author slip that must not stop
an element upgrading; `custom` is well-formed, deliberate, and unhonourable on that
surface.

`AdwMenuSurface` has exactly ONE capability field today, and that is deliberate: all
three surfaces nest and all three draw what they have a place for, so a second field
would be `true` everywhere and its refusal arm unreachable — the shape this repository
pays most for. A second field lands with the first surface that needs it.

For the same reason there is **no `ADW_MENU_SURFACE_GTK`**: GTK refuses nothing, so a
published constant for it would be a record whose only arm no caller can reach. The core
suite builds `{ name: 'gtk', custom: true }` inline to assert that a surface which CAN
host a custom child refuses nothing — that is the assertion's own input, not an API.

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

### 7a. GIO is the authority on an action name, and it must be ASKED

`g_menu_item_set_detailed_action` does not report a malformed name — it calls
`g_error()`, a SIGABRT no `catch` can see. Measured: `'app.x('`, `'win.zoom(qqq)'`,
`'app.a b'`, `''`, `'app.x)'`, `'app.x()'` and `'a.b(1,2)'` each end the process at exit
134, and every door into the model is documented as TOTAL — so a one-character slip in a
JSX attribute killed the process instead of drawing a menu.

`buildGioMenu` therefore validates with `g_action_parse_detailed_name`, which is the SAME
parser with an error return, and refuses with a `GtkHostError` naming the item and the
string. No second grammar is written: the `(…)` form's content is arbitrary `GVariant`
text, so a hand-rolled validator is exactly the trap. It is the shape
`err.missingConstructProp` already documents for `Adw.LayoutSlot` — refuse while a
refusal is still reportable.

`normalizeMenuModel` additionally drops `action: ''`, which is one abort the GTK path then
never has to refuse.

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

- **BREAKING.** Verified against the published 0.46.0 tarballs, so the migration list is
  what a consumer actually loses:

  | published as | in | becomes |
  |---|---|---|
  | `AdwMenuEntry` (type) | `@gjsify/adwaita-core` | `AdwMenuItem` — but see the row below |
  | `parseMenuEntries` | `@gjsify/adwaita-core` | `parseMenuModel` |
  | `SplitButtonState.activateMenuEntry(index)` | `@gjsify/adwaita-core` | `activateMenuItem(path)` |
  | **`AdwMenuItem` (type)** | `@gjsify/adwaita-web`, `@gjsify/adwaita-nativescript` | **the same NAME, an incompatible SHAPE** |
  | `menuItems`, `menu` (properties) | both renderers | `menuModel` |
  | `menu` (attribute) | `@gjsify/adwaita-web` | `menu-model` |

  The fourth row is the one that bites quietly: `AdwMenuItem` was an alias of the old
  four-field entry and is now the normalised item, which carries a required `kind`. A
  consumer's `const item: AdwMenuItem = { label: 'Save' }` stops compiling rather than
  going missing. **The migration is to stop annotating**: `menuModel` takes
  `AdwMenuInput`, where `{ label: 'Save' }` and `'Save'` are both legal, so the annotation
  that broke is one the new API does not need.

  Activation reports a `path` (`[1, 0]`) instead of an `index`, because a link is a model
  of its own and a flat index cannot name an item inside a submenu.
- **Two gallery refusals become snippets.** `Adw.SplitButton` and `Gtk.MenuButton` have
  Solid, Vue and React snippets, compiled and asserted against the real GTK tree by
  `showcases/gtk/adwaita-gallery-{solid,vue,react}` like every other block.
  `Gtk.DropDown` stays refused: a `Gtk.StringList` has had no portable form built for it,
  which is a different decision and this ADR does not make it.
- **The browser menu grew what it never had**: sections with a heading and a separator,
  submenus as popover pages with a back row, accelerators, and check/radio rows whose
  `role`/`aria-checked` come from the action state rather than from a field. Six new
  rules in `_popover.scss`, and the check mark among them is a DELIBERATE substitution:
  GTK draws `object-select-symbolic` and this port's icon set ships 42 glyphs, none of
  them a checkmark, so the tick is a rotated border and depends on no asset.
- **A defect in `writeProperty` came out with it, and shipped separately.** Removing ANY
  nullable property from a mounted widget did nothing: `set_property(name, null)` guesses
  `gpointer`, GObject logs a CRITICAL and keeps the old value, at exit 0. Measured on both
  an object and a string property. Its blast radius is every nullable property on every
  mounted widget across all four dialect adapters, which is wider than this ADR and
  bisectable on its own, so it is its own commit on its own branch rather than a passenger
  here.
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
  opening the door needs that probe first. It is shut LOUDLY: a string throws by name,
  because left to `normalizeMenuModel` it is merely "not an array" and the author gets an
  empty menu with no diagnostic at all.
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
   `<gtk-menu-button>`; six new popover-menu rules in `scss/_popover.scss` (separator,
   section title, accelerator, check/radio mark, submenu chevron, back row) plus the two
   nested `[aria-checked='true']` rules that draw the mark.
4. `@gjsify/adwaita-nativescript` — `widgets/menu-sheet.ts`, shared by `AdwSplitButton`
   and `GtkMenuButton`; a submenu opens a second sheet.
5. `@gjsify/gtk-host` — `src/menu.ts` (`buildGioMenu` / `fromGioMenu` /
   `requireDetailedAction`), the `coerce` branch, `WithPortableMenu<T>` on all three
   dialect surfaces.
6. `scripts/adwaita-gallery-trees.mjs` — two trees replace two refusals; the snippet
   generator emits object arrays and the probe driver reads the real `Gio.MenuModel`.
