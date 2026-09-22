# 71. A slot is a placement, and a renderer either answers to its name or refuses it

- Status: **Proposed**
- Date: 2026-09-22
- Deciders: Pascal Garber
- Related: [ADR 0027 (GTK host layer)](0027-gtk-host-layer.md), [ADR 0034 (widget vocabulary
  convergence)](0034-widget-vocabulary-convergence.md), [ADR 0051 (one authored tree,
  rendered)](0051-one-authored-tree-rendered.md), [ADR 0054 (toplevel placement and the
  unparentable refusal)](0054-toplevel-placement-and-the-unparentable-refusal.md)

## Context

`SharedTreeNode` has carried a `slot` field since ADR 0051, and the Blueprint projection fills
it: `[start]`, `[end]`, `[top]`, `[bottom]`, `[content]` and every object-valued property
become one. **Not one of the three shipped builders read it.** All three took `tag`, `props`
and `children` and dropped the placement without a word:

    packages/framework/gtk-host/src/conformance/shared-tree-builder.ts
    packages/nativescript-bridge/adwaita/src/builder/index.ts
    packages/web/adwaita-web/src/shared-tree-builder.ts

It went unnoticed because ADR 0051's corpus authors **zero** placements — the shared source
admits a block only when it needs no alias, and the header-bar slots are ledgered as a
`vocabulary` divergence, so no tree ever exercised one. A real `.blp` is the first source with
placement in it, and it was PR #1741 — a `.blp` reaching non-GTK build targets — that measured
the cost on `showcases/gtk/effect-adw-services/src/window.blp` in a browser: the `[top]` header
bar landed in `adw-toolbar-view-content`, the `title-widget:` window title was then discarded by
`<adw-header-bar>`'s own build, and both `_()` captions left the document. Exit 0 throughout.

### The renderers already place; only the builders did not ask

Each renderer has a placement mechanism and it already knows slots by name:

| renderer | mechanism | slot names it spells |
|---|---|---|
| `gtk-host` | `ChildPolicy` `slotted` + `defaultSlot` (`src/policies.ts`, `src/descriptors/*`) | `top`, `bottom`, `content`, `start`, `end`, `title`, `prefix`, `suffix`, `row`, … |
| `adwaita-web` | the `slot=` attribute, routed live by `src/slotted-children.ts` | `top`, `bottom`, `start`, `center`, `end`, `prefix`, `suffix`, `header-suffix`, … |
| `adwaita-nativescript` | `_addChildFromBuilder(name, view)` — the NAME is the slot (`widgets/builder-slots.ts`) | `topBar`, `bottomBar`, `content`, `startBox`, `titleWidget`, `endBox`, `prefix`, `suffix` |

So the work is not a table. It is each builder handing the authored name to the mechanism its
own renderer already has. ADR 0051 refuses a translator between two markup vocabularies on a
measurement, and that refusal stands: nothing below maps one renderer's spelling onto another's.

## Decision

### 1. `SharedTreeNode.slot` is the placement as the GTK side spells it

The field carries what the projection produces: a GtkBuilder `<child type="…">` name, or the
property name a property-valued child was written at. The two are conflated in one field by
construction — `packages/infra/blueprint/corpus/expectations.mjs` states it as finding 1, and
says the projection cannot be inverted — so a renderer has to answer to both spellings of a
placement it has. No third vocabulary is introduced, and no renderer's own spelling becomes the
reference.

### 2. GTK spells one placement twice, so a renderer derives the second spelling

`adw_header_bar_buildable_add_child`'s `<child type="title">` branch calls
`adw_header_bar_set_title_widget`, i.e. writes `title-widget`. `gtk-host` therefore accepts the
declared slot key OR the property name derived from that slot's `set_`-prefixed method
(`set_title_widget` → `title-widget`) — a case rule over the setter's own name, the same shape
as `hostTagOf` and `attributeOf`, never a table. An ADDER (`pack_start`, `add_top_bar`,
`add_prefix`) writes no property, so such a slot answers to its buildable type alone.
`<adw-header-bar>` names `title-widget` beside its own `center`, and `<adw-toolbar-view>` names
`content` beside its unnamed default: the element's own declaration of the GTK name for a
destination it already has, not a map held somewhere else.

