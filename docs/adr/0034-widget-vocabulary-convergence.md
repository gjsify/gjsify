# 34. Every widget surface: named from the GIR, exported as a namespace, remainder declared

- Status: **Proposed** — amended twice on 2026-08-30: § Amendment (the premise under the
  stage order moved; stages 2 and 3 landed first) and § Amendment 2 (stages 6 and 4 landed;
  the property numbers were re-measured and moved)
- Date: 2026-08-29
- Deciders: Pascal Garber
- Related: [ADR 0027 § 9 (the goal)](0027-gtk-host-layer.md), [ADR 0028 § 6 (the alignment mechanism)](0028-widget-table-provenance.md), [ADR 0029 (the vocabulary in `@girs/*`)](0029-girs-widget-vocabulary.md), [ADR 0019 (ts-for-gir as a library; where the `.gir` travels)](0019-ts-for-gir-as-library.md), [ADR 0004 (headless core)](0004-headless-adwaita-core.md), [ADR 0032 (React Native on the host)](0032-react-native-on-the-gtk-host.md), [ADR 0033 (templates preferred)](0033-declarative-templates-preferred.md)

ADR 0027 § 9 records one vocabulary across every surface as a goal and ends: *"The
longer horizon this points at — generating NativeScript and browser builds from one
native-authored source … is **not decided here**. … it would need its own ADR."* This is
that ADR. It does not decide the horizon; it decides the vocabulary the horizon would
need, and refuses six things that look like progress towards it and are not.

**The rule is stated once and binds every surface** — `@gjsify/gtk-host`,
`@gjsify/adwaita-web`, `@gjsify/adwaita-nativescript`, `@gjsify/adwaita-react-native`,
and the next one somebody adds. A rule written as "the NativeScript port should…" binds
nothing that does not exist yet, and the surfaces this repository keeps growing are
exactly the ones that were not there when the last rule was written. § 1 is therefore
surface-neutral; § 2 is a table of where each stands against it today.

The staging follows the **cost curve**, not the severity of the defect, and the two are
not the same surface. § Context measures both.

### How the numbers here were obtained

Every number below is followed by the command that produces it. This paragraph says where
each command was run, because during the drafting of this ADR a set of counts was read out
of a **shared checkout sitting 43 commits behind `main`**, and every one of them was
plausible and wrong. A count with no stated revision cannot be re-measured; it becomes
folklore about a tree nobody has any more.

| source | what was read there | how to reproduce |
|---|---|---|
| **this repository at `main`** | every widget, tag, element, page and gate count | the quoted command, from the repository root |
| `refs/libadwaita`, pinned at `42f647ff` | upstream widget existence (`AdwSliderRow`, `.image-button`) | `git ls-tree HEAD refs/libadwaita` states the pin; the submodule must be initialised — **89 of 95 are not by default, and `grep -r` over an uninitialised one searches nothing**, so every claim of absence below carries a control string |
| **`@girs/gtk-4.0@4.1.0`**, the version `gtk-host/package.json` declares (`libraryVersion` 4.23.0) | the type-surface sizes (509 / 151 / …) | pin the version: `^4.1.0` resolves to **4.3.0** today, and these counts move with it |
| **the npm registry** | published versions, downloads, package sizes | `npm view <pkg> …`, revision-independent |

The one number that matters most — the property distance, **45** — is deliberately not
left in prose at all: stage 6 makes a check print it. Every count written into prose in
this area has drifted at least once, including inside the file whose own rule is that
counts drift.

Anything unmeasured is marked UNVERIFIED.

## Context

### The same widget, four spellings, on one documentation page

`website/src/content/docs/adwaita/controls.mdx:52-98` renders one gallery block whose
title is `Gtk.Entry`. Inside it:

| fence | how the widget is named |
|---|---|
| markup | `<adw-entry placeholder="Search files…">` |
| GJS | `new Gtk.Entry({ placeholderText: 'Search files…', widthRequest: 280, halign: Gtk.Align.CENTER })` |
| Blueprint | `Gtk.Entry { placeholder-text: _("Search files…"); halign: center; }` |
| NativeScript | `const entry = new AdwEntry(); entry.placeholder = 'Search files…'` |

Two of the four fences spell `Adw` for a widget the block itself titles `Gtk`, and the
prose two paragraphs above them (`controls.mdx:14-17`) says why that is wrong:

> Neither carries an `Adw` prefix, and that is the point worth knowing about them:
> Libadwaita ships no entry and no drop down of its own. They are `Gtk.Entry` and
> `Gtk.DropDown`, and what makes them look Adwaita is the stylesheet.

The gallery's own titles already follow the GIR. Measured: 40 `<AdwWidget>` blocks, 36
titled `Adw.*` and 4 titled `Gtk.*` — and the four are exactly `Gtk.Button`,
`Gtk.DropDown`, `Gtk.Entry`, `Gtk.MenuButton`.

```sh
grep -rhoE '<AdwWidget title="[A-Za-z.]+"' website/src/content/docs/adwaita/ \
  | sed 's/.*title="//;s/"//' | sed 's/\..*//' | sort | uniq -c
```

### What each surface ships — measured

| surface | vocabulary | count |
|---|---|---|
| `@gjsify/gtk-host` (`src/generated/widgets.ts`) | GIR-derived kebab tags | **168** — 63 `Adw*`, 105 `Gtk*` |
| `@gjsify/adwaita-web` | `adw-*` custom elements | **65** |
| `@gjsify/adwaita-nativescript` | `Adw*` view classes in `adw-*.ts` | **46** |
| `@gjsify/adwaita-react-native` | `Adw*` components | **2** (`AdwBin`, `AdwClamp`) |

```sh
grep -c "gtype: '"    packages/framework/gtk-host/src/generated/widgets.ts   # 168
grep -c "gtype: 'Adw" packages/framework/gtk-host/src/generated/widgets.ts   #  63
grep -c "gtype: 'Gtk" packages/framework/gtk-host/src/generated/widgets.ts   # 105
node -e "import('./scripts/adwaita-elements.mjs').then(m=>{const r=process.cwd();
  console.log('web',m.adwaitaWebElements(r).size,'ns',m.adwaitaNativeScriptWidgets(r).size)})"
```

The gtk-host surface is the one that is already right, and it is right by construction:
`packages/framework/gtk-host/src/tags.ts` derives the prefix from the GType, so
`GtkButton → gtk-button` and `AdwSpinRow → adw-spin-row`. On that surface the prefix is a
consequence. On the two Adwaita renderers it is a constant.

The directory holds 89 files (`ls packages/nativescript-bridge/adwaita/src/widgets | wc -l`);
46 of them are widgets. `scripts/adwaita-elements.mjs`
already exempts `adw-accent.ts` (two functions that push CSS at `Application`; no class,
no view) and throws if any other `adw-<name>.ts` fails to export `Adw<Name>` — so the
convention is machine-enforced today, one layer below where this ADR proposes to hold it.

### The clearest instance is inside one repository, and needs no cross-runtime argument

The NativeScript case takes a paragraph to set up. This one does not: **two surfaces in
this repository, both authored as element tags, name the same GTK widget differently.**

```
@gjsify/gtk-host  (Solid, Vue and React alike)   <gtk-entry placeholderText="…" />
@gjsify/adwaita-web                              <adw-entry placeholder="…"></adw-entry>
```

Both spellings appear on the same gallery page, inside one block titled `Gtk.Entry`
(`website/src/data/adwaita-framework-snippets.ts:60-62` against `controls.mdx:56`).
gtk-host derives its prefix from the GType (`src/tags.ts:18`), so it says `gtk-entry` for
all three dialects without anyone choosing; adwaita-web says `adw-entry` for the same
widget.

**One thing has to be said accurately, because the sharper-sounding version is false.**
These are not two browser renderers disagreeing: gtk-host renders to real GTK widgets and
adwaita-web renders to the DOM, and adwaita-web has no Solid/Vue/React binding at all
(gtk-host exports `./solid`, `./vue`, `./react`; adwaita-web exports none). They differ in
render target. What they do **not** differ in is what the widget *is* — and the vocabulary
goal in ADR 0027 § 9 names both surfaces in one sentence, so the disagreement is inside
the goal's own scope, not across it.

**Scale: 21 of adwaita-web's 65 elements do not share a spelling with a GTK tag** — 10
declared as the same widget under another name, 11 declared web-only.

And this is where the mechanism is already **working**: `WEB_ELEMENT_ALIGNMENT` carries
`'adw-entry': { gtk: 'gtk-entry' }` today, the check holds it in both directions, and a
new undeclared element fails. It is also where its one hole is visible — see § below.

### Where the NativeScript port's 46 names land against the GIR

```sh
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { adwaitaNativeScriptWidgets } from './scripts/adwaita-elements.mjs';
const tags = new Set([...readFileSync('packages/framework/gtk-host/src/generated/widgets.ts','utf8')
  .matchAll(/tag: '([^']+)'/g)].map(m=>m[1]));
const ns = [...adwaitaNativeScriptWidgets(process.cwd()).keys()].map(n=>'adw-'+n);
console.log('adw tag exists:', ns.filter(t=>tags.has(t)).length);
console.log('gtk tag exists:', ns.filter(t=>!tags.has(t)&&tags.has('gtk-'+t.slice(4))).join(' '));
console.log('neither       :', ns.filter(t=>!tags.has(t)&&!tags.has('gtk-'+t.slice(4))).join(' '));
"
```

