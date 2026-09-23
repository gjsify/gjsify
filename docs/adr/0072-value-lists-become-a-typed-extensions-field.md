# 72. String lists and dialog responses become a typed `extensions` field

- Status: **Proposed**
- Date: 2026-09-23
- Deciders: Pascal Garber
- Related: [ADR 0051 (one authored tree, rendered)](0051-one-authored-tree-rendered.md),
  [ADR 0053 (Blueprint parsed in-repo)](0053-blueprint-parsed-in-repo.md),
  [ADR 0067 (the translatable marking becomes a field)](0067-the-translatable-marking-becomes-a-field.md),
  [ADR 0068 (style classes get a field)](0068-style-classes-get-a-field-both-spellings.md),
  [ADR 0071 (a slot is a placement)](0071-a-slot-is-a-placement-a-renderer-answers-to.md)

## Context

The projection (`projectToSharedNode`) drops two Blueprint extension blocks that the website
gallery needs:

- `Gtk.StringList { strings [ "a", _("b") ] }`, the model of every `Adw.ComboRow` and
  `Gtk.DropDown` example. It left as a `value-list` loss, and that loss was worse than most:
  the `GtkStringList` node survived with nothing in it, so the tree rendered an empty list
  and looked finished (`rules/21-value-array.blp`).
- `Adw.AlertDialog { responses [ cancel: _("Cancel"), delete: _("Delete") destructive ] }`.
  It left as a `responses` loss, so the dialog rendered without buttons
  (`rules/31-responses.blp`, `rules/52-response-flags.blp`).

A survey of the 91 tracked `.blp` files and the gallery `.mdx` sources shows which extensions
exist and which are needed:

| extension | `.blp` files | gallery need | decided here |
|---|---|---|---|
| `styles [ ]` | 9 | yes | already a field (ADR 0068) |
| `strings [ ]` | 1 | combo row, drop-down, preferences examples (4 pages) | **carried** |
| `responses [ ]` | 2 | alert dialog (2 pages) | **carried** |
| `menu { }` / `menu-model:` | 5 / 4 | menu button, split button (5 pages) | stays a loss |
| `layout { }` | 2 | none | stays a loss |
| `accessibility { }` | 3 | none | ADR 0069 |
| `widgets [ ]` | 2 | none | stays `value-list` |
| `items`, `marks`, `offsets`, `mime-types`, `patterns`, `suffixes` | 1 | none | stay losses |

Both carried kinds are lists of plain values, and GTK fills each through one public method:
`gtk_string_list_append` per `<item>` (`gtkstringlist.c`, `item_end_element`), and
`adw_alert_dialog_add_response` plus `set_response_appearance` / `set_response_enabled` per
`<response>` (`adw-alert-dialog.c`, `adw_alert_dialog_buildable_custom_finished`). A menu is
different: it is a second tree with sections, submenus and actions, usually declared as a
separate root and referenced by id, so it needs its own shape.

## Decision

### 1. One field, `extensions`, keyed by kind

```ts
extensions?: {
    strings?: { value: string; translatable?: { context?: string } }[];
    responses?: {
        id: string;
        label: string;
        translatable?: { context?: string };
        appearance?: 'suggested' | 'destructive';
        enabled?: boolean;
    }[];
};
```

One field rather than one per kind, because each field costs every restatement of the shape
(five `holds` copies, six `apart` deltas, `rebuild()`, stage A) and the next kind should cost
only its own key. `extensions` is Blueprint's own name for these blocks.

Each string keeps its `_()` marking beside it, in the `{ context? }` shape `translatable`
already uses for props (ADR 0067), so `xgettext`-style extraction still sees it. A response's
flags become the two attributes GtkBuilder writes for them: `destructive`/`suggested` is
`appearance`, `disabled` is `enabled: false`. `suggested disabled` sets both, so they are two
fields and not one state. Absence is the default everywhere: no empty list, no `enabled: true`.

### 2. What each renderer does

