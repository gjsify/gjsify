# 47. A numeric range is a value, and the value is `Gtk.Adjustment`

- Status: **Proposed**
- Date: 2026-09-05
- Deciders: Pascal Garber
- Related: [ADR 0004 (headless Adwaita core)](0004-headless-adwaita-core.md), [ADR 0027 (GTK host layer)](0027-gtk-host-layer.md), [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md), [ADR 0042 (portable menu model)](0042-portable-menu-model.md), [ADR 0046 (portable list model)](0046-portable-list-model.md)

## Context

ADR 0042 gave the MENU a portable value and ADR 0046 the LIST. This is the third, and it
is the smallest object of the three by far — six numbers — which is exactly why it survived
two rounds of convergence: nothing about `min`, `max` and `step` looks like a missing type.

They were four spellings of one thing:

| surface | how the range was written |
|---|---|
| `@gjsify/gtk-host` (GJS) | `adjustment: new Gtk.Adjustment({ lower, upper, stepIncrement, … })` |
| `@gjsify/adwaita-web` | `min` / `max` / `step` attributes |
| `@gjsify/adwaita-nativescript` | `min` / `max` / `step` properties |
| `@gjsify/adwaita-react-native` | `lower` / `upper` / `stepIncrement` props |

The fourth is the instructive one. It already used `Gtk.Adjustment`'s own field names — the
right vocabulary, in the wrong place: `Adw.SpinRow` has no `lower`, no `upper` and no
`stepIncrement`. It has an `adjustment`. So the React Native surface, which the property
ledger does not read, carried a divergence the ledger would have counted, and the two
surfaces it does read carried three entries each — `adw-spin-row.min`, `.max` and `.step`,
the largest single group in the ten property names `check-vocabulary-alignment.mjs` printed
as the remaining distance.

**The reach is wider than either sibling ADR's.** `Gio.MenuModel` is a writable property on
thirteen GTK widget interfaces and a list `model` on five. An adjustment property is on
**seven** — `AdwSpinRow`, `GtkSpinButton`, `GtkRange` (so `GtkScale`, which extends it),
`GtkScaleButton`, `GtkScrollbar`, `GtkScrolledWindow`, and `GtkScrollable`'s
`hadjustment`/`vadjustment` (so `GtkViewport`, which implements it) — read from
`packages/framework/gtk-host/src/generated/surface-data.mts`, whose provenance line names
the libraries it was generated from. In that file all seven declare the property THEMSELVES;
`GtkScale` and `GtkViewport` are the two that inherit it, from `GtkRange` and
`GtkScrollable`. Worth stating because `GtkScrollbar` and `GtkScrolledWindow` extend
`GtkWidget` directly in GTK 4, not the two types the GTK 3 hierarchy a reader remembers
would put above them. A numeric range is not a widget's private state on GTK: it is a value
the widget is HANDED.

And the arithmetic had already been copied. `AdwSliderRow` — the port's own widget, with no
libadwaita counterpart — carried four private fields and its own clamp-and-snap; the mock
in the NativeScript suite carried a THIRD copy of that same arithmetic, which meant those
assertions were measuring the mock rather than the widget.

## Decision

### 1. `packages/web/adwaita-core/src/adjustment.ts` owns the six numbers

```ts
interface AdwAdjustment { value; lower; upper; stepIncrement; pageIncrement; pageSize }
```

`Gtk.Adjustment`'s own property names, all six of them, because a value that carries five
of six is a type a scrollbar cannot use. `AdwAdjustmentInput` is any subset;
`normalizeAdjustment` fills it out and establishes the invariants (`upper >= lower`,
`pageSize >= 0`, `stepIncrement > 0`, `value` inside the range).

A bare number is deliberately NOT accepted as input: it would be the `value`, and `value` is
a property of its own on every widget that takes an adjustment — accepting it would make
`adjustment={3}` and `value={3}` two spellings of one write.

**The defaults are ours and the ADR says so.** A bare `Gtk.Adjustment` is 0…0 with a step of
0 — a spin row that cannot move. `SpinState` picked 0…100 step 1 long before this change,
both sibling renderers shipped it, and the React Native GTK arm adopted it rather than
shipping a widget whose omitted range meant one thing on a desktop and another on a phone.
The value moved into `ADW_ADJUSTMENT_DEFAULTS`; the choice did not change.

### 2. `pageSize` is carried because `set_value` is written in terms of it

The GIR doc for `Gtk.Adjustment.set_value` says the value is "clamped to lie between lower
and upper", and that "for adjustments which are used in a GtkScrollbar, the effective range
of allowed values goes from lower to upper - page_size". `adjustmentRange()` is that
sentence, floored at `lower` so a page larger than the range yields a point rather than an
inverted interval. For a spin row `pageSize` is 0 and the two ends coincide — which is what
the same doc asks for ("irrelevant and should be set to zero … e.g. in a GtkSpinButton").

Carrying it is what makes the value reusable by the five widgets this change does not port.
Leaving it out would have made every one of them a new type.