- **38** share a spelling with a real `Adw*` tag. Correct as they stand.
- **4** are GTK widgets wearing an `Adw` prefix: `AdwButton`, `AdwDropDown`, `AdwEntry`,
  `AdwMenuButton` — the same four the gallery titles `Gtk.*`.
- **4** have no tag under either spelling. Those are the interesting ones, and naming them
  is not the same as explaining them.

### The four with no counterpart, read from their files

Not inferred from the names — each classified from what the class actually builds.

| widget | what the file builds | verdict |
|---|---|---|
| `adw-icon` | `export class AdwIcon extends Image` — *"A non-interactive `Image` that renders an Adwaita symbolic SVG"* (`adw-icon.ts:1-4,24`) | **Same widget, different spelling.** It is `Gtk.Image`. `adwaita-web` already declares exactly this: `'adw-icon': { gtk: 'gtk-image' }`. |
| `adw-image-button` | `extends GridLayout` holding a centred `Image` — *"NativeScript's `Button` is text-only (it cannot host a child view), so an icon button is a tappable `GridLayout`"* (`adw-image-button.ts:6-8`) | **Same widget, different composition.** Upstream `.image-button` is a style class on `button` (`refs/libadwaita/src/stylesheet/widgets/_buttons.scss:66`), not a type: on GTK this is `Gtk.Button` with a `Gtk.Image` child. Converges in NAME (`gtk-button`), never in shape. |
| `adw-slider-row` | `extends StackLayout`: a title + live-value header over a `Slider` — *"the NS counterpart of the GTK storybook's `Gtk.Scale` RANGE card"* (`adw-slider-row.ts:3-6`) | **No counterpart type.** libadwaita 1.10.alpha.1 has no `AdwSliderRow`; it is a composite of a row and `Gtk.Scale`. Declared, left alone. |
| `adw-data-grid` | `extends GridLayout`, one grid, cells as direct children — *"the grid itself is a @gjsify/adwaita-\* widget, not a port"* (`adw-data-grid.ts:51`) | **No counterpart at all.** An original widget. `adwaita-web` declares its own copy web-only, with the assembly named: *"a presentational aligned grid; the GTK counterpart is a plain Gtk.Grid"*. |

The `AdwSliderRow` absence is measured against upstream with a control string, because an
empty grep looks the same as a grep that searched nothing (`refs/libadwaita` is **not**
checked out in every worktree; this was read at
`/home/jumplink/Projekte/werkstatt/gjsify/gjsify/refs/libadwaita`, submodule present, 19
entries):

```sh
grep -ric sliderrow refs/libadwaita | grep -v ':0' | wc -l   # 0
grep -ril AdwSpinRow refs/libadwaita/src | wc -l             # 5  <- the control
```

So the "no GIR counterpart" set is not one thing. Two of the four are the same widget
under another name or another assembly and should converge; two genuinely have no
counterpart and should be declared and left. Collapsing them into one bucket reads tidier
than the tree is.

### Was the flattening a decision? No — and the repository argues against it

Searched: every `docs/adr/*.md`, all 14 `AGENTS.md`
(`find . -name AGENTS.md -not -path './node_modules/*' -not -path './refs/*' | wc -l`),
`status/`, the package READMEs, the
website content, `showcases/`, and the introducing commits. **No stated rationale
exists**, on either surface.

- On `adwaita-web` the rule is asserted as an input, never argued —
  `scripts/adwaita-elements.mjs:19-20`: *"`adw-` is the whole naming rule the tree
  follows"*. It is then derived mechanically from a page title in
  `website/src/components/AdwWidget.astro:162-167`, whose comment states the mismatch
  while performing it: *"libadwaita ships no menu button, and the pillar still spells
  that element `<adw-menu-button>`, so the namespace is dropped and `adw-` prefixed."*
  Nothing anywhere invokes the custom-element hyphen requirement as the reason — the
  plausible defence for the web surface is not the one the repository makes.
- On the NativeScript port the convention is *enforced* without being justified
  (`adwaita-elements.mjs:668-676`, throwing at `:695`, when `adw-<name>.ts` does not
  export `Adw<Name>`), and the three introducing commits — `0b2f25549`, `f5ba5115d`, `4cb935457`
  — discuss behaviour and never naming.
- ADR 0032 § *What this does not decide* names the hole explicitly: *"**The NativeScript
  component vocabulary.** `packages/nativescript-bridge` is a fine thing on its own terms
  and shortens this path by nothing."*

The closest thing to an argument is `adw-button.ts:5-8` — *"Mirrors how libadwaita buttons
get their look from a CSS style class rather than a distinct widget"* — which explains why
the widget exists, not why it is spelled `Adw`. This ADR therefore overturns a
**convention**, not a decision; there is no reasoning to preserve, and saying so is the
point of having looked.

UNVERIFIED: whether the upstream `adwaita-web` project (`refs/adwaita-web`, not checked
out in any worktree here) defines `adw-*` custom elements and is the unstated origin of
the web spelling.

### Three ledgers already exist; none of them records a namespace

The repository has already built this shape three times:

1. `WEB_ELEMENT_ALIGNMENT` in `scripts/check-vocabulary-alignment.mjs` — every `adw-*`
   element whose spelling is not a GTK tag is either `{ gtk: '<tag>' }` or
   `{ webOnly: '<reason>' }`. Live: `44 share a spelling, 10 alias one, 11 declared
   web-only` (`node scripts/check-vocabulary-alignment.mjs`).
2. The one-renderer ledger in `scripts/check-storybook-widget-coverage.mjs` — a
   *discriminated* pair, `{ only, decision }` versus `{ only, gap }`, because *"the moment
   'we would have to build it' is allowed to sit in `decision`, every gap can be spelled
   as a reason and nothing is recorded."* It already carries `image-button`, `slider-row`
   and `data-grid`.
3. `CANNOT_HONOUR` in `scripts/check-storybook-control-parity.mjs` — the same shape one
   level down, at property granularity.

What none of them records is which GIR type a NativeScript class **is**. And the
vocabulary check does not read the NativeScript surface at all:

```sh
grep -ic nativescript  scripts/check-vocabulary-alignment.mjs   # 0
grep -ic adwaita-web   scripts/check-vocabulary-alignment.mjs   # 3  <- the control
```

That is why no gate could have caught the four flattened GTK widgets: the surface that
carries them is outside the check's world. (**Closed 2026-08-30**: the first grep no
longer answers 0 — 22 lines at the landing commit against 6 for the control, a line count
that moves with any edit to the file, which is why the load-bearing form of the claim is
"not zero". The measurement is kept as written because it is the evidence for the gap, and
a fixed gap with its evidence deleted is a rule with no reason left.)

### The flattening is load-bearing today, and that has to be paid for

`collectAdwaitaCoverage` in `scripts/generate-status.mjs:253-256` joins the three
renderers on the **bare** name — `adw-button` (web), `AdwButton` (NS), `button.meta.ts`
(GTK storybook) — and says so at `:223-225`: *"The three vocabularies agree on the bare
name, so this needs no alias table."* That sentence is true only because all three
flattened. Any rename that is not carried through this join manufactures false gaps in
the published widget matrix. The join key must survive whatever this ADR does.

### The documentation files GTK widgets under "Adwaita", and its own rename says why that is wrong

The website has one top-level widget section, `Adwaita`, holding ten pages
(`website/astro.config.mjs:146-160`). There is no `Gtk` section. Measured across the eight
gallery pages that carry widget blocks:

| page | `Adw.*` blocks | `Gtk.*` blocks |
|---|---:|---:|
| `controls.mdx` | **0** | **2** (`Gtk.Entry`, `Gtk.DropDown`) |
| `buttons.mdx` | 3 | 2 (`Gtk.Button`, `Gtk.MenuButton`) |
| the other six | 33 | 0 |

```sh
for f in website/src/content/docs/adwaita/*.mdx; do
  printf '%-22s Adw=%s Gtk=%s\n' "$(basename $f)" \
    "$(grep -c '<AdwWidget title="Adw\.' $f)" "$(grep -c '<AdwWidget title="Gtk\.' $f)"
done
```

**`controls.mdx` has no Adwaita widget on it at all.** Every block it carries is a GTK one,
under a heading named for a different library, and its own prose says so
(`controls.mdx:14-17`).

The section was renamed from `/widgets/*` to `/adwaita/*` deliberately, and the reason
given is the rule this ADR states, one level up (`website/astro.config.mjs:18-20`):

> `/widgets/*` became `/adwaita/*`: the section only ever covered Adwaita, and naming it
> after the design system leaves room for a second one (Material, say) **beside** it
> rather than **under** it.

That was right when it was written and its premise has since stopped holding: the section
no longer only covers Adwaita. The correction is not to undo the rename — it is to apply
the same sentence a second time and put `Gtk` **beside** `Adwaita`, not under it. A surface
that spells `Gtk.Entry` correctly while the documentation files it under Adwaita has moved
the inconsistency rather than removed it.

### Why the distance has to be PRINTED by a gate and not written in prose

Checked while measuring the above, because the ADR leans on a count that someone will
later want to restate — and because a first reading of the same file produced a plausible
wrong conclusion, which is the part worth recording.