### 3. A name a renderer has no destination for is REFUSED, and the refusal names it

A silently mis-placed widget is the defect this ADR exists for, so no renderer may fall back to
its default. `gtk-host` already refused an unknown slot on a `slotted` policy; it now refuses one
on every policy kind, because `ordered` and `single` read `slot` as nothing at all and put the
child in the one place they do have (`header-suffix` on an `AdwPreferencesGroup` is a real
libadwaita placement the descriptor does not declare). `adwaita-web` refuses after mount, against
the element's own `slots` declaration — its live routing keeps the NATIVE rule that an unmatched
name is assigned nowhere, which is right for hand-written markup and is not a report. The
NativeScript builder refuses before the write, against a `builderSlots` declaration on the widget
class, because `resolveBuilderSlot` is total by design and that totality is what makes a bare
child work.

**One exemption, narrow and stated:** `adwaita-web` does not refuse a placement under an element
this package does not define. Such an element has exactly one destination — itself — so nothing
can be mis-placed; what the tree is missing there is the WIDGET, which is a wider gap than a slot
(`AdwApplicationWindow` is the live case, and the NativeScript barrels cannot spell a window
either).

### 4. A corpus block may carry a placement only where every renderer spells it the same

ADR 0051's no-alias admission rule, applied to placement. A row's `prefix`/`suffix` qualify
today; a header bar's `start`/`title`/`end` do not, and those blocks stay ledgered as
`vocabulary` divergences until the renames land. Arm 13 of `check-generated-website-data.mjs`
used to REFUSE a slotted node — "the day a block is admitted with a slot, it came with a decision
about what a shared slot SPELLS" — and this is that decision: it compares the authored slot to
the fence's `slot=` verbatim, because under the admission rule there is only one spelling for the
fence to carry.

### 5. A driver proves the placement with a CONTROL, not with a table of destinations

Each tree driver builds the block twice — as authored, and through `withoutPlacements`, the tree a
builder that never read `slot` hands it — and asserts the two REALISED trees differ, by nesting
and node name only. This closes the bound ADR 0051 § Amendment 3 recorded and left open: a walk
filtered to the authored classes cannot see WHICH slot a child landed in, and two deliberate
mis-placements stayed green. No per-widget knowledge enters any driver.

## Consequences

- A `.blp` that reaches `adwaita-web` renders its header bar in the bar. The rest of that path is
  PR #1741's; this is the half that decides where a child goes once it is there.
- A tree authoring a placement a renderer cannot spell now FAILS where it used to render wrong.
  That is a loss of reach and the point: the `vocabulary` ledger says which ones, and each is a
  rename rather than a translation.
- `gtk-host` refuses a slot on a non-`slotted` parent, which is a behaviour change for any
  consumer that wrote one and relied on it being ignored. The error names the slot and the names
  the parent does have.
- The corpus gains a denominator it did not have: how many authored placements survive being
  rendered by three renderers.

## Alternatives rejected

**A slot table inside one renderer.** The translator ADR 0051 refuses, measured rather than
disliked: it would map behaviour and nothing could hold it. Every renderer here answers to names
it already declares, and where it does not, it says so.

**Normalising the slot in the projection.** `expectations.mjs` finding 1 is that the conflation
cannot be inverted: `[top]` has no property and `content:` has no buildable type, so there is no
single spelling to normalise to without inventing one.

**Letting an unknown slot fall back to the default.** What all three builders effectively did.
It is how a header bar ends up in the content at exit 0.

**Renaming the NativeScript slots to the GTK names.** `<AdwToolbarView.topBar>` is NativeScript's
complex-property syntax and the name must be the widget's own property, so this is a widget
surface change with its own blast radius. It belongs to ADR 0034's convergence, and the refusal
above is what makes the gap visible until it lands.