### 3. Two signals, because GTK has two and a renderer needs both

`SpinState` — the watchable adjustment — keeps `value-changed` (`subscribe`) and gains
`changed` (`subscribeChanged`), emitted in that order by `configure`: a listener that
re-reads the value must find the range it now lives in already current.

It earns its keep twice on arrival. `AdwSliderRow` re-sizes its track from it, which the
value signal cannot say; the React Native row holds the range in state from it, because its
two stepper buttons go `disabled` at the ends and a bound that moves WITHOUT moving the
value would otherwise leave them on the old ones.

The `interactive` flag on the value signal stays and has no GTK counterpart, for the reason
`rows.ts` already carried: on GTK the widget and the application are different objects
writing the same adjustment, and here a renderer is both.

### 4. No five setters, and one method that is not GTK's

`gtk_adjustment_set_lower`, `set_upper` and the rest exist in C because there is no record
literal there. Here the whole range arrives as one value, so `configure` — whose own
documented reason is that it compresses the notifications "into one" — is the whole of the
write surface. Unwritten fields keep what the state holds, which is what makes attribute
ORDER irrelevant in markup.

`setValueInteractive` has no GTK counterpart and is the drag: `increment`/`decrement` move
BY the step and a dragged thumb lands wherever the finger left it. `ComboState.select` is
the same pair on the same reasoning — one method per caller rather than a flag every caller
must remember.

`snapAdjustmentValue` is a FUNCTION and not a mode, because only one renderer needs it. It
is `snap-to-ticks`' arithmetic ("erroneous values are automatically changed to the nearest
step"), counted from the LOWER bound: `[1, 10]` step 3 has ticks at 1, 4, 7, 10 and not at
3, 6, 9.

### 5. One name on every surface: `adjustment`

ADR 0034 clause 1 decides it — `Adw.SpinRow:adjustment` is the GObject property's own name.
`min`/`max`/`step` are gone from the browser element (attribute AND property) and from both
NativeScript rows; `lower`/`upper`/`stepIncrement` are gone from the React Native props.
**No alias**, on the precedent this repository set for the four clause-1 renames and the two
model convergences: an entry that stays in the ledger is a distance that never closes.

In markup the value is JSON, which is the door `<adw-combo-row model=…>` already opens:

```html
<adw-spin-row title="Font size" value="16" adjustment='{"lower":0,"upper":100}'></adw-spin-row>
```

**The markup door yields a PARTIAL**, and that is load-bearing rather than tidy: a door that
answered with a whole adjustment would carry `value: 0` into every write and silently reset
the row, which is the attribute-ordering hazard `spin-row.gtk.tsx` already records for props.

**The markup door needed a word the gates did not have.** `attributeKind()` classified a
setter's declared type as `number`, `boolean`, `string` — or `null`, meaning "an XML
attribute cannot carry this". `AdwAdjustmentInput | string` answered `null`, so the setter
landed in the UNCARRYABLE bucket and no rule looked at it again, while
`check-generated-website-data.mjs` demanded the whole gallery block be declared a refusal.
Both were wrong in the same way: an attribute CAN carry an object, as the JSON text a door
parses, and that is a third kind rather than an absence. It is now `json`, with
`JSON_DOORS` naming the parsers and `jsonDoors()` verifying each still takes a string and
still cannot throw — the shape `STRING_TOLERANT` already had.

What opts a setter in is its own declared annotation: `<Something> | string` says the
attribute spelling exists. `AdwComboRow.model` is annotated `AdwListModelInput`, which
RESOLVES to a union containing `string` — and a bare string there is one ITEM, not JSON. So
the test reads the setter's annotation rather than the resolved alias, which is what keeps
the two apart. The template side is checked by CONTENT rather than spelling: a `json`
attribute must be a string that parses to a plain object, so an `adjustment='{"lower":1}'`
that stopped being JSON fails instead of silently authoring nothing.

**A STORY CONTROL keeps `min`/`max`/`step`, and that is not an inconsistency.** Those are
`adw_spin_row_new_with_range`'s parameter names — GTK's own convenience constructor, which
the GTK storybook calls — so the three numbers are the AUTHOR's vocabulary and the
adjustment is the widget's. Both storybook control builders now carry the map between them
in one line.

### 6. `AdwSliderRow` converges too, though it is a declared `own`

libadwaita has no `AdwSliderRow`, so the WIDGET is the port's own and stays declared in
`NS_WIDGET_ALIGNMENT`. Its RANGE is not: on GTK a `Gtk.Scale` is a `GtkRange`, and a
`GtkRange` is handed a `Gtk.Adjustment`. It composes `SpinState` now and its four private
fields, its clamp and its snap are gone — as is the third copy of that arithmetic in the
NativeScript suite's mock, which now composes exactly what the widget composes.

### 7. The GTK edge is built here, in the one file that may have it