A renderer writes each kind through the door its widget already has for it, and refuses a
kind it cannot place. Refusing is required: dropping the items gives an empty list model or a
dialog without buttons, and both look finished.

| renderer | `strings` | `responses` |
|---|---|---|
| `adwaita-web` | a `strings` JSON attribute on `<gtk-string-list>`, which `<adw-combo-row>` and `<gtk-drop-down>` consume at their new `model` slot | `<adw-alert-response>` children, which `<adw-alert-dialog>` already consumes |
| `adwaita-nativescript` | the `{ strings }` construct bag of the `Gtk.StringList` value object, which `Adw.ComboRow` and `Gtk.DropDown` take at their new `model` builder slot | `add_response(id, label, { appearance, enabled })`; a dialog root builds through `buildDialog`, because this port's `Adw.AlertDialog` is not a `View` |
| `gtk-host` | refused | refused |

The web builder checks after mount that the element took what it was given: a string list
must have been consumed, and each response must read back with its label, appearance and
enabled state. The NativeScript builder refuses before construction: string-list items on a
widget, or on a value class with no `append`, and responses on a class with no
`add_response`. `gtk-host`'s conformance builder has no value-object path, so it
refuses any `extensions`; a GTK application loads the `.blp` through `Gtk.Builder`, which
fills both itself.

### 3. What stays refused

- **`menu`** (a root menu, or `menu-model:` pointing at one) stays a `menu` loss. It needs a
  tree shape of its own and id resolution across roots, which is a separate decision. It is
  the next candidate: five gallery pages use one.
- **`widgets [ ]`**, and a non-string item in any list, stay `value-list`. The first holds
  object references, and the reference compiler refuses the second.
- **`layout`**, **`items`**, **`marks`**, **`offsets`** and the three file-filter lists stay
  losses under their own names. No gallery page needs them.

The `responses` loss kind is removed: every `responses` block the parser accepts is now
carried, so declaring one is itself a failure.

### 4. Held against the oracle and against GTK

Stage D of `check-blueprint-corpus.mjs` gains an extensions arm, built like the marking and
style-class arms: it reads the golden's `<item>` elements inside a `GtkStringList` (only
there, because `Gtk.ComboBoxText`'s `items [ ]` writes the same elements and stays a loss) and
its `<response>` elements, and compares each with everything the oracle writes on it.

`VALUE_LIST_VECTORS` in `@gjsify/adwaita-core/conformance` holds four Blueprint sources and
what the built widget returns. The rows were measured with `Gtk.Builder` under GJS (GTK
4.22.5, libadwaita 1.9.3), and both renderers drive them through the real parser and
projection.

## Consequences

- Combo row, drop-down and alert dialog gallery blocks can be written once in Blueprint and
  rendered on the web and on NativeScript.
- `rules/21-value-array.blp`, `31-responses.blp` and `52-response-flags.blp` now project
  without loss.
- `SharedTreeNode` has a sixth optional field. Every restatement grew with it, and
  `check-shared-tree-shape.mjs` holds them.
- The web `model` slot means `<adw-combo-row>` and `<gtk-drop-down>` now bind slotted
  children. A plain child without `slot="model"` is still discarded at connect, as before.

## Alternatives rejected

- **The items as a prop** (`props.strings: "a\nb"`). `props` holds scalars, and a joined string
  cannot carry a marking per item. ADR 0068 rejected the same idea for style classes.
- **One top-level field per kind** (`strings`, `responses`). It doubles the restatement cost
  for no gain in meaning; the kinds never meet on one node.
- **Carrying menus now.** A menu is a tree, not a value list, and it is usually referenced by
  id from another root. Folding it into this field would force a nested shape into a field
  whose entries are flat.
- **Letting a renderer skip a kind it cannot place.** That is the silent empty list this ADR
  exists to remove.

## Implementation

One PR: the field and its restatements, the projection, the corpus expectations and the
stage-A and stage-D arms, the web and NativeScript builders with the `model` slots on both
list widgets, the `gtk-host` refusal, and `VALUE_LIST_VECTORS` driven by both renderers.
