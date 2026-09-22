# 69. Accessibility is ONE grouped prop, and relations are a declared gap

- Status: **Proposed**
- Date: 2026-09-22
- Deciders: Pascal Garber
- Related: [ADR 0027 (the GTK host layer)](0027-gtk-host-layer.md),
  [ADR 0028 (widget table provenance)](0028-widget-table-provenance.md),
  [ADR 0029 (the `@girs` widget vocabulary)](0029-girs-widget-vocabulary.md),
  [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md),
  [ADR 0042 (the portable menu model)](0042-portable-menu-model.md)

## Context

`@gjsify/gtk-host` resolves every authored name through the ParamSpec of the class that is
INSTALLED: the table travels with the package, the coercion travels with the user's GTK.
That answered every name a renderer could write — except GTK's accessibility surface,
which no ParamSpec carries and none ever can.

Measured in this tree before the change: `packages/framework/gtk-host/src`, outside
`generated/`, had **zero** occurrences of `update_property|update_state|update_relation|
Gtk.Accessible`. The whole expressible surface was `accessible-role` — a real GObject
property on `GtkAccessible` — plus `accessible-label`/`accessible-description`, which exist
on exactly two classes (`GtkListItem`, `GtkColumnViewRow`). So React, Vue, Solid and React
Native, all four of which bind to this host, could not label a button.

**Why it is a knowledge gap and not a convenience gap.** ARIA slots are members of three
enums — `GtkAccessibleProperty` (20), `GtkAccessibleState` (9), `GtkAccessibleRelation`
(24) — written through three calls that take a `GValue` the CALLER builds. Which
`g_value_get_*` GTK reads it back with is stated in C, in
`gtk_accessible_property_init_value()`, which is not introspectable. The only machine-
readable statement of it is each member's own GIR DOCUMENTATION, and ts-for-gir extracts
that into `ARIA_VALUE_TYPES` / `ARIA_VALUE_ENUMS` (`@girs` 5.1.0). The Blueprint parser
already reads both (`packages/infra/blueprint/src/resolve-ident.mjs`) — which is why a
`.blp` author could write `accessibility { label: "…"; }` and a React author could not.
gtk-host's generator read `OWN_PROPS`, `OWN_SIGNALS`, `DECLS` and `ENUM_NICKS` and stopped
there.

**What the missing table costs**, measured on gjs 1.88.1 / GTK 4.22.5, one process per row.
GJS guesses a GValue type from the JS value, and it guesses on a number's INTEGRALITY:

    update_property([VALUE_NOW], [3])       g_value_get_double: G_VALUE_HOLDS_DOUBLE failed
    update_property([LEVEL], [3.5])         g_value_get_int:    G_VALUE_HOLDS_INT failed
    update_property([SORT], ['ascending'])  g_value_get_int:    G_VALUE_HOLDS_INT failed
    update_state([CHECKED], [true])         g_value_get_int:    G_VALUE_HOLDS_INT failed
    update_property([999], ['x'])           gtk_accessible_value_collect_for_property_value:
                                            assertion 'property <= …HELP_TEXT' failed

Every one is a critical at exit 0. Two of them — `VALUE_NOW` and `CHECKED` — leave
`gtk_test_accessible_has_property`/`_state` reporting **true** afterwards, so a presence
oracle passes the defect. `checked: true` is the row a DOM author writes first, and it is
wrong because `checked` is a `GtkAccessibleTristate`: the ARIA table types these slots and
the widget's own properties do not, and the two disagree where it costs most —
`orientation` is a settable ARIA property on a `GtkLabel` that implements no
`GtkOrientable` at all.

## Decision

**1. The generator reads the ARIA tables and emits `src/generated/accessibility.ts`.**
`ARIA_VALUE_TYPES` and `ARIA_VALUE_ENUMS` join the four tables already read, merged over
every vocabulary source exactly as `ENUM_NICKS` is. The emitted file carries `ARIA_SLOTS`
(name → table, kind, enum GType) and `AccessibilityAttributes` (the typed props interface)
together, because they are two halves of one answer keyed identically; split, the day a GTK
release adds a name is the day the type surface and the runtime refusal disagree about
whether it exists.

This is the ONE generated table whose data the runtime cannot re-derive from the object in
front of it, which is why it ships as `.ts` rather than joining the test-only `.mts`
mirror.

**2. The authored form is ONE grouped prop**, `accessibility={{ … }}`, keyed by GTK's own
kebab names — not 53 flat `aria*` props. Four reasons, in the order they decided it:

