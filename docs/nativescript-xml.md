# NativeScript bridge — XML inflation (the two doors)

> Detail for [packages/nativescript-bridge/AGENTS.md](../packages/nativescript-bridge/AGENTS.md).
> A map, not a second copy: each mechanism's reasoning lives in the file that enforces
> it, and this page says which file that is. What it owns outright is the shape of the
> problem — because both doors fail SILENTLY, and a reader who has not been told that
> will read "it renders" as "it works".

## Getting the widgets into a template at all

Two routes, and only one of them exists in a plain app. `registerAdwaitaElements()`
registers every element in the `ELEMENTS` map with the `registerElement` global — which
`@nativescript/core` does not provide; it comes from a framework integration
(`@nativescript/angular`, `nativescript-vue`), so in a plain Vite-built app the call is a
no-op. A plain XML app uses the `xmlns="~/…"` barrel instead and needs no registration.

Only `View` subclasses are in that map. `AdwAlertDialog` extends `Observable` and
`AdwToast` is a plain value class, so neither is an element in any dialect — a toast is
raised by calling `showToast()` on an `AdwToastOverlay`, which IS a `View` and IS in the
map.

## The two doors

Once a widget is reachable, NativeScript reaches INTO it through exactly two doors, and
**neither one raises anything when it goes wrong**. A template with a dead attribute and
a template with a live one render the same way, at exit 0.

### Door 1 — an attribute, which is always a string

`ui/builder/component-builder`'s `setPropertyValue` ends in `instance[name] = value`.
There is no conversion for a plain accessor; only a NativeScript `Property` object carries
a `valueConverter`, and these widgets are plain classes. So a setter declared
`number` or `boolean` is handed the STRING.

**The rule.** Every non-string setter on a class the `ELEMENTS` map offers for XML use
goes through `widgets/xml-values.ts` — `xmlNumber` / `xmlBoolean`.

**Where the reasoning is.** `widgets/xml-values.ts`'s own header carries the four
measured shapes (a validating setter substituting its default, a state machine taking
`'3'` to 0, `!!'false'` being true, and `'true'` working by accident — which is why this
is a rule and not four repairs).

**The exception, and it is LOOSER rather than missing.** `resolveSpinnerSize` and
`normalizeClampSize` in `@gjsify/adwaita-core` already take `number | string` and
`Number.parseFloat` it, so `size="24px"` and `maximum-size="50%"` are lengths. Wrapping
those in `xmlNumber` swaps `parseFloat` for `Number` and both fall back to the default —
that regression shipped once and is now refused by name.

### Door 2 — a child, which lands where the widget lets it

`LayoutBaseCommon._addChildFromBuilder(name, view)` **ignores `name`** and calls
`addChild`. A composed widget builds its own internal boxes in its constructor, so the
inherited default drops an XML child into the layout's first cell — on top of whatever is
already there.

**The rule.** A widget with slots overrides `_addChildFromBuilder` and resolves the name
through `widgets/builder-slots.ts`. A widget with ONE destination may override `addChild`
instead (`AdwWrapBox` does) — but only the named door can hear a slot, so a
`<Parent.slot>` child needs `_addChildFromBuilder`.

**Where the reasoning is.** `widgets/builder-slots.ts`'s header, including what was
measured on an Android emulator when the default was in force: two toolbar-view bars
painting over each other at row 0, a header bar with an empty `startBox`, a clamp whose
`child` stayed null so it never allocated.

## The trap next door — a getter that shadows a setter

`GridLayoutBase.rows` and `.columns` are **setter-only** (their getters are
`rowsInternal` / `columnsInternal`). A getter of either name on a subclass shadows the
setter: the property descriptor then carries `set: undefined`, and `widget.rows = 'auto,*'`
throws in strict mode — which every NativeScript bundle is. It breaks callers that never
touch XML, which is why it belongs on this page rather than only in a gallery's notes.

A class that declares **both halves** has taken the name over deliberately and answers the
assignment itself; `AdwDataGrid` owns `rows` and `columns` as its data, and giving up
GridLayout's track spelling is the documented trade.

## What holds all of it

| | scope | file |
|---|---|---|
| both rules, package-wide | all XML-offered classes and their ancestors | `scripts/check-nativescript-xml-doors.mjs` |
| the shared reader | one parser, so the two gates cannot disagree | `scripts/nativescript-xml-doors.mjs` |
| the website gallery's templates | the 28 templates the docs ship | `scripts/check-generated-website-data.mjs` |
| the run | every gallery template inflated on a device | [`showcases/dom/adwaita-gallery-nativescript`](../showcases/dom/adwaita-gallery-nativescript) |

The static gates are plain Node and run in `audit-runtimes.yml` on both legs. The device
run is local-only — no CI container has an Android device — so what CI holds is the
static half, and the probe is what turns a template from a claim into a measurement.

**Why a static gate and not only the probe.** The probe can only judge the values a
template happens to use, and a template that writes `active="true"` passes whether or not
the setter coerces, because `'true'` is truthy. The gate reads the setter's DECLARED type
instead, so it judges the widget rather than the sample.