`@gjsify/adwaita-react-native`'s `spin-row.gtk.tsx` turns the portable value into a real
`Gtk.Adjustment`. That is the seam ADR 0046 § 7 left unbuilt for the list, and it is
buildable here for a reason that is specific rather than lucky: the React Native package
already has a GTK arm importing `gi://`, so the edge needed no new dependency in
`@gjsify/gtk-host`. What is NOT built is a `coerce` branch in the host itself — a caller
writing `<adw-spin-row adjustment={…}>` in gtk-host JSX still hands a real `Gtk.Adjustment`.
That is the same open item ADR 0042 § 7 and ADR 0046 § 7 name, now with a third value
waiting on it, and `status/open-todos.md` carries it.

## Consequences

- **BREAKING**, on four published packages:

  | published as | in | becomes |
  |---|---|---|
  | `SpinState.setMin` / `setMax` / `setStep` | `@gjsify/adwaita-core` | `configure({ lower, upper, stepIncrement })` |
  | `SpinState.min` / `max` / `step` | `@gjsify/adwaita-core` | `adjustment.lower` / `.upper` / `.stepIncrement` |
  | `min` / `max` / `step` (attribute + property) | `@gjsify/adwaita-web` `<adw-spin-row>` | `adjustment` (JSON attribute, object property) |
  | `min` / `max` / `step` (property) | `@gjsify/adwaita-nativescript` `AdwSpinRow`, `AdwSliderRow` | `adjustment` |
  | `lower` / `upper` / `stepIncrement` (props) | `@gjsify/adwaita-react-native` `AdwSpinRow` | `adjustment` |

  `SpinState` keeps its name and its import path: it moved from `rows.ts` to
  `adjustment.ts`, which `rows.ts` re-exports.

- **Two React Native divergences retire, and one of them was a defect.** The README named a
  stream — `onNotifyValue` reporting `100, 200, 250` where GTK reported `250` — produced by
  writing three bounds one at a time through a momentarily INVERTED range. The range is one
  value now, written in one `configure` together with the value, and both halves notify
  exactly once. The other retired entry is the vocabulary itself.

- **Snapping answers a TICK, which the arithmetic it replaced did not.** `AdwSliderRow`'s
  `_snap` clamped the VALUE after rounding, so an upper bound off the grid was returned as
  itself: `[0, 10]` step 4 answered `10`, two off the grid `0, 4, 8`, from a function whose
  whole contract is "the nearest step". `snapAdjustmentValue` clamps the tick INDEX instead.
  It also re-snaps when a bound MOVES, which the old setters did (`this.value = this._value`
  at the end of each) and the first version of this change dropped — invisible to a suite
  that writes the range before the value, and caught by driving the other order.

- **An unwritten value follows the bottom of the range, until one is written.** Clamping the
  default `0` into a range that excludes zero lands on whichever end is nearer:
  `adjustment='{"lower":-100,"upper":-50}'` opened at **-50**, the maximum, from an author
  who wrote no value at all. `SpinState` now knows whether a value has ever been written; an
  unwritten one follows the lower bound, a written one RE-CLAMPS as documented. The two are
  different rules and were indistinguishable before.

- **A latent clamp defect goes with it.** `SpinState` coerced a non-finite value to 0 before
  clamping, which is harmless only while 0 is inside the range: on `[-5, -1]` a `NaN` write
  clamped to `-1` — the MAXIMUM. `NaN` lands on the lower bound now, and `±Infinity`, which
  carries a direction, clamps to the bound it is heading for.

- **A blind spot in two gates closes with it.** `attributeKind()` had no word for an
  attribute carrying an OBJECT, so `AdwSpinRow.adjustment` was counted as un-carryable and
  the gallery block was demanded as a refusal. The `json` kind is that word; removing the
  `parseAdjustment` call from the setter now reddens `check-nativescript-xml-doors.mjs`
  with the sentence that names it, which is the A/B this arm was written against.

- **Three vocabulary-ledger entries retire.** The distance
  `check-vocabulary-alignment.mjs` prints goes from ten property names to seven.

- **The conformance tables are driven by both renderers**, which is what makes "the same
  range means the same thing everywhere" a test rather than a claim:
  `ADJUSTMENT_AUTHORED_VECTORS` and `ADJUSTMENT_PARSE_VECTORS` run at the core, through the
  browser element and its markup door, and through what the NativeScript widgets compose;
  `ADJUSTMENT_SNAP_VECTORS` at the core and on NativeScript, which is where the only slider
  is.

- **What is NOT ported**: `GtkSpinButton`, `GtkScale`, `GtkScrollbar`, `GtkScrolledWindow`,
  `GtkScaleButton` and `GtkScrollable` have no widget on any renderer here, so nothing about
  them is decided —
  only that the value they would take already exists. `climb-rate`, `numeric`,
  `update-policy`, `wrap` and `digits` are ROW properties rather than adjustment ones and
  are untouched; `snap-to-ticks` is present as arithmetic and not as a widget property,
  because no widget here exposes it.