**The generated header is not drifted, and the gap is not an off-by-four bug.**
`emit-types.mts:144` emits `${model.declarations.size} interfaces for
${model.widgets.length} widgets`, rendering today as *"194 interfaces for 168 widgets"*,
while `grep -c '^export interface '` answers **198**. The four are named, and the header's
own sentence already excludes them — *"one interface per GIR declaration … **plus** the
[…] tag maps"*:

```sh
grep -n '^export interface ' packages/framework/gtk-host/src/generated/props.ts \
  | grep -E 'interface Widget'
# WidgetPropsByTag  WidgetPropsByGType  WidgetPropsVueAliases  WidgetClassByTag
```

198 − 4 = 194. The same subtraction held at the previous revision (190 + 4 = 194 emitted
interfaces then), so the constant gap is the constant number of tag maps, not an
accumulating error. What a `grep` for `export interface` counts and what the header counts
are two different questions, and only one of them is the generator's.

The **hand-written** counts around it are the ones that drifted. `164` — the widget count
before ADR 0028's 2026-08-28 amendment admitted placement carriers — still stands in three
places:

```sh
grep -c "gtype: '" packages/framework/gtk-host/src/generated/widgets.ts   # 168
grep -rn "164 widgets\|164 tags\|164 GTK tags" docs/ packages/framework/AGENTS.md scripts/
```