- TypeScript exempts every hyphen-containing JSX attribute from excess-property checking
  (measured; `type-tests/jsx/known-hole-hyphen.tsx` holds the hole). A flat `aria-labell`
  would be accepted in silence. A key inside a fresh object literal IS checked, so the
  grouped prop closes for these 53 names the hole the property surface cannot close.
- The ARIA names COLLIDE with the widget's properties: `label`, `orientation`, `checked`,
  `expanded` and `selected` are each both. One object keeps the two vocabularies apart
  structurally instead of by prefix.
- ADR 0034's rule — one vocabulary across every surface that declares itself one. The
  Blueprint surface over this same `@girs` table already spells it
  `accessibility { label: "…"; }`.
- `setProp` already has this shape for `layout`: a structured, non-ParamSpec prop routed to
  its own mechanism. This adds ONE reserved key to the host, not 53.

Kebab only, the spelling GTK itself uses. A camelCase alias would double the surface and
buy nothing, because a quoted key in an object literal is excess-property checked.

**3. The runtime builds a typed `GObject.Value` per slot** and batches one `update_*` call
per table, resolving both the member and any enum nick through the SAME `lookupEnumNick`
the property path uses — so the shipped table says which names exist in the GTK the types
came from, and the installed library says which of them are really there. `null`,
`undefined` and a name the next render drops all mean `reset_property`/`_state`/`_relation`,
which is the host-wide contract that `null` is a removal.

**4. Relations that point at another widget are a DECLARED GAP, not an omission.** Fourteen
of the 53 slots are `kind: 'reference'`. Marshalling is not what is missing —
`Gtk.AccessibleList.new_from_list([widget])` builds exactly the value GTK wants (and
`new_from_array` is unusable from GJS: `gtk_accessible_list_new_from_array: assertion
'accessibles == NULL || n_accessibles == 0' failed`, returning null). ADDRESSING is missing:
this host has no `id` prop, and a framework `ref` is resolved AFTER the props of the element
that names it are applied, so a ref read at that point is `null` on the render that authored
it. Those names are emitted as `?: never` — declared, so the reader finds them and hover
carries the reason, and unwritable — and refused at runtime as `aria-reference`, naming the
imperative `ref={…}` spelling that does work today. The ten relation slots carrying integers
or strings (`row-index`, `col-count`, `pos-in-set`, …) are expressible now; the split is by
VALUE KIND, which the table states, and not by which of the three GTK calls is involved.

## Consequences

- `@gjsify/gtk-host` gains a shipped generated module and one reserved prop name. A widget
  named `accessibility` would now be shadowed; no GType in the table has such a property
  (the same check `setProp` already makes for `slot` and `layout`).
- A row of the table that is not a `Gtk.Accessible` — the list carriers are plain `GObject`s
  that HOLD a widget — is refused on the CLASS, before materialisation.
- `Gtk.test_accessible_has_*` is not a sufficient oracle, so every conformance vector for
  this surface runs inside the diagnostics gate: it is the SILENCE that separates a correct
  write from a mis-typed one. `accessibility.spec.ts` keeps the witness — the raw calls,
  outside the gate, asserting what GTK really does.
- **The oracle has a PRECONDITION, and it is an env var.** `gtk_accessible_update_*` writes
  into the widget's `GtkATContext` and `gtk_test_accessible_has_*` reads back out of it; with
  `GTK_A11Y=none` there is no context, so every write records nothing, every read answers
  false, and nothing is logged. Measured on GTK 4.22.5, four raw-GTK vectors, one process per
  cell: `gjs 1.88.1` and `node-gi on Node 24` agree in every cell — `unset` and `test` set the
  slots, `none` sets none of them, silently. So a red that appears only on the node-gi legs
  was a claim about their ENV, not about the bridge: those legs set `GTK_A11Y=none` and the
  gjs legs set nothing. `conformance/at-context.ts` holds both halves —
  `installAccessibilityBackend()`, which the test entry point calls (GTK's in-process `test`
  backend needs no bus, which is what `none` was chosen for), and `withAtContext()`, which
  throws a sentence at any call site whose widget has no context. The guard also covers the
  assertions that expect FALSE: without a context those pass VACUOUSLY.
- A future addressing model (an `id` prop, or a ref resolved before props) turns the
  fourteen `never` members into real types and deletes one runtime branch. Nothing else has
  to move, because the kind already comes from the table.
