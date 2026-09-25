<!-- Authored Open-TODO sections — area: @girs/@gjsify vocabulary alignment.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### `acceptsPropValue` is an oracle for the VOCABULARY, not for the type

`@gjsify/react-native/prop-table` answers "would `<P prop={value}>` render" for the two
grains the table ENUMERATES — the values a route refuses by name (`refuses`) and the
values it maps (`allows`, ADR 0039 § Amendment 2026-09-11, #1648). It does not answer
the third: `coerce` in `primitives/resolve.ts` refuses a non-boolean for `editable`, a
non-number for `numberOfLines`, a non-function for `onPress` and a non-string for
`accessibilityLabel`, and `explainPropValue` returns `null` for every one of them.

MEASURED on the state that closed #1648, by driving `'x'` through every property route
with no enumerable vocabulary: the render refuses and the oracle answers `null` on all
of them — `<Text numberOfLines>` ("expects a number"), `<Text selectable>`,
`<Pressable disabled>` and `<ActivityIndicator animating>` ("expects a boolean") among
them. It is a smaller hazard than the one that was fixed — a type error is a TypeScript
error first, and the props are typed — but it is the same shape of claim, and a
consumer's ledger test cannot tell the two apart.

What it would take, and why it was not done with #1648: the answer needs a per-coercion
PREDICATE on `PropAnswer` rather than a list, which is a second kind of published field;
`file` has no predicate at all (its refusals are computed from the value's shape —
`http:`, a `require()` id, an array), so the surface would have to say "unknown" for one
route kind and mean it; and `event`/`gesture` want "a function", which no JSON-shaped
answer can express to a consumer reading `propTable()` as data. The route-shape census in
`prop-table.spec.ts` is where it would be wired in: each shape already declares whether it
enumerates a vocabulary, and a `typeProbe` beside `OUTSIDE` is the same mechanism one
grain over.

### The `@girs/*` vocabulary carries no method table, so the method oracle is read from the typelib

`check-vocabulary-alignment.mjs`'s method ledger (ADR 0034 § Amendment 14) holds a port's
public methods against `packages/framework/gtk-host/src/generated/methods.mts`, and that
file is NOT emitted by gtk-host's vocabulary generator the way `props.ts` and `widgets.ts`
are. It cannot be: measured on the published `@girs/gtk-4.0@4.6.0`, `gtk-4.0-vocabulary.js`
exports PROVENANCE, OWN_PROPS, OWN_SIGNALS, DECLS, CHILD_HOLDERS, ENUM_NICKS,
SLOT_CANDIDATES and SINCE — eight names, no method table. `SLOT_CANDIDATES` is derived from
methods (ADR 0029 § 4's one-widget-argument rule) and carries the SLOT it derived, never
the verb.

So `scripts/generate-widget-methods.mjs` reads the installed typelib through GIRepository
instead — the same arrangement `generate-enum-values.mjs` set for enum values, for the same
reasons, held the same two ways (the no-install gate holds the shape, gtk-host's
`generated.spec.ts` holds every name against the running GJS). It is a maintainer step, not
a CI gate, and its provenance line is the typelib's, not the vocabulary's: the artifact was
read from Gtk 4.22.4 / Adw 1.9.3 while `widgets.ts` was generated from 4.23.3 / 1.10.0, so
`GtkSvgWidget` is a declared absence in `METHODS_UNAVAILABLE` until somebody regenerates on
a newer host.

**What would close it**: an `OWN_METHODS` export beside `OWN_PROPS` in ts-for-gir's surface
generator (`packages/generator-typescript/src/surface/`, the venue ADR 0029 § Amendment
names) plus a release. Then gtk-host's generator emits the table in the same run as the
other three artifacts, under ONE provenance line, and the typelib reading becomes what it
should be — a second source the `.gir` reading is held against, rather than the only one.
The gate's reader (`scripts/widget-methods.mjs`) would not change; the generator's input
would.


### A version stamp read off `@girs/*` is not the library that ran

Seven measurements in this tree were stamped `Adw 1.10`. Installed is **1.9.3**
(`rpm -q libadwaita`, and `Adw.MAJOR/MINOR/MICRO_VERSION` under gjs agree). The source is
`node_modules/@girs/adw-1/package.json`, whose `description` reads *"generated from library
version 1.10.0"* — so the number was taken from the TYPE package's declared upstream, not from
the library the probe actually called.

Six were corrected against the running library. **One deliberately was not**:
`docs/adr/0027-gtk-host-layer.md:37` ("across 29 containers"). It is a different measurement,
never reproduced here, and writing `1.9.3` there would assert a version for a run nobody
observed — which is the same defect one layer down. Re-run that probe or leave the stamp; do not
edit it.

The skew is already known elsewhere: `gjsify system-check` catches `@girs/adw-1` 1.10.0 against
libadwaita 1.9.2 (recorded further down this file). What was missing is the consequence — a
`@girs/*` version is a claim about the GIR the types came from, and a measurement must name the
library it ran against, which is `Adw.get_*_version()` and nothing else.

**The skew is still live and now has one mechanism, on one surface.** Re-measured 2026-09-01:
running `Gtk 4.22.4 / Adw 1.9.3` (`rpm -q` and `get_*_version()` agree), generated against
`Gtk-4.0/4.23.3 Adw-1/1.10.0`. Since the vocabulary migration the generated artefacts carry
BOTH numbers rather than one: `GENERATED_PROVENANCE` states the library the types came from,
and `generated.spec.ts` reads it back against `get_*_version()`, so a class the host lacks is
either explained by the gap or named as a fault. That is what turned six bare
`can't access property "$gtype"` failures into `GtkSvgWidget (generated against Gtk 4.23.3,
running 4.22.4)`.

It fixes ONE surface. Every other measurement in this tree still has to name its own running
library by hand, and the failure this entry recorded — reading the number off a type package —
is as available as it ever was. The rule is unchanged; what exists now is one worked example of
carrying both numbers instead of picking one.



### The one-vocabulary goal is checked by NAME, not yet by BEHAVIOUR

ADR 0027 § 9 makes one widget vocabulary across native GTK, Blueprint/XML, TSX/JSX,
Vue templates and the web pillar's `adw-*` elements an explicit goal. **Its named
obstacle is gone**: `adwaita-web` adopted `[slot=]` children exactly once, in
`connectedCallback`, and adoption is now live through `src/slotted-children.ts`. A
renderer mutates its tree after mount by definition, so that was an upstream fix and
it landed upstream.

**The name-agreement mechanism now exists**: `scripts/check-vocabulary-alignment.mjs`,
a step of the required `Detect runtime-triplet drift` job. It holds the four generated
maps against the runtime table and the test-only surface data (four artifacts, three
files), refuses a dialect surface that stops deriving its element list from those maps
or spells a widget itself, and holds every `adw-*` custom element against the GTK tag
set. Measured at the time it landed: 164 GTK tags, 65 `adw-*` elements, 43 sharing a
spelling exactly, 10 declared as the same widget under another name, 12 declared
web-only with a reason. The gjsify half of ADR 0029 is what made it cheap; it does not
depend on the `@girs` subpath.

What the check deliberately does NOT prove is BEHAVIOUR. Agreeing on `adw-action-row`
as a name says nothing about the two renderers producing the same tree, and sharing one
outright is weaker still: `<gtk-check-button>` now IS the tag `GtkCheckButton` carries,
and nothing here asserts that it behaves like one.

The criterion that closes the GOAL out is in ADR 0027 § 9 and is unchanged: the same
authored tree, rendered through the GTK host and through `adwaita-web`, satisfies the
same `@gjsify/adwaita-core/conformance` vectors with no per-surface markup branch. Both
halves now exist for part of the gallery: the "same authored tree" half is measured by
arm 11, and the BEHAVIOUR half by the two tree drivers ADR 0051 landed — see *The gallery's
two authored trees agree on a minority of blocks* below for what they cover and what they
do not. The goal is a claim about the shared blocks and a direction past them — and the
longer horizon it points at (NativeScript and browser builds from one native-authored
source) still needs its own ADR.

Two things the slot work left for whoever picks this up. **Ten of the 23 re-homing
elements are deliberately not converted**: eight consume typed children into a state
model (pages, sections, selection, roving focus) where going live changes semantics
and wants its own vectors, `adw-checks` routes conditionally on its `label`
attribute, and `adw-bottom-sheet` unwraps its wrappers rather than moving children.
And `bindEmptySections` derives SYNCHRONOUSLY, so it must run AFTER the router's
`install` — routing first hides a section a declared child had already earned, and it
only un-hides a microtask later, after `_syncClasses` has measured a bar at
`offsetHeight` 0. That cost 8 real failures once; the three call sites now say so.


### A property can agree on its NAME and disagree on its VALUE KIND

`check-vocabulary-alignment.mjs` prints a property distance and calls a NativeScript
property "already agreeing" when its name is a key of the GIR counterpart's props
interface. It compares names and nothing else, so a property that agrees on its name and
means something different is counted on the agreeing side. The entry above says the
one-vocabulary goal is checked by NAME and not by BEHAVIOUR; this is that sentence one
level down, with a named instance instead of a general worry.

**The instance.** `Adw.ButtonRow:start-icon-name` is *"the icon name to show before the
title"* — a name looked up in an icon theme. `AdwButtonRow.startIconName` on the port is
*"a leading Adwaita symbolic SVG string (e.g. `listAddSymbolic`)"* — the SVG document
itself. Both are `string`; both are spelled `startIconName`; the gate counts them as
agreement. A caller who reads the aligned vocabulary and passes `list-add-symbolic` gets
no icon, and nothing in this repository says why.

**The census, so the class is sized rather than feared.** 43 NativeScript widget classes
whose class name is itself a GType in `gtk-host`'s runtime table set 139 properties
between them; 95 of those names are keys of the counterpart's props interface. (The gate's
own figures are larger because `counterpartsOf` also unions the `composes` entries in
`NS_WIDGET_ALIGNMENT`, which this census did not resolve — it is a strict subset, and a
census that quietly claimed the gate's corpus would be a measurement narrower than its
claim.) Of the 95:

| what the two sides do | pairs |
|---|---|
| the type agrees and so does the meaning | 30 |
| the type differs: the port widens to `\| string`, because an XML attribute arrives as one | 37 |
| the type differs: a GIR nick-union against the port's own enum, same kind | 11 |
| the type differs: a toolkit type against its NativeScript peer (`Gtk.Widget` → `View`) | 4 |
| the type differs: a declared portable value form (ADR 0042 · 0046 · 0047) | 3 |
| the type differs: nullability only | 1 |
| **the type differs AND so does the kind of value** | **2** (was 3 — #1584) |
| **the type AGREES and the kind of value does not** | **5** |
| the evidence does not decide | 1 |

The two the type already shows are `AdwTabView.selectedPage` (`Adw.TabPage` against a
page-id string) and `AdwTabView.defaultIcon` (`Gio.Icon` against a string).

**The third is RESOLVED** (#1584) and is worth keeping here for the shape of that answer
too. It was `GtkImage.iconSize`, a `Gtk.IconSize` enum against a DIP number — the port
carrying `Gtk.Image:pixel-size`'s meaning under `icon-size`'s name, twice (`AdwImageButton`
had the same pair). The fix was not to pick one: the port now carries BOTH GTK properties
under their own names, `iconSize` taking the three nicks and `pixelSize` the number, with
`pixel-size` overriding as it does on GTK, and the constant reaching `iconSize` through the
construct-props bag the way `Gtk.Align`'s does. `widgets/gtk-icon-size.ts` holds the table;
arm 7 of `check-nativescript-xml-doors.mjs` holds it against `GtkIconSizeNick` AND holds the
derived constants against the typelib-read values in `generated/enum-values.mts` — the
second oracle `gtk-align.ts` names as the thing that would retire its own caveat.

**The five it does not have RESOLVED** (ADR 0034 § Amendment 18), and they are worth keeping
here for the shape of the answer. They were one family — `GtkImage.iconName`,
`AdwStatusPage.iconName`, `AdwButtonContent.iconName`, `AdwButtonRow.startIconName` and
`AdwButtonRow.endIconName` — an icon-theme NAME on the GIR side, an Adwaita symbolic SVG
SOURCE on the port. `icon-theme.ts` made every one of them take the GIR kind as well as the
port's, so the disagreement is gone rather than declared: the two grammars are disjoint, a
name is one CSS token and a document starts with `<`, and one function decides which.
`AdwPreferencesPage.iconName` is still the undecidable one — the port stores the string and
nothing renders it, so no evidence in the tree says which kind it is.

**Why this is an entry and not an arm, measured rather than assumed.**

*A type comparison would fire on 59 of the 95 and 56 of those are deliberate* — the
`| string` widening IS the XML door, and the enum and portable-value rows are the port
doing exactly what its ADRs say. To reach zero false positives it would need those 56
declared: a 56-entry ledger to hold a 3-member finding, and blind to the other five
anyway.

*A prose comparison is incomplete on BOTH sides, and its failure mode is silence.* The GIR
docs phrase "this value is an icon name" four different ways across the five — *"The icon
name to show before the title"*, *"The name of the icon to be used"*, *"The name of the
displayed icon"*, *"The name of the icon in the icon theme"* — and the first reader written
here, built from two of them, missed `AdwButtonContent.iconName` and reported a smaller
class than it had found. The port says *"symbolic SVG string"* on four of the five and says
nothing of the sort on `AdwPreferencesPage.iconName`. Neither vocabulary is closed, so a
regex over either goes quiet when someone rewords a comment, and a gate that goes quiet
looks exactly like a gate that passed.

*There is no structural marker across the family either.* Two of the five name the setter
parameter `svg`, two assign `this._iconSvg`, and `AdwButtonRow` delegates to
`_buttonState.setStartIconName` and shows nothing at the setter at all.

**What a checker would have to read to be honest**: not the name, not the TypeScript type
and not the prose, but where the value GOES — whether the string reaches an SVG asset
resolver or an icon-theme lookup. That is a call-graph question over the port's setters, and
it is the same question one level up from `gtk-host`'s own `coerce` seam.

*Nothing had to answer it in the end, and that is the more interesting outcome.* The five
were closed by making the answer BOTH, so the question a checker could not decide stopped
being a question about those setters. What replaced the checker is
`check-nativescript-icon-names.mjs`, which asks something a script CAN read: not which kind
a value is, but whether every name a surface emits is one the port compiles a glyph for —
and, in the other direction, whether every glyph it compiles is one some surface emits.
`NS_PROPERTY_ALIGNMENT` is still unchanged, now because there is nothing to declare.


### One vocabulary is a rule for EVERY surface — clause 3 holds on all three renderers

**ADR 0034 stages 2, 3, 6 and 4 have landed** (in that order, ahead of stage 1; the
re-priced order is in that ADR's § Amendment and § Amendment 2).
`scripts/check-vocabulary-alignment.mjs` now reads every surface that DECLARES itself one,
holds widget names on three renderers and property names on one, and prints, every run:

```
4 declared widget surface(s), every one of them read. 169 GTK tags across 3 dialect
surfaces + the runtime table + the surface data; 65 @gjsify/adwaita-web elements — 53
share a spelling, 0 alias one, 12 declared web-only; 46 @gjsify/adwaita-nativescript
widgets — 42 share a spelling, 2 should converge, 2 declared own, 0 undecided; 12
@gjsify/adwaita-react-native widgets — 12 share a spelling, 0 should converge, 0
declared own, 0 undecided. Properties, on @gjsify/adwaita-nativescript only: 44
widgets with a GIR counterpart set 143 settable propert(y|ies) between them — 102
already agree with the counterpart's ConstructorProps, 41 do not (14 should converge,
27 declared own, 0 undecided). Namespace exports (ADR 0034 clause 2): 3 of 3
renderer(s) — @gjsify/adwaita-web exports Adw with 44 and Gtk with 9,
@gjsify/adwaita-nativescript exports Adw with 38 and Gtk with 5,
@gjsify/adwaita-react-native exports Adw with 12. Distance to one vocabulary: 2 widget
name(s) and 14 property name(s), and both can only go down.
```

Every one of those numbers is derived at run time. None of them is written in the check's
header any more, because the count that used to sit there (`164`) was quoted into ADR 0034
after it had already drifted.

Where each stands:

| surface | GIR naming | declared |
|---|---|---|
| `gtk-host` | holds by construction (`src/tags.ts:18`) | declares `role: reference` |
| `adwaita-web` | 10 elements violate it (`adw-entry` is `GtkEntry`) | **held** — all 21 declared, all 21 with a reason |
| `adwaita-nativescript` | 4 violate it; 2 more have no counterpart | **held** — 8 widget entries + 52 property entries, `gir`/`composes`/`own`, each with a reason |
| `adwaita-react-native` | holds (12 widgets, all share a spelling) | **held** — declared, read from the base barrel, empty ledger |

**The clause 2 column is gone from this table on purpose.** It said `absent` three times,
and it was already wrong for React Native, which exports `Adw` on all three of its barrels
(ADR 0034 § Amendment 3). `check-vocabulary-alignment.mjs` now reads each surface's own
`src/index.ts` for `export const Adw`/`Gtk` and prints the tally on every run, as its last
summary line. No figure is repeated here: the sentence above already said the copy is what
drifts, and the first version of this paragraph quoted `1 of 3` and was overtaken by
`adwaita-web` two commits later in the same branch.

**Enrolment is a per-package declaration now, not a list in the gate.** `gjsify.widgetVocabulary`
(`{ "role": "reference" | "renderer" }`) on each of the four, joined to the readers in
`scripts/widget-surfaces.mjs`; `scripts/manifest-conformance/rules/widget-vocabulary.mjs`
claims the key so `field-coverage` accepts it and calls the same pure rule, so the manifest
gate and the vocabulary gate cannot answer differently. A fifth surface joins the rule by
declaring itself: a declaration with no reader fails, a reader whose package stopped
declaring fails, and a declared renderer no half of the check compares fails.

**The clearest instance is closed**: `gtk-host` said `<gtk-entry>` for Solid, Vue and
React alike while `adwaita-web` said `<adw-entry>` for the same widget, both on the same
gallery page under one block titled `Gtk.Entry`. They differ in render target (GTK vs DOM)
and not in what the widget is, and both now spell it `<gtk-entry>`. What is left of clause
1 is the NativeScript port's six.

**[ADR 0034](../docs/adr/0034-widget-vocabulary-convergence.md) proposes the cut** — the
rule stated once and surface-neutral (named from the GIR · exported as a namespace · every
divergence declared with a reason), convergence with a DECLARED remainder rather than a
bijection, and the namespace as a re-export layer rather than a rename.

**The staging followed the cost curve, and the term that ordered it has expired.** ADR 0034
put React Native first because it had zero published versions and would acquire the
NativeScript rename's cost at the next cut. **It published at 0.44.0 on 2026-08-30T07:13:40Z**
(`npm view @gjsify/adwaita-react-native time --json`), so nothing is rising any more and
the ordering no longer follows from anything. Re-measured that morning: `adwaita-web` 137
versions / 5 006 downloads a month / 11 in-repo import sites; `adwaita-nativescript` 49 /
3 598 / 49 TS + 28 XML files; `adwaita-react-native` 1 / **no download record at all** (the
point endpoint 404s for a package published that morning — not a measured zero) / 0 import
sites outside the package.

**Stage 1 is down to its namespace export, and is still worth doing**, which is exactly the
risk ADR 0034 § Risks named ("the cheap stage is skipped because it is the least
urgent-looking"), so it is written down here with its price rather than left to be
re-derived. Stage 4 took the other two thirds: React Native declares itself a surface, its
widget set is read from the base barrel's `import { Adw… as … } from './widgets/…'` lines
(they were `export … from` lines until § Amendment 8 removed the flat spelling), and its
(empty) `RN_WIDGET_ALIGNMENT` is held against the GIR tag table. What is left is clause
2, the `Adw` namespace export. What stage 1 no longer buys: the guarantee that the rule
costs that package nothing it can ever undo. Both its names are already correct, so no
rename is in it at any price.

One thing whoever picks this up should not re-derive: `collectAdwaitaCoverage`
(`scripts/generate-status.mjs:223-225`) joins the renderers on the BARE name and says the
vocabularies agree on it; that join is true only because they all flattened, so any rename
has to carry it or the widget matrix grows false gaps. (The other one — that
`WEB_ELEMENT_ALIGNMENT`'s `gtk:` entries carried no reason field — is closed: all ten now
carry one, eight moved from the element headers and two derived from `generated/props.ts`
and the storybook coverage ledger, and an alias with no reason is a failing rule.)

**Two things ADR 0034 measured but deliberately did not change.**

*The docs file GTK widgets under an Adwaita heading.* `website/` has one top-level widget
section, `Adwaita`, and no `Gtk` one. `controls.mdx` carries **zero** `Adw.*` gallery
blocks and two `Gtk.*` ones; `buttons.mdx` carries 3 and 2. The section's own rename
comment (`website/astro.config.mjs:18-20`) already argues the rule — name it after the
thing that owns it, *"beside it rather than under it"* — and its premise ("only ever
covered Adwaita") has stopped holding. ADR 0034 stage 5: a `Gtk` section beside `Adwaita`,
`controls.mdx` moving whole, redirects the way the `/widgets/*` rename already did.

*Stale hand-written widget counts.* `grep -c "gtype: '" …/generated/widgets.ts` is **168**;
`164` (the count before ADR 0028's 2026-08-28 amendment admitted placement carriers) still
stands in `docs/adr/0028-widget-table-provenance.md:322,333` and
`packages/framework/AGENTS.md:66` — in a sentence that itself warns *"a literal here
drifted twice"*. The third site, `scripts/check-vocabulary-alignment.mjs:37`, is fixed: the
header carries no count at all now and the summary line derives every number it prints.
(this file's own 164 above is framed "at the time it landed" and is fine.) The
GENERATED header is NOT drifted, and the constant 4-wide gap between it and
`grep -c '^export interface '` is not an off-by-four bug: `emit-types.mts:144` emits
`model.declarations.size` (194) and the file additionally emits four tag maps
(`WidgetPropsByTag`, `WidgetPropsByGType`, `WidgetPropsVueAliases`, `WidgetClassByTag`)
that the header's own sentence already excludes. 198 - 4 = 194, and the same subtraction
held at the previous revision (190 + 4). One real generator nit beside it: that header says
*"the **two** tag maps"* while it emits four — a one-word fix in `emit-types.mts`, worth
its own PR rather than a docs change.

*How this was nearly got wrong.* Both wrong readings came from a shared checkout sitting 43
commits behind `main` (branch `chore/refs-metro`), which reported 190/164 where `main` says
194/168. Every count in ADR 0034 now states where it was read, and the `@girs` type-surface
numbers pin `@girs/gtk-4.0@4.1.0` — `^4.1.0` resolves to 4.3.0 today and the counts move.

**A stronger oracle, priced, for whoever wants one.** `@ts-for-gir/lib` exports
`src/index.ts` with no build step (ADR 0019 § 1) and re-exports `./gir/index.ts` +
`./gir-module.ts`, so a gate could parse the `.gir` directly instead of reading our emitted
types — a second READER of the same source, not a second source, and it needs
`node_modules`, so it belongs in `tree-checks`. Shipping the `.gir` inside `@girs/*` is
already rejected by ADR 0019 § 2 (*"never with the type package"*), and the numbers back
it, with the denominator from the registry: `@girs/gtk-4.0@4.1.0` unpacks to 5.86 MB (4.3.0
to 6.12 MB) against a `Gtk-4.0.gir` of 6.20 MB, so bundling roughly doubles the package;
705 `.gir` files / 379 MB across a full pool. The capability is still real — nicks live only in the typelib and
documentation only in the XML — so if it is wanted the shape is a companion artifact and
the venue is `gjsify/ts-for-gir` (`gjsify/types` has issues disabled; no existing issue
found).

**Stage 6 prints the property distance now, and re-measuring moved it.** The figure this
section used to carry — 42 widgets, 137 settable properties, 92/45, split 16 with a
candidate spelling and 29 without — came from the TypeScript compiler API over
`@girs/gtk-4.0@4.1.0`. The gate reads the in-repo `generated/props.ts` instead, as stage 6
specifies, and counts what each widget CLASS declares settable: **44 widgets, 143
properties, 102 agree, 41 do not, 14 with a machine-checked convergence target and 27
declared `own`**. Three deliberate differences produce that, and ADR 0034 § Amendment 2
holds the table: the counterpart set grew because stage 3's ledger gave `AdwIcon` and
`AdwImageButton` one; "settable" is `set <name>(` in the widget's own class body, so a
read-only accessor like `GtkEntry.textLength` counts on neither side; and a "candidate
spelling" is now an entry whose target must be a key of that counterpart or the gate fails.
Re-run the gate before quoting any of it.

**What is still not measured**, said here because the printed line names one surface for
exactly this reason: `adwaita-web`'s attribute vocabulary and `adwaita-react-native`'s prop
types are two further property corpora with no ledger. Neither is hard in the way the
NativeScript one was — the shape is decided — but both are larger, and a distance printed
without its surface is a claim wider than its measurement.

A full `tsc` conformance check remains the right oracle on the wrong instrument —
`Gtk.Entry` is 509 members, and the gate job runs `checkout` + `setup-node` with no install.

**Stage 8 landed and left one thing no gate here can hold: GIR enum VALUES.** The
construct-props bag ships on all 46 NativeScript widgets (ADR 0034 § Amendment 13) and
accepts `Gtk.Align.CENTER` as well as `'center'`, which needs a value table on a target with
no typelib. **The oracle for this landed while stage 8 was in review** — `#1585` added
`packages/framework/gtk-host/src/generated/enum-values.mts`, which carries `GtkAlign.fill` 0
through `GtkAlign.baseline-center` 5 alongside `ENUM_ALIASES` and `ENUM_DEPRECATED`, so the
repository now DOES carry GIR enum values. What is still open is CONSUMING it here:
`generated/props.ts` emits nick UNIONS and `generated/surface-data.mts` emits nick LISTS, so
this port still derives its numbers itself — and both obvious derivations are measurably
WRONG for this very enum, because
`GTK_ALIGN_BASELINE` was deprecated in GTK 4.12 into an alias of `GTK_ALIGN_BASELINE_FILL`
(the nick position and `@girs`'s initialiser-less `enum Align` both give `baseline` 5 and
`baseline-center` 6; the GIR and the typelib give 4 and 5). `gtk-align.ts` therefore derives
its constants from the nick order plus ONE declared alias, and
`check-nativescript-xml-doors.mjs` holds everything except that declaration. **The remaining
step is to read `#1585`'s table from here** instead of deriving: it is a committed in-repo
file, so a gate running `checkout` + `setup-node` with no `@girs` install can reach it, which
was the whole objection. Doing so retires the hand-declared alias and — the reason it is
worth more than one enum — unblocks the same treatment for the **15** other
setters on this surface whose declared string union is exactly a GIR enum's nick set, across
**11** distinct enums. Measured against the 158 setters the package declares. One of them,
`AdwWrapBox.wrapPolicy`, is ambiguous by nick set alone — `'minimum' | 'natural'` matches
`GtkScrollablePolicy`, `AdwFoldThresholdPolicy` and `AdwWrapPolicy` exactly — so the enum
behind a setter has to be declared either way.


### The vocabulary gate measured ONE direction, and the other one is now a ratchet

`NS_PROPERTY_ALIGNMENT` holds the port's SETTABLE properties against the counterpart's
`ConstructorProps` and asks whether the NAME agrees. A GIR property the port simply does
not HAVE is invisible to it, and to every other gate, because nothing iterated the
counterpart's side. So the printed *"Distance to one vocabulary: N property name(s)"*
measures disagreement among the properties that EXIST and says nothing about the ones that
do not.

Measured instance: `AdwAvatar` set `text` and `size` while `Adw.Avatar` declares four
scalar properties — `icon-name`, `show-initials`, `size`, `text`. Two of four, with every
check green, for as long as the widget existed. `<adw-avatar>` had been held against the
same four since 2026-08-26 by `check-adwaita-element-properties.mjs`; the second renderer
had no such gate at all.

`scripts/check-nativescript-widget-coverage.mjs` closes it, in the shape the web surface
already had — a per-widget declared backlog, a new gap fails, a closed gap fails until it
leaves the ledger. The GIR side of both is one reader now
(`scripts/gir-scalar-properties.mjs`): two definitions of "a scalar property" would be two
backlogs that can disagree about what they are counting while both stay green.

**The denominator is the deliverable, so here is the ladder it was chosen from**, all
three measured over the same 43 widgets:

| denominator | keys | the port does not set |
|---|---:|---:|
| the whole `extends` chain, everything in it | 5363 | 5142 |
| the counterpart's OWN body, `onNotify*`/signals and kebab twins removed | 293 | 181 |
| …and widget-valued slots removed — **what the gate uses** | 231 | 131 |

The chain is what makes a number nobody can act on: it puts `GtkWidget`'s keys plus
`GtkAccessible`/`GtkBuildable`/`GtkConstraintTarget` behind every widget, and 96 % of it is
"missing" on a port whose views are `GridLayout`s. Own-body-only keeps the GIR side to what
the TYPE introduces — the PORT side is deliberately not symmetric with it and resolves the
port's own `extends` chain, for the false-red reason the section below gives — and it has
one honest under-count, stated rather than hidden: a property a GIR type inherits from a
GIR ancestor is measured on THAT ancestor's row when the port ships the ancestor as a
widget too (`AdwSwitchRow`'s `subtitle` is `AdwActionRow`'s and is counted on
`adw-action-row`), and is not counted at all when it does not — `AdwSwitchRow`'s `title` is
`AdwPreferencesRow`'s, the port ships no `adw-preferences-row`, and nothing measures it.

The live totals are the gate's summary line and are not restated here. What it does NOT
print is the SHAPE of the backlog, which is the census — at the landing commit, 12 widgets
short nothing, 7 short one, 6 short two, 6 short three, 3 short four, 3 short five, 3 short
six, and then three long tails: `GtkMenuButton` (8 of 9 unset), `AdwAboutDialog` (15 of 22)
and `GtkEntry` (26 of 28). Three of the 12 short nothing are short nothing VACUOUSLY —
`AdwPasswordEntryRow`, `AdwSpinner` and `AdwToastOverlay` declare no scalar property of
their own at all, so there was nothing for the port to be short of, and the gate prints
those apart from the nine that hold something. The three long tails carry 49 of the total,
so the backlog is not evenly spread and the obvious first pass is one widget, not a sweep.
The three widgets whose file spelling is NOT a GTK tag (`adw-image-button`,
`adw-slider-row`, `adw-data-grid`) are declared divergences `NS_WIDGET_ALIGNMENT` owns and
are deliberately outside this gate; reading that ledger from a second script would be a
second copy of it.

**Two findings the census turned up that are not gaps.**

`Gtk.Entry:visibility` is password masking; the port's `GtkEntry` already answers to
`visibility` from NativeScript's `View`, meaning show-or-hide. Same spelling, two controls,
and it is the only such collision in the corpus — measured against the ambient
`ns-core.d.ts` slice, so a name NS core carries that the slice does not declare would be
missed.

`AdwViewSwitcher` HAS `Adw.ViewSwitcher:policy` and not under that name:
`AdwViewSwitcherBase` declares a protected `policy` getter for the button orientation and
exposes the settable door as `switcherPolicy` beside it. ADR 0034 § Amendment 11 already
settled the shape — a collision with a port-owned member is a question about that member,
not a reason the name cannot converge — and this one is internal, so it can be renamed.


### A name can agree while the VALUE KIND disagrees, and the declarations mostly cannot tell

The second census, and the reason it produced no gate. Of the 109 property names where the
port and its counterpart agree, the two declared TYPES — the GIR annotation in
`generated/props.ts` against the port's setter parameter — say:

| | rows | what it is |
|---|---:|---|
| the same kind | 58 | 42 string/string, 13 enum, 3 object |
| the port widened it with `\| string` | 42 | the XML-attribute coercion `xml-values.ts` exists for: `component-builder` assigns a raw string, so `boolean` becomes `boolean \| string` |
| a different kind | **9** | below |
| no annotation to read | 0 | every setter on this surface is typed |

The nine, each read from both sides:

| | GIR | port |
|---|---|---|
| `AdwComboRow.model`, `GtkDropDown.model` | `Gio.ListModel \| null` | an array of option specs (ADR 0046) |
| `AdwSplitButton.menuModel`, `GtkMenuButton.menuModel` | `Gio.MenuModel \| null` | an array of menu entries (ADR 0042) |
| `AdwTabView.selectedPage` | `Adw.TabPage \| null` | the page id, a string (ADR 0048) |
| `AdwTabView.defaultIcon` | `Gio.Icon` | a symbolic SVG string |
| `AdwSidebar.filter` | `Gtk.Filter \| null` | a predicate function |
| `GtkImage.iconSize`, `AdwImageButton.iconSize` | `GtkIconSizeNick \| Gtk.IconSize` | a size in DIPs — no longer, see below |

Seven of the nine are DECIDED portable forms with an ADR behind them — the port has no list
model, no menu model and no page type, and giving it one was the point of those changes.

The last two were the interesting ones and they were the same defect twice:
`Gtk.Image:icon-size` is a three-member enum (`inherit`/`normal`/`large`) and the port's
`iconSize` was "the icon size in DIPs". GTK's number for that is `pixel-size` — which the
coverage census above listed as a gap on both widgets, beside the property that WAS it. So
the port carried GTK's `pixel-size` under GTK's `icon-size` name, and
`<gtk:Image iconSize="large">` fell back to 16, silently. #1584 gave each GTK property its
own name — `iconSize` the nicks, and the constant through the construct-props bag;
`pixelSize` the number — so the last row of the table above is agreement on the value kind
now and eight of the nine remain. It is kept in the table because the SHAPE is this entry's
point: two censuses made the question visible from two directions, and neither could have
FAILED on it.

**Why this is not a gate.** Getting from 26 raw disagreements to those 9 took four
normalisations, and every one of them is a judgement a gate would be encoding rather than
measuring: absorbing the enum CONSTANT half of `XNick | Ns.X` into the nick (ADR 0034 § 4
says the nick is the convergent spelling), resolving port type aliases across
`@gjsify/adwaita-core` (`AdwToolbarStyle` is `'flat' | 'raised' | 'raised-border'`),
treating `View` and `Gtk.Widget` as one kind, and forgiving the `| string` widening. A
checker that wanted to be honest would have to read: both type surfaces, the alias
definitions in two packages, `xml-values.ts` for which coercions exist, and the nick tables
— and it would still stop one step short of the thing that matters.

Because the case the brief for this work names is exactly the one the declarations CANNOT
decide. `Adw.ButtonRow:start-icon-name` is `string | null` and `AdwButtonRow.startIconName`
is `string`: the gate above and this census both call that agreement, and GTK holds an
icon-theme NAME while the port holds a rendered symbolic SVG. Nine of the 42 string/string
rows were icon slots of that shape, and only four said so in a way a machine could see (the
setter parameter was literally named `svg`). ADR 0034 § Amendment 7 already ruled on it —
*"A string is a string whether it is a theme name or an SVG source"* — so it was a recorded
decision rather than an undetected defect. § Amendment 18 then dissolved the case the brief
names: the port takes the theme name too, so those rows are agreement on the VALUE as well
as on the type. The census's point survives its example — a declaration comparison still
cannot see a value-kind divergence, and the next one will not announce itself either.


### The vocabulary gate's port-side reader stops at the class body, and two base classes fall out of it

Found while building the coverage census, and it is the same blind side one direction over.
`check-vocabulary-alignment.mjs` reads a widget's settable properties with
`settablePropertiesOfClass`, which reads ONE class body. That is right wherever a port
widget's base is itself a widget file — the PORT's `AdwActionRow` declares `set title`, so
`AdwSwitchRow`'s inherited `title` is held on `adw-action-row`'s own row (this is the port
hierarchy, not the GIR one, where `title` is `AdwPreferencesRow`'s) — and wrong for a base
that is not: `packages/nativescript-bridge/adwaita/src/widgets/split-view-base.ts` and
`view-switcher-base.ts` are not `<library>-<name>.ts` files, so the 10 setters they declare
are read by nothing.

A chain-resolving port reader adds 56 rows to that gate, of which **18 are neither a key of
the counterpart nor declared today**:

    adw-inline-view-switcher   switcherPolicy  views  selected
    adw-view-switcher          switcherPolicy  views  selected
    adw-navigation-split-view  showSidebar  sidebarWidth
    adw-overlay-split-view     sidebarWidth
    adw-button-row             subtitle  activatableWidget
    adw-entry-row              subtitle  activatableWidget
    adw-password-entry-row     subtitle  activatableWidget
    adw-expander-row           activatableWidget
    gtk-menu-button            iconColor  iconSize

The METHOD half of the same gate (ADR 0034 § Amendment 14) was built with the resolving
reader from the start — `nsMethodsOf` in the world builder walks `extendsOf` through every
abstract port base, so `AdwSplitViewBase.set_content` is measured on both split views. The
property half could share that walk; the 18 verdicts are what still stand between them.

The fix is a one-function change in that gate's world builder plus 18 ledger entries with
reasons, and it is a separate PR on purpose: every one of the 18 needs a `gir`-or-`own`
verdict, `feat/ns-construct-props` is currently rewriting every widget file under it, and
landing it in the same change as the coverage ratchet would put two moving denominators in
one diff. The reader that does it correctly already exists — the new coverage gate walks
the chain across the whole package and FAILS when it leaves the package at a class
`ns-core.d.ts` does not declare, because a chain that stops early hands the comparison a
setter set that is short rather than wrong, and a false red is the expensive kind.


### The `@girs/*` vocabulary is consumed — what the migration cost, and the one open decision

**Done.** `gtk-host` builds `props.ts`, `widgets.ts` and `surface-data.mts` from
`@girs/<ns>/vocabulary` (ADR 0029 steps 3 and 4; the § Amendment there carries the
measurements and the rename from `/surface`). `gir.mts`, `tsmap.mts` and the GIR route
are gone with it, and `@gjsify/domparser` is no longer a `gtk-host` dependency.

**The blocker in the old version of this entry was real but overcome-able, and how is
worth keeping.** It said a consumer-side branch "could only resolve against a local
ts-for-gir checkout, which is not something CI can reproduce". True of CI, false of the
work: `@girs` was built locally from the ts-for-gir worktree and grafted into
`node_modules/@girs` behind a marker file, which unblocked the whole consumer side while
the release ran in parallel. Three traps in that recipe, all of which fail QUIETLY:
`--configName` must be repo-relative (an absolute path is ignored and silently falls back
to `modules: ["*"]`), the generator's interactive prompts exit 0 with no artefact unless
fed (`yes ''`), and a long GJS run in the foreground is killed by the sandbox CPU governor
as exit 144. Waiting for a release was never the only option.

**One decision is open, and it is now measured rather than predicted.** This entry used to
forecast that the vocabulary's GIR-stated nullability would narrow `props.ts`, which
widened every object-typed property with `| null`. It did, exactly where forecast:
`'action-target'?: GLib.Variant` where it was `GLib.Variant | null`, same for `cell-area`,
`pointing-to`, `page-setup`, `print-settings` and the rest of the twelve. Total `| null`
occurrences went UP (284 → 356) — the vocabulary states nullability in far more places
than the old blanket rule reached, and takes it away in twelve.

Nothing fails today: `check`, `test` (2276) and `lint` are all green, so no fixture passes
`null` to one of the twelve. The decision is therefore not urgent and not closed — is
GIR's annotation right? GObject accepts `NULL` for most object-typed properties whatever
GIR says, so a narrowing that follows the annotation can still be wrong about the runtime.
The honest way to settle it is to ASK the installed library (set `null` through
`g_object_set` and see whether it is refused), not to pick a side in the types. Until
someone does, the types say what GIR says, which is at least attributable.

**A second thing the release retires.** `checkTypeSkew` in
`packages/infra/cli/src/utils/check-system-deps.ts` carries `isDegenerate()`, which detects
`@girs`' namespace-version-as-release fallback — the value ADR 0019 Decision 3 removed in
ts-for-gir#436. A released `@girs` now omits `libraryVersion` where the library declares
none, so that detector reads for a shape that can no longer be published. It goes away
rather than moving anywhere.

**Still open upstream, found while consuming the vocabulary — two, and each has a
self-retiring guard rather than a note.** First, interface signals: only
`IntrospectedClass.fromXML` reads `<glib:signal>`; `IntrospectedInterface` has no `signals`
field at all, so `GtkEditable`, `GtkCellEditable`, `GtkColorChooser` and `GtkFontChooser`
contribute 8 signals that reach no surface — 7 of which the installed GTK does emit, held
by `leaves no signal of the installed GTK out of the surface` (an `it.failing` in
`generated.spec.ts`). Second, `caller-allocates="0"` out parameters: `@girs` 4.5.0 spells
`GtkSpinButton::input` as `input: (new_value: number) => number`, so reading that slot as a
value type-checks again — the generator used to give it `OutParam`. Held by
`type-tests/jsx/known-hole-out-param.tsx`, which must COMPILE and goes red the day it stops. Fixing it touches the emitter for all 705
packages and is noted in `VocabularyDecl.signals` in ts-for-gir. The sibling defect —
`OWN_SIGNALS` keyed by creatable widget while `OWN_PROPS` is keyed by declaration, which
lost every signal of every abstract base including `GtkWidget`'s 13 — is fixed in
ts-for-gir#456 and needs a release to reach here.


### What else could move to ts-for-gir, and the line that decides it

Asked directly: ts-for-gir is meant to be used as a LIBRARY (ADR 0019), ADR 0029 just
moved the widget vocabulary there, so what else in gjsify is really ts-for-gir's? Audited
2026-08-26 across every module in this repo that carries introspection knowledge. Code
lines exclude comments and blanks, because several of these files are 60 % comment and
counting prose measures the incident record, not the coupling.

**The line, stated once so it does not have to be re-argued per file.** ts-for-gir knows
**GIR as XML**: it parses `.gir` files headlessly, in CI, with no GTK installed and no
typelib loaded. gjsify knows **GI as a loaded runtime**: which libdir girepository will
search, what `gi://Gtk?version=4.0` resolves to on this host, whether the installed
library actually has the member the types promise. Everything below sorts cleanly on that
one question, and the sort is not a judgement call — a module that needs an installed
library cannot move to a generator that runs without one.

**Moves — and it is all one thing, already decided.** ADR 0029 steps 3–5, blocked on the
release above:

ADR 0029 § "The seam, measured" owns the per-module counts and they are not restated
here. What this audit adds is the second, different question — not "how many lines are
GIR-generic" but **"how many lines mention gjsify at all"**, which is what decides
whether a module can compile somewhere else:

| module | code (ADR 0029) | lines referencing gjsify | what holds it here |
|---|---:|---:|---|
| `generator/gir.mts` | 249 | 1 | `import { DOMParser } from '@gjsify/domparser'` |
| `generator/surface.mts` | 196 | 0 | nothing — imports only its two siblings |
| `generator/tsmap.mts` | 100 | 8 | the `@girs/*` package table, and see below |
| `generator/mini.fixture.mts` | 59 | 0 | nothing |
| `generator/emit-types.mts` | 156 | 5 | `tagOf` + the emitted `../attrs.js` import |
| `generator/emit.mts` | 103 | 0 | the runtime table is gtk-host's MODEL (ADR 0028 § 1) |
| `generator/main.mts` | 128 | 3 | `CURATED_DESCRIPTORS` + `methodsOf` wiring |

Read the two questions together and the split is sharper than either alone. The first
four modules are a closed subgraph — 604 code lines whose only edge outside `generator/`
is a single XML-parser import — while `emit.mts` mentions gjsify **nowhere** and still
must stay, because ADR 0029's own column shows only 13 of its 103 lines are GIR-generic:
it is gtk-host's model expressed in pure TypeScript. A module can be free of gjsify
imports and still be entirely about gjsify.

`tsmap.mts`'s 8 lines are worth naming separately, because they are the one case where
the reference points the other way: `GIRS_PACKAGES` maps `Gtk` → `@girs/gtk-4.0`, which
is **ts-for-gir's own naming convention, written down on the wrong side of the
boundary.**

**Does not move, and the reason is the same reason each time.** These read as candidates
because they are full of GI vocabulary, but every one of them needs something a headless
generator does not have:

| module | code | GIR-generic | why it stays |
|---|---:|---:|---|
| `gjs/utils/src/system-gi-dirs.ts` | 44 | 43 | `<libdir>/girepository-1.0` layout — a typelib-LOADING rule |
| `infra/cli/src/utils/system-gi.ts` | 77 | 77 | same rule, plus `DYLD_FALLBACK_LIBRARY_PATH` composition |
| `node-gi/node-gi/system-gi.js` | 70 | 70 | same rule, third copy |
| `infra/cli/src/utils/gi-typelib.ts` | 80 | 80 | finds `Ns-Ver.typelib` on this host |
| `node-gi/scripts/typelib-backers.mjs` | 170 | ~155 | parses the typelib BINARY header; ts-for-gir never opens one |
| `parseGiSpecifier` (two copies) | 9 + 13 | 22 | `gi://` is a GJS import specifier, not a GIR concept |
| `node-gi/src/repo.cc` | 245 | — | N-API binding; `gi_repository_require` IS the runtime |
| `gtk-host/src/conformance/`, `registry.ts` | 165 + — | 0 | walks the LIVE GObject type system, not GIR |
| `docs/gnome-mappings.md` | 12 | 0 | which GNOME lib backs which Node/Web API — a polyfill choice |

**One of those rows is a latent bug, found while sorting them.** `parseGiSpecifier`
exists twice under the same name with DIFFERENT accept sets:
`packages/infra/cli/src/utils/ship/gi-namespaces.ts` validates the namespace against
`/^[A-Za-z][A-Za-z0-9_]*$/` and returns `Ns-Version` as one string;
`packages/infra/rolldown-plugin-gjsify/src/plugins/gjs-gi-node.ts` only checks
non-empty and returns `{ namespace, version }`. So `gi://9Foo` is rejected by the
first and accepted by the second, and the second is the one on the BUILD path — it
would emit a `requireGi('9Foo', …)` shim for a specifier the ship path refuses to
declare a `Depends:` for. Both are Tier 1, so a shared home is legal; it needs a
decision about which accept set is right (the validating one, on the evidence that
GObject namespaces are C identifiers) rather than a mechanical lift. Not done here:
this audit was about the ts-for-gir boundary, and consolidating these is on the other
side of it.

`generated.spec.ts` belongs in this second list for the sharpest version of the reason:
it asks the *installed* typelib whether every emitted name is real. ADR 0029 § Consequences
already fixed it here, and that is what forces the surface to ship runtime data beside the
types.

**Three of those rows are a real duplicate, and ts-for-gir is not its home.**
`systemGiLibraryDirs()` exists three times because ADR 0005 Decision 2 forbids a Tier-1
package a `dependencies` edge on `@gjsify/node-gi` — a tier rule, not a technical
obstacle. Whatever the shared home is, it is not ts-for-gir: the rule is about loading
libraries, and answering "can it move there" with yes would export a runtime concern
into a generator to dodge a tier rule. The tracked fix is § "`systemGiLibraryDirs()`
lives in three places", where the home turns out to be `@gjsify/utils/core` — which
already holds the rule — rather than the new `@gjsify/system-gi` package that entry
used to call for.

**The dependency-direction check, per ADR 0019, and one finding.** ADR 0019 Decision 1
keeps ts-for-gir build-step-free — `@ts-for-gir/lib`'s `exports` is literally
`{".": "./src/index.ts"}` — so a published `@gjsify/*` package taking a
`dependencies` edge on it would hand raw TypeScript to every consumer. Today all SEVEN
published `@ts-for-gir/*` edges in this repo are `devDependencies` on `@ts-for-gir/cli`,
which is the sanctioned seam; `@ts-for-gir/lib` itself appears only under the private
integration test, which declares no tier and publishes nothing.

Two things follow, and the first is the good news:

- **The prize costs no new dependency edge at all.** The surface arrives as generated
  `@girs/*` — `.d.ts` plus a runtime `.js` — and `@gjsify/gtk-host` already declares
  eight `@girs/*` packages. It is Tier 3, so the tier rule constrains it least of
  anything here. ADR 0029 steps 3–5 add zero `@ts-for-gir` dependency.
- **The rule that would catch the mistake does not exist.** `tier.mjs` collects only
  `dep.startsWith('@gjsify/')`, so an external `@ts-for-gir/*` edge in `dependencies` is
  invisible to it, and no other manifest-conformance rule inspects external dependency
  names. ADR 0019's boundary is discipline-only today. Closed in this change by extending
  the rule that already special-cases one package by name.


### ts-for-gir — extend integration suite beyond Phase 4b

Strategic goal: `ts-for-gir` runs unmodified on GJS. Phases 1–9 have landed (see the integration-coverage notes). Remaining:

- **Phase 6 / gjsify run:** runtime npm-package resolution for GJS bundles (GJS has no node_modules resolver; would need a C-level patch).
- **Phase 8 / GVariant type-inference:** full port of `gvariant-validation.test.ts` — requires `@girs` ambient declarations resolvable by the TypeScript compiler.

`refs/ts-for-gir/` is pinned at the commit corresponding to `@gi.ts/parser@4.0.0-rc.9`; bump the submodule alongside the published-package version when porting future phases.


### 17 of 32 `@girs/*` packages cannot be version-checked against the installed library

`gjsify system-check` now compares each `@girs/*` package's declared
`libraryVersion` against `pkg-config --modversion` and reports a `major.minor`
skew — which caught two real ones on the first host it ran on (`@girs/gtk-4.0`
4.23.0 vs GTK 4.22.4, `@girs/adw-1` 1.10.0 vs libadwaita 1.9.2, the second of
which nothing had ever surfaced).

It structurally cannot cover the rest. `libraryVersion` is only an upstream
release where the GIR declares a `<package version>`; otherwise ts-for-gir falls
back to the NAMESPACE version, which is shaped like a version and carries no
information. Measured across 32 installed packages: **12 real, 17 degenerate, 3
absent**. `@girs/gdk-4.0` declares `4.0.0` while GDK ships inside GTK 4.22.4, so
comparing it would report an 18-minor skew that does not exist — the check skips
those by construction rather than guessing, which is a false negative it takes
knowingly.

The 17 include `gdk-4.0` and `gsk-4.0` (GTK's own namespaces), `cairo-1.0`,
`graphene-1.0`, `gdkpixbuf-2.0`, `pangocairo-1.0`, the five `gst*-1.0`
satellites, `libxml2-2.0`, `gudev-1.0`, `gmodule-2.0`, `giounix-2.0`,
`freetype2-2.0`, `gda-6.0`. Several are exactly the libraries a canvas or media
path depends on, so this is not a tail of exotica.

Two ways out, and they are not equivalent:

1. **Fix it at the source.** ts-for-gir could emit a distinguishable value — the
   real `<package version>` when the GIR has one, and an explicit null (or a
   `libraryVersionSource` field) when it does not — instead of silently
   substituting the namespace version. That removes the guess from every
   consumer at once and is the smaller change, but it only helps namespaces whose
   GIR carries the version at all.
2. **Ship the `.gir` beside the artifact.** For the batteries-included bundles
   this is the only exact answer: the installed library's own GIR states its
   version, and `prebuild-artifacts` ALREADY requires a `.gir` next to every
   `.typelib` for packages declaring `gjsify.prebuilds` — for exactly this
   reason, quoting its own header, "it breaks regenerating that bridge's types
   from the artifact it ships". The `@gjsify/gtk-runtime-*` packages declare no
   `gjsify.prebuilds`, so that requirement does not reach them and they ship 37
   typelibs with no `.gir` at all. Bringing them into scope is the follow-up; it
   also unlocks generating types from the shipped artifact, which is the only
   route to types that cannot be skewed rather than merely checked.


### The dialect type surfaces sit outside the adapter import-direction check

`scripts/check-adapter-import-direction.mjs` walks `src/adapters/` and holds every
file there to ADR 0027 § 7: no widget-name literal, no placement method, the
vocabulary comes from the table. `src/jsx-runtime.ts`, `src/vue-components.ts` and
`src/react-jsx-runtime.ts` are dialect surfaces of the same kind and are NOT in
that tree, so the rule does not reach them.

Today nothing is wrong: all three files are mapped types over the generated interfaces
and carry zero widget literals, and the generator is what makes a hand-maintained
tag list unnecessary. The gap is the future one — a surface that starts listing
tags by hand would pass every check in the repo. Extending the walk means teaching
it a second root and adding `generated` to `HOST_INTERNALS`, which is more than a
one-line change because that script cross-checks the published `./<framework>`
subpaths against the adapters tree.


### An unknown hyphenated JSX prop cannot be refused, and only a lint rule can

Measured on TypeScript 5.9.3 and 7.0.2, on intrinsics and on components alike:
every attribute whose name contains a hyphen is exempt from excess-property
checking, so `<gtk-box no-such={1}/>` type-checks clean. Three index-signature
shapes were tried and all three either changed nothing or collided with the
declared kebab keys (TS2411).

Both spellings are generated, so a DECLARED `can-focus={'yes'}` still fails on its
value — the hole is only unknown hyphenated names. Closing it needs something
outside the type system: an oxlint rule over `.tsx` attribute names checked against
`WidgetPropsByTag`, or a dev-mode warning in `setProp` when a kebab name resolves
to no ParamSpec. The second is cheaper and catches Vue templates too, which have
the same hole with `strictTemplates` off.


### The React JSX surface has no half in the negative-first type gate

`scripts/check-type-surfaces.mjs` holds the generated type surface with two named
halves — `jsx` (Solid, `jsx: "preserve"`) and `vue` (SFC templates through
`vue-tsc`) — each with its own fixtures, its own annotation grammar and its own
load-bearing-setting probes. `src/react-jsx-runtime.ts` (`jsx: "react-jsx"`,
`jsxImportSource: "@gjsify/gtk-host/react"`) is a third dialect and has no half.

What IS covered: the element list itself. `GtkReactIntrinsicElements` is a mapped
type over the same `WidgetPropsByTag`/`WidgetClassByTag` the `jsx` half already
checks negative-first, so the tags, the properties, the handler signatures and the
enum nicks are the same members under the same gate. What is NOT covered is the
React-specific plumbing: `JSX.Element`, `JSX.ElementType`,
`JSX.IntrinsicAttributes`, and React's `Ref<T>`/`ReactNode` spellings of `ref` and
`children`. Those are the ones the ADR-0028 § 8 measurements were taken on for
Solid, and they were re-derived by reading rather than re-measured here.

The RUNTIME half is covered: `src/adapters/react.spec.ts` renders a tree built by
this runtime's `jsx()` through the adapter, and asserts that `./jsx-runtime`'s
deliberate refusal still throws.

Adding the half is not a one-liner: `checkJsxHalf()` hardcodes `JSX_DIR`,
`JSX_CONFIG`, `JSX_PROBES` and the sentinel config, and a React half needs its own
probes — at minimum "drop `jsxImportSource` and every negative evaporates" and
"point it at `react` and the 208 HTML/SVG/MathML tags come back". A half without
its probes is the checked-nothing shape that whole script exists to refuse, which
is why it is tracked here instead of half-added.


### The enum numbers exist twice now, with two provenances and one reader each

`@girs` 4.9.0 carries `ENUM_VALUES` in every namespace's vocabulary, read from the same GIR as
the nicks. `packages/framework/gtk-host/src/generated/enum-values.mts` carries the same numbers
read from whatever typelib the maintainer had, written by `scripts/generate-enum-values.mjs`
under GJS and held by `scripts/check-enum-values.mjs` plus `generated.spec.ts`. The second one
exists because the first did not, and ADR 0029 § Amendment 2 said so in as many words: "it
stays the right long-term home, and when it lands the generator here swaps its INPUT and its
output does not change shape".

It has landed, and the two agree: of the 737 values in the committed table 736 match `@girs`
4.9.0 exactly, the one difference is the declared version gap
(`GtkEditableProperties.num-properties` is 8 on the installed GTK 4.22.4 and 10 in the GIR of
4.23.3), and `@girs` also carries the two entries the generating host had to list under
`ENUM_VALUES_UNAVAILABLE`. So the swap is available and what it deletes is real: the GJS-only
generation step, the `ENUM_VALUES_UNAVAILABLE` table with the host-version strings in it, and
one of the artifact's two provenances.

What it COSTS is the reason this is an entry and not a commit. `generated.spec.ts` holds every
number against the typelib that is actually running, which is the genuinely independent oracle
ADR 0034 § 7.3 names; a table read from `@girs` and checked against `@girs` would be a reader
agreeing with itself. The swap therefore has to keep that spec pointed at the typelib while the
DATA comes from the vocabulary — which is the arrangement that makes the disagreement above a
finding rather than a failure. `packages/nativescript-bridge/adwaita/src/widgets/gtk-align.ts`
is the other consumer and it reads the artifact, not the generator, so it is unaffected either
way. `packages/infra/blueprint/src/resolve-ident.mjs` already reads the vocabulary directly and
is the shape the swap would generalise.


### The `@girs` vocabulary gate is per NAMESPACE, so `Gdk.Cursor` and `GObject.Object` have no GType name

**The half of this entry about non-widget DECLARATIONS has closed.** ts-for-gir widened
`PROP_ENUMS` and `DECLS` past the widget surface in `@girs` 5.2.0, so
`Gtk.SizeGroup { mode: horizontal; }` is `1` from both compilers and the
`prop-enums-widgets-only` entry retired from `corpus/divergences.mjs` on the version bump alone,
with no line of `src/resolve-ident.mjs` changed. That file's header records what made the
retirement free, and it is the cheapest kind of fix to mistake for luck.

**The half about NAMESPACES has not, and it is the one a `.blp` in the wild hits.** A namespace
emits a `./vocabulary` subpath only if it declares a concrete `GtkWidget` descendant — 142 of the
705 GIRs, unchanged by the widening. `GtkSource`, `Shumate` and `WebKit` qualify and
`packages/infra/blueprint` now depends on all three, which took the wild sweep from 216 to 221
byte-equal foreign files. `Gdk`, `Gio`, `GObject` and `GLib` do not qualify, although
`Gdk.Cursor` (Muzika), `Gio.Application` and `GObject.Object` (the reference implementation's own
`tests/samples`) are ordinary `.blp` and the oracle compiles all three. Nothing in this repository
can close it: the answer is the GIR's `glib:type-name` — `Gio.ListStore` is `GListStore` and
`GObject.Object` is `GObject`, neither reachable by concatenation — and no artefact those
namespaces publish carries it. `gtypeName` in `src/resolve-ident.mjs` therefore refuses by name,
per ADR 0053 clause 3, and `corpus/refused/namespace-without-vocabulary.blp` holds the case.

**What it would take, and it is a decision and not a patch.** Either the gate widens to any
namespace declaring instantiable GTypes, or the vocabulary keeps its widget scope and a second,
smaller surface carries what a `.blp` needs from every namespace: the GType name, the ancestry,
and the property-to-enum join. The consumer side needs no change to take either — a namespace
arrives in `resolve-ident.mjs` as one import and one dependency line, and everything else, its C
identifier prefix included, is read out of the module. The measurement that argues for it is the
wild sweep over 273 wild `.blp` — 235 of them foreign — that `scripts/blueprint-wild-sweep.mjs`
runs and `docs/reports/2026-09-16-blueprint-subset-gap.md` tables, and those four
namespaces are its whole remaining namespace bill.

**The scope question, stated rather than assumed.** The `@girs` vocabulary is a WIDGET vocabulary
by decision: ADR 0029 emits a surface "only for namespaces that actually declare `GtkWidget`
descendants", ts-for-gir's AGENTS.md binds its generator to the same rule ("only namespaces that
DECLARE a concrete `GtkWidget` descendant emit one"), and `PROP_ENUMS` is keyed by the
declarations inside that surface. Blueprint has no such scope — it instantiates any GObject the
typelib knows, and size groups, event controllers, list-model filters and constraints are the
ordinary ones. So closing this is one of two different things: a small WIDENING (rows in
`PROP_ENUMS` and `DECLS` for the non-widget classes of a namespace that already emits a surface,
which is all the `.blp` files in this repo could need) or a SCOPE CHANGE (a vocabulary for GObject
classes generally, which ADR 0029 did not decide). Which one, and what each costs in emitted
data, was a measurement to be made in ts-for-gir and not here. **The WIDENING is what landed**, in
5.2.0; the SCOPE CHANGE is what the paragraphs above still ask for, and the wild corpus is what
turned it from a hypothetical into a bill of four namespaces.

**What it cost while the widening stood open, kept because it is the failure mode the scope
change still has.** Any `.blp` that set an enum- or flags-typed property on an object the
vocabulary did not describe got its member name where the compiler writes a number. Measured on
0.20.4 beside the corpus file: `Gtk.EventControllerScroll { flags: vertical; }` is `1`, its
`propagation-phase: capture` is `1`, `Gtk.StringFilter { match-mode: prefix; }` is `2`, and the
in-repo emitter wrote all three as written. A single-word member happens to load anyway, because
GtkBuilder resolves an enum nick as well as a number; a member Blueprint spells with an
underscore (`word_char`, `both_axes`) is neither a nick nor a number to GtkBuilder and does not.
So the damage was a file that loads and misbehaves, which is why the namespace half refuses
instead: a `Gdk.Cursor` nobody can name a GType for is an error and not a spelling to pass
through.