`docs/adr/0028:322,333`, `packages/framework/AGENTS.md:66` — in a sentence that itself
warns *"a literal here drifted twice"* — and `scripts/check-vocabulary-alignment.mjs:37`.
(That third one is gone as of 2026-08-30: the header now carries no count at all and the
summary line derives every number it prints. The first two stand.)
(`status/open-todos.md:181` also says 164 and is not wrong: it is explicitly framed *"at
the time it landed"*.) One genuine generator nit alongside them: that header says *"the
**two** tag maps"* while it emits four; a one-word fix in `emit-types.mts`, its own PR.

Nothing here changes a decision. It is the reason § Implementation makes the 45 a number a
check PRINTS rather than a number this ADR states: every count written into prose in this
area has drifted at least once, including inside the file whose rule is that counts drift.

### The cost of adopting the rule is a curve, and it is already measured

A naming-and-namespace rule costs what has already been built under the old one. That is
the argument that killed the NativeScript rename below, and it is the same argument that
makes one surface nearly free **today and not for much longer**:

| surface | widgets | published versions | downloads / month | in-repo consumers |
|---|---:|---:|---:|---|
| `@gjsify/adwaita-web` | 65 | published (0.44.0) | 5 127 | the gallery, the storybook |
| `@gjsify/adwaita-nativescript` | 46 | **49** | **3 761** | 49 TS import sites, 50 `.mdx` fence lines / 9 pages, 108 XML tags / 28 files |
| `@gjsify/adwaita-react-native` | **2** | **none — npm 404s** | **0** | **0 outside the package** (5 specs inside it) |

> **Superseded on 2026-08-30**: the third row published that morning. The row is left as
> written because the § Amendment below is about what happens when a premise moves, and
> deleting the premise deletes the correction. Re-measured figures are there.

```sh
npm view @gjsify/adwaita-nativescript versions --json | tr -d '[]" ' | tr ',' '\n' | grep -c .
npm view @gjsify/adwaita-react-native version        # npm error: 404
curl -s https://api.npmjs.org/downloads/point/last-month/@gjsify/adwaita-react-native
git log --oneline -- packages/framework/adwaita-react-native   # one commit
grep -rlE "from '@gjsify/adwaita-nativescript(/[a-z-]+)?'" --include='*.ts' --include='*.tsx' . \
  | grep -v node_modules | wc -l                               # 49
grep -rn '@gjsify/adwaita-react-native' --include='*.ts' --include='*.tsx' packages showcases tests website \
  | grep -v node_modules | grep -v '^packages/framework/adwaita-react-native/' | wc -l   # 0
```

`@gjsify/adwaita-react-native` landed in **one** PR (#1380), carries exactly `AdwBin` and
`AdwClamp` — *"`AdwBin`+`AdwClamp` only, on purpose"* (`packages/framework/AGENTS.md:17`)
— and is `private: false` at version 0.44.0, which means **it publishes on the next
release cut**. Both its names are already correct. So adopting the rule there today costs
a namespace export and a ledger with no entries in it; adopting it after the cut costs
what the NativeScript rename costs, on a schedule nobody sets deliberately.

It is also the surface ADR 0032's track is actively growing — the same ADR that lists
*"the NativeScript component vocabulary"* and *"a `.web` export over
`@gjsify/adwaita-web`"* under **What this does not decide**, i.e. two of the three
surfaces here were explicitly deferred to an ADR that did not exist.

**This is why the staging below is not ordered by severity.** The worst-named surface is
NativeScript. The clearest to argue is adwaita-web. The cheapest — and the only one whose
cost is rising on a known date — is React Native, so it goes first.

### The construction shape, measured on all three

**GJS.** `@girs/gtk-4.0@4.1.0` (`gtk-4.0.d.ts:40187,40894`):

```ts
class Entry extends Widget implements Accessible, Buildable, CellEditable, ConstraintTarget, Editable {
    constructor(properties?: Partial<Entry.ConstructorProps>, ...args: any[]);
```

The props bag is the first, optional, positional argument. `ConstructorProps` spells
snake_case **and** camelCase (never kebab). `Gtk.Align` is a declaration-only `enum` in a
`.d.ts` — it emits nothing; the runtime values come from the typelib.

**gtk-host.** `createElement` records props and builds nothing; `materialize`
(`src/host.ts:92-114`) calls `new Klass(initial)` in one shot, *"because construct-only
properties must all be known at `g_object_new` time"*. Names are normalised to kebab
(`src/props.ts:29`), values coerced against the `GParamSpec` read from the installed GTK,
and an enum accepts the nick **or** the constant — `halign?: GtkAlignNick | Gtk.Align`
(`src/generated/props.ts:5672`).

**NativeScript.** `AdwEntry extends GridLayout` with `constructor()` — no parameters
(`adw-entry.ts:51,57`). Every `@nativescript/core` base is declared `constructor()`
(`ui/core/view-base/index.d.ts:368`), and `Observable`'s own docs call the props-bag form
*"obsolete since v3.0"*. The reason is structural: NativeScript's XML builder is

```js
const instanceType = instanceModule[elementName];
instance = new instanceType();                     // component-builder/index.js:85
```

— unconditional, no-arg, with attributes assigned afterwards one at a time by
`instance[propertyName] = propertyValue`, raw string, no conversion. The port records that
in `src/widgets/xml-values.ts:6-12` and ships exactly two coercions, `xmlNumber` and
`xmlBoolean`. There is no enum mechanism anywhere in the port: `grep "export enum"` finds
one hit and it is an ambient re-declaration of NativeScript's own `GestureTypes`.

### What `new Gtk.Entry({ … })` on NativeScript actually needs

Ranked, from the measurements above.

**Cheap.**

- `placeholder` → `placeholderText` is one accessor. Measured: of `AdwEntry`'s five
  settable properties, four (`text`, `textLength`, `maxLength`, `editable`) are already
  keys of `Gtk.Entry.ConstructorProps`; only `placeholder` is not.
- An optional props-bag parameter is compatible with the XML builder, which passes no
  arguments. The precedent exists in the tree: `AdwAlertDialog` already takes
  `constructor(heading = '', body = '')` — and it is precisely the class that
  `extends Observable`, is not a `View`, and is absent from the `ELEMENTS` map, so XML
  never constructs it. Every XML-reachable class is no-arg today.
- A `Gtk` / `Adw` namespace object. On GJS these are the GI namespaces and nothing more:
  `@girs/gtk-4.0/gtk-4.0.js` is, in full, `import Gtk from 'gi://Gtk?version=4.0'; export
  default Gtk;`. On a target with no GI, a namespace is an object literal.

**Not cheap.**

- `Gtk.Align.CENTER` needs a value table, and the mapping is **not total**. GTK has seven
  members (`fill=0, start=1, end=2, center=3`, plus three `baseline*`); NativeScript's
  `horizontalAlignment` vocabulary is `'left' | 'center' | 'right' | 'stretch'`. `start`,
  `end` and all three baselines have no counterpart. This single example is why the target
  below is convergence with a declared remainder rather than a bijection.
- `widthRequest` has no NativeScript equivalent: zero hits in the port, and `View.width`
  is an *exact* size where GTK's `width-request` is a *minimum*.
- A bag applier re-opens the failure `xml-values.ts` exists for. `instance[key] = value`
  on a plain class with an unknown key adds a dead own-property at exit 0 — a new
  silent-drop surface unless the bag goes through declared setters.
- There is no `GParamSpec` on NativeScript, so nothing can validate a value at runtime the
  way `coerce()` does. Any equivalent is a static table.

### How large is the gap against `@girs`, really

`@girs/*` is a **type** package with a two-line runtime that re-exports `gi://`, so
"satisfy the `@girs` surface" is a meaningful target. **It is a second reader of our own
source, not a second source.** `generated/props.ts` imports `@girs/adw-1`, `gtk-4.0`,
`gdk-4.0`, `gio-2.0`, `glib-2.0`, `gobject-2.0` and `pango-1.0`, and `@gjsify/gtk-host`
declares eight `@girs/*` packages as runtime dependencies — so ts-for-gir's derivation is
already inside the type surface the ledger compares against, and both derivations read the
same `.gir`. Agreement between them is worth having and is not proof about GTK; that
distinction is what § Alternatives turns into a rejection. Measured with the TypeScript
compiler API against `@girs/gtk-4.0@4.1.0` / `@girs/adw-1`:

Measured against `@girs/gtk-4.0@4.1.0` / `@girs/adw-1@4.1.0` — the versions
`packages/framework/gtk-host/package.json` declares. `^4.1.0` resolves to 4.3.0 today, and
these counts move with the version, so re-measure before quoting them elsewhere.

| type | members | of which methods | `ConstructorProps` keys |
|---|---:|---:|---:|
| `Gtk.Entry` | 509 | 357 | 151 |
| `Adw.ActionRow` | 388 | 303 | 84 |
| `Gtk.Widget` | 319 | 259 | 59 |

The NativeScript `AdwEntry` implements 4 of 151 construct properties; `AdwActionRow`
implements 4 of 84 (`activatable`, `activatableWidget`, `subtitle`, `title` — all four
already correctly spelled). `AdwDataGrid` has no `@girs` type to be measured against at
all, which is the third answer and the reason the remainder needs a declaration rather
than a number.

A `tsc` structural conformance check is therefore **not** worth proposing —
`const e: Gtk.Entry = nsEntry` reports *"missing the following properties … and 501
more"*, and closing that would mean implementing GTK on NativeScript. **Not, however, for
the reason an earlier draft gave.** It is true that the job running these gates is
`checkout` + `setup-node` with no install (`audit-runtimes.yml:10-24`), and that is a job
configuration rather than a limit: `tree-checks` in `main.yml` installs, hosts two gates
moved there for precisely that reason, and a 42-widget `tsc` program measures 1.5 s. The
rejection has to stand on what the check would prove, and § Alternatives is where it does.

What **is** measurable is the name half, and it is already two-thirds done. Across the 42
NativeScript widgets that have a GIR counterpart, 137 settable properties: **92 are
already a key of that counterpart's `ConstructorProps`; 45 are not.** Of the 45, 16 have a
candidate GIR spelling sitting right there (`placeholder`→`placeholderText`,
`icon`→`iconName`, `selectedIndex`→`selected`, `menu`→`menuModel`, …) and 29 have no
candidate at all (`AdwSpinRow.min/max/step` against GTK's `adjustment`,
`GtkButton.variant`, `AdwTabView.views/tabs`, …). That 45 is the distance to the goal, it
is printable, and it can only go down when someone decides it should.

### The mechanism this converges towards already exists

`gi://Ns?version=X` is not a GJS-only specifier in this repository; it is the **runtime
axis**, with a per-target resolution:

| target | what `gi://Gtk?version=4.0` resolves to |
|---|---|
| `--app gjs` | the real native protocol; external by prefix (`src/app/gjs.ts:344`) |
| `--app node` | a virtual module whose default export is a lazy `Proxy` over `requireGi('Gtk','4.0')` (`plugins/gjs-gi-node.ts`) |
| `--app browser` | an empty virtual module (`plugins/gjs-imports-empty.ts`) |
| `--app nativescript` | an empty virtual module — same plugin (`src/app/nativescript.ts:14-16`) |

`gjs-gi-node.ts`'s own header states the split this ADR builds on: *"`@girs/*` is
deliberately NOT claimed here … Those are ambient/type packages whose VALUE entry
re-exports `gi://`."* So `gi://` is what gets aliased and `@girs` is what says whether the
alias is honest — and the carve-out that makes the two compose already exists as
`emptyGirs: false`, enabled on the node-gi path so `@girs/adw-1` resolves to its real body
and its inner `gi://` is rewritten.

Its sibling states the contract a substitute must meet, and the failure when it does not
— `gjs-imports-empty.ts:14-19`: mapping `@girs/*` to an empty module *"would strand the
import as `{}`, and a `class extends ({}).Bin` throws `Class extends value undefined`."*

**This is what makes the namespace object load-bearing rather than cosmetic.**
`gi://Gtk` evaluates to a namespace. A module that substitutes for it must *export* a
namespace or it is not substitutable at all. `Gtk.Entry` is a precondition of the
mechanism, not a style preference.

## Decision

### 1. The rule, stated once, binding every surface — present and future

**A widget-bearing surface in this repository:**

1. **names a widget after the library that owns its GType.** `GtkEntry` is `Gtk.Entry` /
   `gtk-entry`, `AdwActionRow` is `Adw.ActionRow` / `adw-action-row`. The namespace is
   read from the GIR, never chosen per surface — `gtk-host` already does exactly this
   (`src/tags.ts:18`) and is the reference implementation of the clause;
2. **exports its widgets through a namespace object** (`Gtk`, `Adw`) as well as however
   else it exports them, so the same expression names the same widget everywhere;
3. **declares every divergence from 1 and 2, with a reason.** An UNDECLARED divergence is
   what goes red.

**And the documentation follows the same split as the code.** A widget documented under a
library it does not belong to has moved the inconsistency, not removed it — the website's
own rename from `/widgets/*` to `/adwaita/*` already argued for a sibling section *beside*
rather than *under*, and this is that sentence applied a second time. `Gtk` becomes a
top-level docs section alongside `Adwaita`; the four `Gtk.*` gallery blocks move to it, and
`controls.mdx` — which carries no Adwaita widget at all — moves whole.

That is the whole rule, and it is deliberately written about *a surface* rather than about
any of the four that exist. The two surfaces this ADR is fixing were both explicitly
deferred by ADR 0032 (*"the NativeScript component vocabulary"*, *"a `.web` export over
`@gjsify/adwaita-web`"*) to an ADR that did not exist, and the fifth surface will be added
by someone who never reads this file. A rule phrased per port does not reach them.

**Convergence with a declared remainder, never a bijection.** Full translatability is not
the goal and is not reachable: `Gtk.Align` has seven members against NativeScript's four,
and `AdwDataGrid` has no counterpart to converge towards. An ADR that only worked if every
widget mapped cleanly would be refuted by its own first example. A compromise is a recorded
decision and drift is a failure — which is the distinction "as close as possible" needs in
order to survive six months, because nobody notices a surface drifting one widget at a time.

Declarations are a discriminated union, following the precedent in
`check-storybook-widget-coverage.mjs` rather than a free-text field:

- `{ gir: 'GtkImage', why: '…' }` — the same widget under another spelling. It should
  converge; the entry says why it has not yet.
- `{ composes: ['GtkButton', 'GtkImage'], why: '…' }` — the same UI, assembled differently
  because the platform forces it. Converges in name, never in shape. `adw-image-button` is
  this.
- `{ own: '…' }` — no counterpart type. `adw-slider-row` and `adw-data-grid` are this.
- `{ gap: '#NNNN' }` — nobody has decided. Not a reason; a pointer.

**And the reason field is required on every kind, including the alias kind.** Today
`WEB_ELEMENT_ALIGNMENT`'s `gtk:` entries carry no reason at all, so an alias satisfies the
check permanently and silently. That asymmetry is the hole this ADR closes: `webOnly`
without a reason was rejected as *"indistinguishable from an oversight"*, and an alias
without one is indistinguishable from a decision nobody made.

### 2. Where each surface stands against the rule today

| surface | clause 1 (GIR naming) | clause 2 (namespace) | clause 3 (declared) | remainder |
|---|---|---|---|---|
| `@gjsify/gtk-host` | **holds by construction** — the prefix is derived from the GType | n/a: the tags *are* the vocabulary, and `@girs` supplies `Gtk`/`Adw` | n/a | none |
| `@gjsify/adwaita-web` | **violated for 10 elements** (`adw-entry` is `GtkEntry`, …) | **absent** — registers tags, exports no namespace | **half-held**: every one of the 21 is declared, but the 10 aliases carry no reason | 11 web-only, each with a reason |
| `@gjsify/adwaita-nativescript` | **violated for 4** (`AdwEntry`, `AdwButton`, `AdwDropDown`, `AdwMenuButton`) | **absent** | **held since stage 3** for widget names and **since stage 6** for property names | 2 with no counterpart; property names re-measured in § Amendment 2 |
| `@gjsify/adwaita-react-native` | **holds** — `AdwBin`, `AdwClamp` | **absent** | **held since stage 4**: it declares itself a surface and is read | none, today |
| the docs | `controls.mdx` is 100 % GTK under an `Adwaita` heading; 4 `Gtk.*` blocks in all | there is no `Gtk` section | no | — |
| the next surface | — | — | — | — |

Read the table as the work list. It is also the argument for the ordering in
§ Implementation: the only row whose remainder is empty is the one where adopting all
three clauses is nearly free, and it is the row whose cost rises at the next release cut.

### 3. The namespace is a RE-EXPORT layer, never a rename

Clause 2 is satisfied by an export, not by moving anything. Each surface gains

```ts
export const Gtk = { Button: …, DropDown: …, Entry: …, Image: … };
export const Adw = { ActionRow: …, Bin: …, Clamp: … };
```

whose members are the classes or element constructors that surface already has, and where
`@gjsify/adwaita-nativescript` also gains a second XML barrel so `xmlns:gtk="~/gtk"`
resolves `<gtk:Entry/>`. **All of it is additive.** `AdwEntry` keeps working, `<adw-entry>`
keeps working, and no published name moves.

The cost differs sharply by surface, and that is the whole staging argument:

- **`@gjsify/adwaita-react-native`** — two members, both already correctly named, nothing
  published. The export *is* the adoption.
- **`@gjsify/adwaita-web`** — 44 members whose spelling already matches plus 10 whose
  namespace the alignment table already knows, so the object is derivable from data that
  exists. Custom-element constructors are constructors; `new Adw.ActionRow()` is legal
  once the element is defined.
- **`@gjsify/adwaita-nativescript`** — the largest, and the only one where the mapping has
  to be written before it can be generated.

A flat `GtkEntry` class would be a third spelling rather than a convergence, and it still
would not satisfy the `gi://` substitution contract in § 6 — that contract wants a
namespace, not a differently-prefixed class.

**Placement is derived from the ledger, not chosen twice.** Which namespace a widget lands
in is exactly what its § 1 entry declares, so the object is generated from the table. A
hand-kept second list is the arrangement ADR 0029 § 4 refuses.

### 4. Construct properties: an optional bag through declared setters; nicks before constants

`constructor(props?: Partial<…>)`, fully optional, so `new instanceType()` from the XML
builder is unaffected. The bag applies through the same per-setter doors
`check-nativescript-xml-doors.mjs` already holds — never `Object.assign` — and an unknown
key throws instead of sticking as a dead own-property.

For enums the convergent spelling is the **nick**, not the constant, because a nick is a
string and a string is the only thing that survives an XML attribute; gtk-host already
accepts `GtkAlignNick | Gtk.Align` for exactly this reason. `Gtk.Align.CENTER` is a second
accepted spelling backed by a value table whose numbers are held against the GIR. The
non-total members (`start`, `end`, the three `baseline*`) are a § 1 declaration, not a
silent omission.

### 5. Widen `check-vocabulary-alignment` to EVERY widget surface

The check is the enforcement of clause 3, and it must therefore read **every** widget
surface rather than the one that happened to be wired first. It reads `adwaita-web` today.
`adwaitaNativeScriptWidgets` already exists in `scripts/adwaita-elements.mjs` and is
simply not imported here. React Native needs a reader of its own — it is the one surface
with neither `customElements.define` nor an `adw-<name>.ts` convention, so its widget set
is read from the base barrel's `export { Adw… } from './widgets/…'` lines, which
`check-adwaita-rn-platform-split.mjs` rule 3 already parses for a different reason.

**Enrolment is the property, not the enumeration.** A surface added later must be enrolled
or the check has to say so: a package that declares `gjsify.adwaitaSurface` (or however the
manifest ends up spelling it) and is absent from the reader list fails, and that is what
makes the rule bind a port nobody has written yet rather than only the three named above.
Without that arm this section is a list, and a list is what let the NativeScript surface
sit outside the check for its entire life.

**Which half can actually go red, honestly.** The check's own header names the class this
repository pays most for: a rule comparing a mapped type with its own source *"is, today,
asking whether a mapped type agrees with its own source: it does, by construction."*

- **Can go red, on every surface.** Widget names on all three Adwaita surfaces are
  hand-typed; the 168-tag table is emitted from the GIR by a generator that never reads
  them. Two independent sources. A widget with no GIR tag and no entry fails; an entry
  whose `gir` target stops being a tag fails; an entry for a widget the surface no longer
  ships fails; an entry whose spelling already matches fails as redundant. This is the
  half that would have caught the four flattened GTK widgets, and it is also the half that
  goes red the *first* time `adwaita-react-native` grows a third widget under a name that
  is not its GType's.
- **Cannot go red.** Anything derived from a surface's own classes and then compared back
  to them. Specifically: once § 3's namespace object is generated from the ledger, checking
  it against that surface's class set proves nothing. It must be held against the **GIR tag
  set**, which is the independent side. The same trap applies per surface, and it gets
  easier to fall into as more surfaces generate more artifacts.
- **What no half proves.** Behaviour. `status/open-todos.md` already records the limit for
  the web half — *"it asserts that `<adw-checkbox>` is declared to mean `gtk-check-button`,
  never that it behaves like one"* — and every other surface inherits it unchanged. The
  closing criterion stays ADR 0027 § 9's conformance vectors.

### 6. The end state is a `gi://` arm per surface, not a package that aliases `@girs`

`@girs/*` cannot be aliased: it is types plus a two-line re-export of `gi://`, and on
NativeScript there is no GI and no libgtk. What can be aliased is the specifier that
already has per-target resolution. The arm is the sibling of `gjsGiNodePlugin`:

- a plugin per target claiming `gi://Ns?version=X` at `resolveId` `pre`, ahead of
  `gjsImportsEmptyPlugin`, returning a virtual module whose **default export is a
  namespace object** — `@gjsify/adwaita-nativescript` for `--app nativescript`,
  `@gjsify/adwaita-web` for `--app browser`;
- `emptyGirs: false` on that target, exactly as on the node-gi path, so `@girs/adw-1`
  resolves to its real body and its inner `gi://` is rewritten by the plugin that ran
  first;
- namespaces with no arm keep falling through to the empty module. That is the declared
  remainder at the module level, and it must stay a *named* refusal rather than an empty
  object, because `class extends ({}).Bin` is the failure the existing header records.

**Most of this exists.** The plugin ordering, the virtual-module machinery, the
`emptyGirs` carve-out and the lazy-namespace pattern are built and shipping on the node
arm. What is new per target is a namespace object and one plugin that returns it. The
remaining work is the vocabulary split inside each surface, not plumbing.

**The browser arm was left as an open question in an earlier draft of this ADR; under the
rule stated in § 1 it is not open any more, and it earns a stage because its red condition
is now sayable.** With adwaita-web inside the rule the three preconditions are met or
nearly so: the 21 non-matching elements are already declared (that table exists and is
enforced), custom-element constructors *are* constructors so `new Adw.ActionRow()` is
legal once the element is defined, and § 3 gives the surface the namespace object it
lacks. The failing test is the same shape as the NativeScript one: build `--app browser`
from `import Adw from 'gi://Adw?version=1'`, construct `Adw.ActionRow`, assert the result
is an upgraded `<adw-action-row>`. Today that produces `Class extends value undefined`.

**Two honest caveats that keep it last rather than first.** The browser `Gtk` namespace
would be **sparse** — adwaita-web has no `gtk-*` elements at all, so `gi://Gtk` on that
target can only offer the 10 aliased members, and every other one must be a *named*
refusal rather than `undefined`; that is § 1 clause 3 applied at member granularity, and
it is more surface area than the NativeScript arm needs. And ADR 0010's style-isolation
boundary means an element constructed outside the document has to be adopted before it
renders, which the NativeScript path has no analogue of.

### 7. What would buy a stronger oracle, and what it would and would not prove

The property ledger's oracle is `generated/props.ts` — our own generator's reading of the
GIR. Three stronger readings exist, and they are not interchangeable. Recording the
difference here so nobody re-derives it:

1. **ts-for-gir as a LIBRARY, parsing the `.gir` in the gate.** ADR 0019 § 1 already
   decides ts-for-gir is usable this way — *"every `@ts-for-gir/*` package exports
   `src/index.ts` directly … `@ts-for-gir/lib`'s `exports` is literally
   `{".": "./src/index.ts"}`"* — and the registry confirms it still holds
   (`npm view @ts-for-gir/lib exports` → `{ '.': './src/index.ts' }` at 4.3.0). ADR 0019
   also records that the parse-to-model pieces (`gir-module.ts`, `generators/`,
   `transformation/`) live in that package rather than in the CLI, so a gate could hold
   the ledger against GIR data directly instead of against our emitted types.
   **What that buys is a second READER of the same source** — stronger than comparing our
   generator's output with itself, weaker than an independent oracle, because the `.gir`
   is still the one input both sides read. It also still needs `node_modules`, so it
   belongs in `tree-checks` with the other installing gates, not in the required
   no-install job. Worth doing when the ledger starts carrying *reasons* that have to come
   from somewhere; not worth doing to re-confirm 92 property names.
2. **The `.gir` next to the binary the host actually loads.** This is the only one of the
   three that answers "does the surface match the GTK on this machine", and it is
   **already decided**: ADR 0019 § 2, *"The `.gir` travels with the RUNTIME package, never
   with the type package"*.
3. **The runtime `GParamSpec`.** ADR 0028 § 5's coercion, which gtk-host already consults
   and which is the genuinely independent answer — at the cost of needing a running GTK.

**Shipping the `.gir` inside `@girs/*` is not proposed here, and not because nobody thought
of it.** ADR 0019 § 2 rejects it in two lines that the measurements confirm: *"It
duplicates the generator's input across ~700 packages, and — decisively — a `.gir` in a
type package proves nothing about the library the host will load. That is the entire
failure being fixed."* The cost, with the denominator taken from the registry rather than
from a working tree: `@girs/gtk-4.0@4.1.0` unpacks to **5.86 MB** in 12 files and 4.3.0 to
**6.12 MB** in 14 (`npm view @girs/gtk-4.0@4.1.0 dist.unpackedSize dist.fileCount`),
against a `Gtk-4.0.gir` of **6.20 MB** (6 203 171 bytes, GTK's own `gtk4` package file).
Bundling it therefore roughly **doubles** the package, and npm fetches tarballs whole, so a
subpath saves a types-only consumer nothing. Across a full pool it is **705 `.gir` files,
379 MB** — measured in a local ts-for-gir checkout, where `girs/` is downloaded content
rather than a committed artifact, so treat that one as an order of magnitude.

The capability behind the idea is real and specific, and it is worth writing down because
it is not convenience: **the GIR XML and the typelib carry different information** — nicks
only in the typelib, documentation only in the XML — so a property ledger that wants
reasons and doc strings needs the XML, which the generated types do not carry. If that
capability is wanted, the shape ADR 0019 § 2 leaves open is a **companion** artifact
(pooled, or per-namespace) that only a tool needing GIR pulls, and the venue for it is
`gjsify/ts-for-gir` — `gjsify/types` has issues disabled, and a search there found no
existing issue for it. **Not a stage of this ADR.**

### 8. A template translator needs more than names, and this ADR does not pretend otherwise

The repository has already measured the translator problem, in
`scripts/adwaita-gallery-trees.mjs:13-24`: across the 48 preview fragments, 198 elements,
of which 84 (42 %) spell a tag gtk-host does not have; and on the 114 that do match, 35
attribute uses across 12 distinct attributes diverge — *"and none of them is a spelling
difference"*: `icon` vs `iconName` plus the `-symbolic` suffix, `items` vs a
`Gio.ListModel`, `min`/`max`/`step` vs a `Gtk.Adjustment`, `size` vs a size request,
`open` vs a `present()` call.

So name agreement is necessary and nowhere near sufficient, and the repository's own
answer to the translator question stands unchanged: write the tree ONCE in the vocabulary
that runs and emit the dialects, rather than translating between two hand-written
surfaces. This ADR does not overturn that. It makes the vocabulary that tree is written in
the same on more surfaces, and it opens the property-level declaration (§ 1's shape,
applied to the 45) that a translator would need next.

## Consequences

- Nothing that is published moves. `AdwEntry` stays `AdwEntry`; `<adw:AdwEntry>` stays
  valid; `<adw-entry>` stays valid; the bare-name join in `generate-status.mjs` keeps
  working untouched.
- **A new surface now has a rule to fail against.** Today a fifth Adwaita renderer would be
  written under whatever convention its author copied and nothing would object; after § 5
  it either enrols in the check or the check says it did not.
- `@gjsify/adwaita-react-native` acquires its namespace and its (empty) ledger before its
  first publish, so the rule costs it nothing it can ever have to undo.
- **The documentation stops contradicting the code.** `Gtk.Entry` is documented under `Gtk`,
  and `controls.mdx` — currently a wholly GTK page under an Adwaita heading — stops being
  the counter-example a reader finds first. Two page URLs move, so the stage carries its
  redirects, exactly as the `/widgets/*` rename did.
- The four flattened GTK widgets stop being invisible: they become four ledger entries with
  reasons, and reachable as `Gtk.Button`, `Gtk.DropDown`, `Gtk.Entry`, `Gtk.MenuButton`.
- `check-vocabulary-alignment`'s summary line grows from one surface to three, and the
  repository gains a number for the distance to the goal: today **45** declared property
  divergences and **4** widgets with no counterpart on NativeScript, where nothing was
  counted before.
- The `gtk:` entries in `WEB_ELEMENT_ALIGNMENT` acquire a required reason, so ten existing
  aliases must be justified or converged. That is a real edit to an existing table and the
  first place this ADR costs someone an afternoon.
- Two spellings for a while, on two of the four surfaces. That is the price of not breaking
  what is published, and § 1's ledger is what keeps it from becoming three.

## Alternatives rejected — in § 9's voice, each with its unblocker

- **Renaming the NativeScript classes (`AdwButton` → `GtkButton`).** *This is the obvious
  reading of the problem and it is the wrong trade in both directions. `@gjsify/adwaita-
  nativescript` is genuinely published — 49 versions, 3 761 downloads last month, and a
  published dependent (`@gjsify/storybook-nativescript`, verified with
  `npm view @gjsify/storybook-nativescript dependencies`) — and the rename would change
  two public surfaces at once: 49
  imported ESM symbols and the XML element vocabulary, where the failure is silent on a
  phone (`Module 'AdwButton' not found for element`, or worse, an unprefixed tag resolving
  against NativeScript's own namespace). Inside the repository it is ~140 files, and the
  distribution is the wrong way round: five gates in `audit-runtimes.yml` fail loudly and
  immediately, while the largest consumer block — 41 story files, 8 `.mdx` pages, three
  generated gallery files — sits in code paths no CI job type-checks, because both
  NativeScript showcases are private, excluded from the workspaces glob and named in no
  workflow. And the namespace object in § 3 delivers the spelling the goal actually asks
  for, additively, at a fraction of that.* Unblocker: a major version of the package, plus
  a gate that resolves widget identifiers in the `.mdx` NativeScript fences and
  type-checks the two excluded showcases — without which the rename's real blast radius is
  invisible to the build.

  **This rejection is about the cost, so it does not transfer to a surface that has not
  paid it.** `@gjsify/adwaita-react-native` has two widgets and no published version;
  naming them from the GIR there is not a rename, it is the first naming. Reading this
  bullet as "gjsify does not rename widgets" would be reading a measurement as a
  principle.
- **A `tsc` structural conformance check of the surfaces' classes against `@girs/*`.**
  *An earlier draft rejected this on venue — "the gate job installs nothing" — and that is
  true of `audit-runtimes.yml`'s `check:` job and false as an argument, because the venue
  exists. `tree-checks` ("Whole-tree checks", `main.yml:327`) runs in the Fedora CI image
  through `gjsify-setup`, has `node_modules`, and already hosts two gates moved there for
  exactly this reason — `check-lint-visibility.mjs` and `check-source-visibility.mjs`, each
  carrying the sentence in its comment: "`audit-runtimes.yml` installs nothing". It also
  has no classifier gate ("the cost is one install on a docs-only PR, and it is the price
  of the claim"), so the install is already paid on every PR, and a `tsc` program over all
  42 counterpart-bearing widgets measures **1.5 s** (`time tsc -p` on a program of
  `Partial<…ConstructorProps>` aliases, `skipLibCheck` on). Neither cost nor venue is the
  reason. Three things that are:*

  1. *The assertion is not the one anyone wants. `const e: Gtk.Entry = nsEntry` demands 509
     members, 357 of them methods; the probe answers "missing 505 properties". Satisfying
     it means implementing GTK on NativeScript, so the check would be permanently red or
     permanently suppressed — and a suppressed gate is the "green CI that checked nothing"
     class this repository pays most for.*
  2. *The narrow version is vacuous in the wrong direction. `Partial<ConstructorProps>` is
     satisfied by `{}`; every object conforms. The direction that carries information is
     the other one — every property a surface exposes must be a KEY of that type — and
     that is a NAME comparison, not a type relation. `generated/props.ts` carries the same
     key set as text, in-repo and GIR-derived, so the informative half runs in the no-install
     job beside the rest of the vocabulary rule. That is stage 6, and it produces the 45.*
  3. *`@girs` is not the independent oracle it looks like. `generated/props.ts` imports
     `@girs/adw-1`, `gtk-4.0`, `gdk-4.0`, `gio-2.0`, `glib-2.0`, `gobject-2.0` and
     `pango-1.0` directly, and `@gjsify/gtk-host` declares eight `@girs/*` packages as
     runtime dependencies. Our generator and ts-for-gir are two derivations of the SAME
     `.gir`, already coupled through the type surface: a green conformance run would prove
     the two readers agree, not that either matches the GTK the host loads. The oracle that
     answers that question is the runtime `GParamSpec` (ADR 0028 § 5), which gtk-host
     already consults and no static check substitutes for.*

  Unblocker: a surface that CLAIMS to implement a whole GI class rather than a handful of
  its properties. Then the 509-member assertion is the right one, it goes in `tree-checks`,
  and it costs about a second.
- **A second translation table mapping `adw-*` markup onto gtk-host tags and props.**
  *Refused before, for a reason that has not changed:
  `scripts/adwaita-gallery-trees.mjs` measured it at 15 tags plus 12 attribute SEMANTICS
  and rejected it as "two parallel hand-maintained tables joined by nothing", worse than
  the one table because it would map behaviour and not just names.* Unblocker: none
  wanted. Write the tree once in the vocabulary that runs.
- **Writing the rule once per port, as three sections that happen to agree.** *It reads
  more concrete and it is how the last two ADRs left this hole: ADR 0032 deferred "the
  NativeScript component vocabulary" and "a `.web` export over `@gjsify/adwaita-web`"
  separately, and neither got picked up, because a deferral scoped to a port has no
  claimant. A per-port rule also cannot fail for a port that does not exist, which is
  precisely the case this ADR is written for — the fourth surface appeared three days ago
  in one PR.* Unblocker: none wanted. § 1 is surface-neutral and § 2 is the table.
- **Doing the worst surface first.** *Severity ordering would start with NativeScript,
  which has the four misnamed widgets and 45 property divergences. It is the wrong
  ordering because the NativeScript cost is already sunk and flat, while the React Native
  cost is near zero and rising on a release date nobody sets for this reason. Ordering by
  severity would spend the cheap window on the expensive surface.* Unblocker: none — but
  if stage 1 slips past the next release cut, re-price it rather than assuming it is still
  free.
- **Deleting `adw-data-grid` and `adw-slider-row` to make the surfaces match.** *They are
  the test case, not the embarrassment. One is an original widget an accounting app
  already uses; the other is the only way a range control looks native on a phone. A
  vocabulary goal that deletes working widgets to improve its own number has stopped being
  about the vocabulary.* Unblocker: none. They get `own:` entries and stay.

## Risks

- **The ledger becomes a place to park things.** Mitigated only by the discriminated
  union: `gap:` needs an issue number, and "it would be work" may not be spelled as a
  reason. That mitigation is borrowed, and it has held in
  `check-storybook-widget-coverage.mjs`.
- **The namespace object drifts from the classes.** Mitigated by generating it from the
  ledger, and by holding it against the GIR tag set rather than against the classes — see
  § 5 on which comparison carries information.
- **Two spellings become a permanent fork.** The printable count is the guard: it is
  visible in a CI summary line and it can only go down deliberately.
- **The cheap stage is skipped because it is the least urgent-looking.** Stage 1 fixes a
  surface with no defect in it, which is exactly the kind of work that loses to a surface
  with four. Its expiry is the mitigation, and it is written into the stage.
- **"Every surface" stays a sentence.** A rule that names three packages binds three
  packages. Stage 4 is the arm that turns it into a property, and without it this ADR has
  the same failure mode as the deferrals it replaces.
- **The `gi://` arms look closer than they are.** The plumbing exists; the namespaces they
  must return do not, and they cannot be built before the ledger. Sequenced deliberately,
  and stage 9 is last for that reason — the browser arm additionally carries a sparse
  `Gtk` namespace whose every absent member has to be a named refusal.

## Implementation

Each stage is independently useful, independently mergeable, and breaks nothing that ships.

**The order follows the cost curve, not the severity of the defect**, and those are
different surfaces: the worst-named is NativeScript, the clearest to argue is adwaita-web,
and the cheapest is React Native — which is also the only one whose cost rises on a date
somebody else sets. Doing it first is not deferral of the others; it is the only ordering
under which the free adoption stays free.

| # | stage | surface | breaks | what goes red if it is wrong |
|---|---|---|---|---|
| 1 | Adopt all three clauses on `@gjsify/adwaita-react-native` **before its first publish**: export `Adw`, add the (empty) ledger, wire the reader. Two widgets, both already correctly named. | RN | nothing — 0 published versions, 0 in-repo consumers outside the package | a third widget whose name is not its GType's; a widget absent from the namespace object; a namespace member with no widget behind it |
| 2 | **LANDED 2026-08-30** (ahead of 1, see § Amendment). Require a `why` on `gtk:` entries in `WEB_ELEMENT_ALIGNMENT` and fill the ten. The clearest instance of the defect, on a table that already exists. | web | nothing | an alias with no reason — the same rule `webOnly` has carried since it was written |
| 3 | **LANDED 2026-08-30** (ahead of 1, see § Amendment). Widen `check-vocabulary-alignment` with `NS_WIDGET_ALIGNMENT`: the 4 GTK-named widgets get `gir:`, the 4 counterpart-less ones get `composes:`/`own:`, with reasons. Self-test vectors first, as the file already requires. | NS | nothing | an undeclared NativeScript widget; a `gir:` target that is not a tag; a stale entry; a redundant entry — plus the check's own synthetic vectors, which must fail before real data is read |
| 4 | **LANDED 2026-08-30**, see § Amendment 2. Make enrolment the property rather than the list: `gjsify.widgetVocabulary` per package, joined to the readers in `scripts/widget-surfaces.mjs`, with a `manifest-conformance` rule so `field-coverage` accepts the key. | all | nothing | a package declaring itself a widget surface with no reader; a reader whose package stopped declaring; a declared renderer no half of the check compares; two references, or no renderer at all |
| 5 | A `Gtk` docs section **beside** `Adwaita`: `controls.mdx` moves whole (0 Adwaita blocks on it), the two `Gtk.*` blocks on `buttons.mdx` follow, `redirects` keeps the old URLs the way the `/widgets/*` rename already does. | docs | old URLs, unless redirected — which is why the redirect is part of the stage | a `Gtk.*` block under the `Adwaita` heading, or an `Adw.*` block under `Gtk`; a moved page with no redirect entry |
| 6 | **LANDED 2026-08-30**, see § Amendment 2. Extend the tables to properties, read against `packages/framework/gtk-host/src/generated/props.ts` (in-repo, GIR-derived, no install), on the NativeScript surface. Print the count. | NS | nothing | a settable property that is neither a key of its counterpart's props interface nor declared; a convergence target that is not a key; an entry for a property that IS a key, or that nothing sets any more |
| 7 | Emit `Gtk` / `Adw` namespace objects for `adwaita-web` and `adwaita-nativescript`, plus the `~/gtk` XML barrel, from the § 1 ledger. | web, NS | nothing (additive) | a namespace member with no ledger entry; a ledger entry with a GIR counterpart and no namespace member; an object that disagrees with the **GIR tag set** |
| 8 | Optional construct-props bag through the declared setters; nick coercion plus a `Gtk.Align` table held against the GIR. | NS | nothing (parameter is optional; XML still calls `new T()`) | an unknown key in the bag reaching a widget without throwing; a nick table member whose number disagrees with the GIR; `check-nativescript-xml-doors.mjs` on a setter that gained a door it did not declare |
| 9 | The `gi://` arms: `--app nativescript` first, `--app browser` second, each `resolveId` `pre` plus `emptyGirs: false`. | NS, web | nothing | an e2e sibling of `tests/e2e/ns-bridge-bundles` per target that imports `gi://Adw?version=1`, constructs `Adw.ActionRow` and asserts the result — today both produce `Class extends value undefined` |

Stages 1–4 and 6 are ledger-and-gate work; only stage 1 touches a package, and it touches
one that nothing consumes. (Stage 4 adds a `gjsify.widgetVocabulary` block to four manifests,
which is a declaration and not code.) Stage 5 is documentation plus redirects. Stage 7 is additive
code. Stages 8–9 are the only ones that reach a constructor or a bundler, and neither is
reachable before the ledger exists.

**Stage 1 has an expiry.** `@gjsify/adwaita-react-native` is `private: false` at 0.44.0 and
publishes on the next release cut; after that it is a fourth published surface and stage 1
acquires the same shape as the rename this ADR rejects. **That expiry fired the next
morning** — see § Amendment.

Follow-up is tracked in `status/open-todos.md` per governance; this ADR records the *why*.

## Amendment, 2026-08-30 — the expiry fired, and the order it justified is now wrong

Stages **2** (a reason on every `gtk:` alias) and **3** (`NS_WIDGET_ALIGNMENT`) landed
first, ahead of stage 1. This section records why rather than reordering the table above
quietly, because the thing worth keeping is not the new order — it is that the order came
off a measurement, the measurement moved, and the order was re-derived instead of defended.

### What moved

`@gjsify/adwaita-react-native` was published at **0.44.0 on 2026-08-30T07:13:40Z**, about
sixteen hours after this ADR was written. The whole of stage 1's priority was the sentence
*"adopting the rule there today costs a namespace export and a ledger with no entries in
it; adopting it after the cut costs what the NativeScript rename costs"*, and the cut has
happened.

Re-measured the same morning, from the registry and this repository at `main`:

| surface | widgets | published versions | latest | downloads / month | in-repo import sites |
|---|---:|---:|---|---:|---:|
| `@gjsify/adwaita-web` | 65 | 137 | 0.44.0 | 5 006 | 11 |
| `@gjsify/adwaita-nativescript` | 46 | 49 | 0.44.0 | 3 598 | 49 TS · 28 XML files |
| `@gjsify/adwaita-react-native` | 2 | **1** | 0.44.0 | **no record** | **0** outside the package |

```sh
for p in @gjsify/adwaita-web @gjsify/adwaita-nativescript @gjsify/adwaita-react-native; do
  npm view "$p" versions --json | tr -d '[]" ' | tr ',' '\n' | grep -c .
  curl -s "https://api.npmjs.org/downloads/point/last-month/$p"
done
npm view @gjsify/adwaita-react-native time --json     # 0.44.0: 2026-08-30T07:13:40.828Z
for pkg in adwaita-web adwaita-nativescript; do                  # 11, then 49
  grep -rlE "from '@gjsify/$pkg(/[a-z-]+)?'" --include='*.ts' --include='*.tsx' . \
    | grep -v node_modules | wc -l
done
grep -rl 'adw:' --include='*.xml' . | grep -v node_modules | wc -l   # 28
grep -rn '@gjsify/adwaita-react-native' --include='*.ts' --include='*.tsx' packages showcases tests website \
  | grep -v node_modules | grep -v '^packages/framework/adwaita-react-native/' | wc -l   # 0
```

**"no record" is not "0 measured".** The point endpoint answers
`{"error":"package @gjsify/adwaita-react-native not found"}` — npm has no download row for
a package published that morning. Writing it as a zero would be claiming a measurement
nobody took, which is the failure the § *How the numbers here were obtained* header exists
to prevent.

### Why the order changes, and why it is not simply "severity wins after all"

The original ordering was **cost-curve**, and its live term was not *how cheap* React
Native is but *that its cheapness was expiring on a date somebody else sets*. Nothing
else in the ADR was rising. With the cut behind us, no stage's cost is rising any more:
NativeScript's is flat and large, React Native's is flat and small. **The term that
ordered the stages has gone to zero, so the ordering it produced no longer follows from
anything.**

What the remaining stages are ranked by is then the thing the original ordering
deliberately set aside — and two independent reasons put 2 and 3 in front, neither of
them "the worst surface first":

1. **Stage 1 has a dependency the table did not show.** Stage 1 is "export `Adw`, add the
   (empty) ledger, wire the reader". The *shape* of that ledger — the discriminated kinds,
   the required reason, the floor, which side of the comparison carries information — is
   what stages 2 and 3 build. Doing stage 1 first means inventing that shape once for a
   surface with no entries in it, then meeting the real cases afterwards. An empty ledger
   is a poor place to decide what a ledger is.
2. **Stage 1's red condition is now cheap to state and was not before.** Its failure mode
   is *"a third widget whose name is not its GType's"* — which is precisely the rule stage
   3 implements against a live widget corpus. After stage 3 the React Native reader is the
   only new part; before it, stage 1 would have carried the rules too.

React Native did **not** get more expensive in the way the ADR feared. Both its names,
`AdwBin` and `AdwClamp`, are already correct under clause 1, so nothing there needs a
rename at any price; what publication cost is the *"nothing it can ever have to undo"*
guarantee, which was the argument for hurrying and is now spent. Stage 1 stays worth
doing and is no longer worth doing first.

### What the gate prints once stages 2 and 3 have landed

Reproducible, and deliberately not restated anywhere else — `node
scripts/check-vocabulary-alignment.mjs`:

```
self-test green — 32 failing vector(s), 11 reader vector(s). 168 GTK tags across 3 dialect
surfaces + the runtime table + the surface data; 65 adw-* web elements — 44 share a
spelling, 10 alias one, 11 declared web-only; 46 NativeScript Adw* widgets — 38 share a
spelling, 6 should converge, 2 declared own, 0 undecided. Distance to one vocabulary on
NativeScript: 6 widget name(s), and it can only go down.
```

That is the output at the landing commit, quoted rather than summarised. Re-run it before
quoting any of these numbers elsewhere: this file's own § *How the numbers here were
obtained* is about the ones that did not survive being copied.

**6, not 4.** § Context counts *four* NativeScript widgets wearing an `Adw` prefix over a
GTK type and *four* with no tag under either spelling; the printed distance is the widgets
that have a GIR counterpart and do not share its spelling, which is those four plus
`AdwIcon` (`gir: GtkImage`) and `AdwImageButton` (`composes: GtkButton + GtkImage`). The
two numbers answer different questions and the check answers the one that can go down.

### What this does not change

The rule in § 1, the four declaration kinds, and the refusal to rename anything published.
Stage 1 keeps its place in the list; only its position moves. And the ADR's own § Risks
entry — *"the cheap stage is skipped because it is the least urgent-looking"* — is now the
live risk on this ADR rather than a hypothetical, so it is recorded in
`status/open-todos.md` with the re-measured price rather than left to the reader.

## Amendment 2, 2026-08-30 — the properties are countable, and enrolment is a declaration

Stages **6** (the property ledger) and **4** (enrolment as a property) landed, in that
order, on top of stages 2 and 3. Both are gates, declarations and documentation; nothing
about a shipped API moved, and nothing was renamed — which is the whole point of making
the gap countable first.

### The property numbers were RE-MEASURED, and they moved

§ *How large is the gap against `@girs`* records **42 widgets, 137 settable properties, 92
agreeing, 45 not, split 16 with a candidate spelling / 29 without**. Stage 6 measured the
same question again rather than inheriting it, and the answer is different:

| | § Context, measured with the TypeScript compiler API against `@girs/gtk-4.0@4.1.0` | stage 6, measured against the in-repo `generated/props.ts` |
|---|---:|---:|
| NativeScript widgets with a GIR counterpart | 42 | **44** |
| settable properties on them | 137 | **143** |
| already a key of the counterpart | 92 | **91** |
| not | 45 | **52** |
| …of those, with a candidate GIR spelling | 16 | **25** |
| …with none | 29 | **27** |

```sh
node scripts/check-vocabulary-alignment.mjs      # every number above, on one line
```

**The two readers are not the same reader, so the difference is not a correction of an
error.** Three things differ, and each is a decision stage 6 makes on purpose:

1. **The counterpart set is bigger because stage 3 exists.** A widget has a counterpart
   when its spelling IS a GTK tag (38) or when `NS_WIDGET_ALIGNMENT` declares one — the
   five `gir:` entries plus the one `composes:` entry, which stage 3 wrote. Before that
   ledger, `AdwIcon` and `AdwImageButton` had nothing to be measured against. 44 = 38 + 6,
   and the two `own:` widgets (`AdwSliderRow`, `AdwDataGrid`) are correctly excluded: a
   comparison against nothing is the blind side this repository keeps paying for.
2. **"Settable" is what the class DECLARES, read per class.** `set <name>(` inside the
   widget's own body — not a getter, not a helper class sharing the file. `AdwEntry` has
   five accessors and four setters; `textLength` is read-only, so it is not a settable
   property and is not counted on either side.
3. **A "candidate spelling" is now a machine-checked claim.** The 16 were eyeballed. The
   25 are entries whose `gir:` target must be a key of that widget's counterpart in
   `generated/props.ts` or the gate fails — which is why three of them are `adjustment`
   (`AdwSpinRow.min`/`max`/`step`, one `Gtk.Adjustment` on GTK) and two are `cssClasses`
   (`AdwButton.variant`, `AdwHeaderBar.flat`, both style classes upstream).

**25 is the printed distance and the number that can only go down.** 52 is the size of the
ledger; 27 of those are declared `own` and are not work.

### What the gate prints now

Reproducible, and deliberately not restated anywhere else — `node
scripts/check-vocabulary-alignment.mjs`:

```
self-test green — 57 failing vector(s), 11 reader vector(s). 4 declared widget surface(s),
every one of them read. 168 GTK tags across 3 dialect surfaces + the runtime table + the
surface data; 65 adw-* web elements — 44 share a spelling, 10 alias one, 11 declared
web-only; 46 @gjsify/adwaita-nativescript widgets — 38 share a spelling, 6 should converge,
2 declared own, 0 undecided; 2 @gjsify/adwaita-react-native widgets — 2 share a spelling,
0 should converge, 0 declared own, 0 undecided. Properties, on @gjsify/adwaita-nativescript
only: 44 widgets with a GIR counterpart set 143 settable propert(y|ies) between them — 91
already agree with the counterpart's ConstructorProps, 52 do not (25 should converge, 27
declared own, 0 undecided). Distance to one vocabulary: 6 widget name(s) and 25 property
name(s), and both can only go down.
```

The renderer segment is derived per ENROLLED surface rather than written once per surface,
which is why React Native appears in it without anybody extending a sentence — and it is
the same reason the line names the surface the property numbers were measured on.

### Enrolment: `gjsify.widgetVocabulary`, joined to a reader

```json
"gjsify": { "widgetVocabulary": { "role": "reference" } }   // @gjsify/gtk-host
"gjsify": { "widgetVocabulary": { "role": "renderer"  } }   // the three renderers
```

`role` is the one fact the comparison needs and the one the package owns: which side of it
the surface is on. `scripts/widget-surfaces.mjs` holds the readers and the pure rule
function; `scripts/manifest-conformance/rules/widget-vocabulary.mjs` claims the key so
`field-coverage` accepts it, and calls the same function, so the manifest gate and the
vocabulary gate cannot answer differently.

Four things go red, all of them against the real tree rather than against a constant in the
check:

- a package declares `gjsify.widgetVocabulary` and no reader covers it — the arm that makes
  the rule reach a port nobody has written;
- a reader names a package that no longer declares itself — enrolment silently dropped;
- a declared renderer that no half of the check compares (a reader but no alignment table)
  — read and never held, the same hole one level in;
- two `reference` roles, no `renderer` at all, or a role neither side recognises.

**React Native was enrolled by this stage, not by stage 1.** It declares itself, its widget
set is read from the base barrel's `export { Adw… } from './widgets/…'` lines, and both its
widgets are held against the GIR tag table through an (empty) `RN_WIDGET_ALIGNMENT`. Stage
1's remaining content is the `Adw` namespace export, clause 2 — the reader and the ledger
it also listed are done.

### What these stages do NOT prove, stated because the numbers look like more than they are

- **The property comparison is a second READER of our own source, not a second source.**
  `generated/props.ts` imports `@girs/adw-1` and six siblings; our generator and ts-for-gir
  both read the same `.gir`. Agreement is evidence about two hand-typed vocabularies and is
  not evidence about GTK. § *How large is the gap against `@girs`* already said so; the
  check's header says it again where the count is printed.
- **One surface.** `@gjsify/adwaita-web`'s attribute vocabulary and
  `@gjsify/adwaita-react-native`'s prop types are two further property corpora and are not
  in the ledger. The printed line names the surface for that reason.
- **The reason rules cannot go red.** `why` required, the 40-character floor, `#NNNN` on a
  `gap` — on the property entries exactly as on the widget entries, these hold a table in
  the check against a constant in the check. They refuse a shortcut; they measure nothing.
- **Behaviour, still.** `AdwEntry.placeholder` is DECLARED to be `placeholder-text`;
  nothing asserts it behaves like one. The closing criterion stays ADR 0027 § 9's
  conformance vectors, unchanged.
