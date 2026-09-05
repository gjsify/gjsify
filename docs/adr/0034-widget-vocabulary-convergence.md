# 34. Every widget surface: named from the GIR, exported as a namespace, remainder declared

- Status: **Proposed** — amended twice on 2026-08-30: § Amendment (the premise under the
  stage order moved; stages 2 and 3 landed first) and § Amendment 2 (stages 6 and 4 landed;
  the property numbers were re-measured and moved); four times on 2026-09-01; and twice on
  2026-09-03. § Amendments 3 and 4 carry clause 2 onto React Native and the web.
  § Amendment 5 holds clause 1 on `@gjsify/adwaita-web`: nine elements took their GIR
  names, `<adw-radio>` became a declared `webOnly`, and the printed distance was widened to
  the surface it had been leaving out. § Amendment 6 REVERSES part of § 3 for
  `@gjsify/adwaita-web`: the namespace is no longer additive there, the flat
  `Adw…`/`Gtk…` widget-class exports are gone from the package root, and the namespace
  became a MODULE (`export * as Adw`) so it can be annotated with as well as constructed
  from. § Amendment 7 carries both clauses onto `@gjsify/adwaita-nativescript`, the last
  surface: four widgets took their GIR names, eleven property names converged, and clause 2
  now holds on all three. § Amendments 8 and 9 then carry § Amendment 6's REVERSAL onto the
  two remaining surfaces, so that no surface exports a widget class flat beside its namespace
  member any more: § Amendment 8 on `@gjsify/adwaita-react-native` — 28 flat widget-class
  exports gone from each of its three barrels, `Adw.<Name>` the only spelling its root has; and
  § Amendment 9 on `@gjsify/adwaita-nativescript` — the 43 prefixed widget classes gone
  from the package root, the namespace a MODULE there too, and the XML dialect moved to
  `<adw:PreferencesGroup>` over one barrel per library, the first time the CALLERS of a
  surface are held by a gate rather than by a compiler. Three more on 2026-09-05:
  § Amendment 10 (`AdwIcon` took its GIR name), § Amendment 11 (`openState` converged after
  all, and the reasoning that said it could not is kept under a supersession note), and
  § Amendment 12, which lands the LAST stage — the `gi://` arms, behind an opt-in
  `--gi-renderer`, so `import Adw from 'gi://Adw?version=1'` resolves to the renderer's `Adw`
  on `--app browser` and `--app nativescript` instead of to an empty module.
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
surface-neutral; § 2 is a table of where each stood against it when this was decided.

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

`website/src/content/docs/gtk/controls.mdx:52-98` renders one gallery block whose
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
# The gallery lived in one directory when this was measured. #1433 split it,
# so the glob names both -- the totals are unchanged, because nothing was added
# or removed, only moved.
grep -rhoE '<AdwWidget title="[A-Za-z.]+"' \
    website/src/content/docs/adwaita/ website/src/content/docs/gtk/ \
  | sed 's/.*title="//;s/"//' | sed 's/\..*//' | sort | uniq -c
```

### What each surface ships — measured

| surface | vocabulary | count |
|---|---|---|
| `@gjsify/gtk-host` (`src/generated/widgets.ts`) | GIR-derived kebab tags | **169** — 63 `Adw*`, 106 `Gtk*` |
| `@gjsify/adwaita-web` | `adw-*` custom elements | **65** |
| `@gjsify/adwaita-nativescript` | `Adw*` view classes in `adw-*.ts` | **46** |
| `@gjsify/adwaita-react-native` | `Adw*` components | **12** |

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
for f in website/src/content/docs/adwaita/*.mdx website/src/content/docs/gtk/*.mdx; do
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

### 2. Where each surface stood against the rule when this ADR was decided

**A snapshot at decision, 2026-08-29 — not a live view.** What moved since is recorded in the Amendments; the current count is § "What each surface ships — measured".

| surface | clause 1 (GIR naming) | clause 2 (namespace) | clause 3 (declared) | remainder |
|---|---|---|---|---|
| `@gjsify/gtk-host` | **holds by construction** — the prefix is derived from the GType | n/a: the tags *are* the vocabulary, and `@girs` supplies `Gtk`/`Adw` | n/a | none |
| `@gjsify/adwaita-web` | **violated for 10 elements** (`adw-entry` is `GtkEntry`, …) | **absent** — registers tags, exports no namespace | **half-held**: every one of the 21 is declared, but the 10 aliases carry no reason | 11 web-only, each with a reason |
| `@gjsify/adwaita-nativescript` | **violated for 1** (`AdwIcon` is `GtkImage`); the other four converged — § Amendment 5 | **held** — `src/namespace.ts`, § Amendment 5 | **held since stage 3** for widget names and **since stage 6** for property names | 2 with no counterpart; property names re-measured in § Amendment 2 and again in § Amendment 5 |
| `@gjsify/adwaita-react-native` | **holds** — `AdwBin`, `AdwClamp` | **absent** | **held since stage 4**: it declares itself a surface and is read | none, then |
| the docs | `controls.mdx` is 100 % GTK under an `Adwaita` heading; 4 `Gtk.*` blocks in all | there is no `Gtk` section | no | — |
| the next surface | — | — | — | — |

Read the table as the work list. It is also the argument for the ordering in
§ Implementation: the only row whose remainder is empty is the one where adopting all
three clauses is nearly free, and it is the row whose cost rises at the next release cut.

### 3. The namespace is a RE-EXPORT layer, never a rename

> **Superseded in part by § Amendment 6 (2026-09-01)** for `@gjsify/adwaita-web`, by
> § Amendment 8 (2026-09-03) for `@gjsify/adwaita-react-native` and by § Amendment 9
> (2026-09-03) for `@gjsify/adwaita-nativescript`: the "all of it is additive" sentence
> below described the adoption step, and on all three surfaces the flat widget classes
> have since been removed. The re-export mechanism, and the refusal to rename the
> CLASSES, are unchanged everywhere.

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

> **Refined in part by § Amendment 12 (2026-09-05)**, which is where this section was
> implemented. Two clauses below moved. The third bullet — *"namespaces with no arm keep
> falling through to the empty module … it must stay a NAMED refusal rather than an empty
> object"* — asks for two different things at once, and the arm chose the refusal: under
> `--gi-renderer` an unanswerable namespace FAILS THE BUILD from `resolveId` rather than
> falling through, because the specifier already carries the answer and a fall-through is the
> silence this stage exists to remove. And the arm is OPT-IN, which this section did not
> anticipate. The rest — `resolveId` `pre`, the namespace-object default export, the
> `emptyGirs:false` composition, the sparse browser `Gtk` needing member-level refusals —
> landed as written.


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

  > **Superseded on 2026-08-30**: the package published that morning, and it has grown
  > well past two widgets since. The sentence is left as written for the same reason the
  > table above is — it records the premise this rejection rested on, and deleting the
  > premise deletes the correction. What does NOT survive the move is the conclusion:
  > the surface has now paid the cost this bullet says it had not, so "not a rename, the
  > first naming" no longer licenses one. Its own widget table is the live set.
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
| 1 | **LANDED, and its premise EXPIRED 2026-08-30.** Adopt all three clauses on `@gjsify/adwaita-react-native` **before its first publish**: export `Adw`, add the (empty) ledger, wire the reader. Two widgets, both already correctly named. | RN | ~~nothing — 0 published versions, 0 in-repo consumers outside the package~~ — the package published at 0.44.0 that morning and has grown well past two widgets since, so this row's "free" no longer holds. It is left as written for the reason § Amendment gives: the stage was free WHEN ORDERED, and deleting the premise deletes the ordering argument. | a third widget whose name is not its GType's; a widget absent from the namespace object; a namespace member with no widget behind it |
| 2 | **LANDED 2026-08-30** (ahead of 1, see § Amendment). Require a `why` on `gtk:` entries in `WEB_ELEMENT_ALIGNMENT` and fill the ten. The clearest instance of the defect, on a table that already exists. | web | nothing | an alias with no reason — the same rule `webOnly` has carried since it was written |
| 3 | **LANDED 2026-08-30** (ahead of 1, see § Amendment). Widen `check-vocabulary-alignment` with `NS_WIDGET_ALIGNMENT`: the 4 GTK-named widgets get `gir:`, the 4 counterpart-less ones get `composes:`/`own:`, with reasons. Self-test vectors first, as the file already requires. | NS | nothing | an undeclared NativeScript widget; a `gir:` target that is not a tag; a stale entry; a redundant entry — plus the check's own synthetic vectors, which must fail before real data is read |
| 4 | **LANDED 2026-08-30**, see § Amendment 2. Make enrolment the property rather than the list: `gjsify.widgetVocabulary` per package, joined to the readers in `scripts/widget-surfaces.mjs`, with a `manifest-conformance` rule so `field-coverage` accepts the key. | all | nothing | a package declaring itself a widget surface with no reader; a reader whose package stopped declaring; a declared renderer no half of the check compares; two references, or no renderer at all |
| 5 | A `Gtk` docs section **beside** `Adwaita`: `controls.mdx` moves whole (0 Adwaita blocks on it), the two `Gtk.*` blocks on `buttons.mdx` follow, `redirects` keeps the old URLs the way the `/widgets/*` rename already does. | docs | old URLs, unless redirected — which is why the redirect is part of the stage | a `Gtk.*` block under the `Adwaita` heading, or an `Adw.*` block under `Gtk`; a moved page with no redirect entry |
| 6 | **LANDED 2026-08-30**, see § Amendment 2. Extend the tables to properties, read against `packages/framework/gtk-host/src/generated/props.ts` (in-repo, GIR-derived, no install), on the NativeScript surface. Print the count. | NS | nothing | a settable property that is neither a key of its counterpart's props interface nor declared; a convergence target that is not a key; an entry for a property that IS a key, or that nothing sets any more |
| 7 | Emit `Gtk` / `Adw` namespace objects for `adwaita-web` and `adwaita-nativescript`, plus the `~/gtk` XML barrel, from the § 1 ledger. | web, NS | nothing (additive) | a namespace member with no ledger entry; a ledger entry with a GIR counterpart and no namespace member; an object that disagrees with the **GIR tag set** |
| 8 | Optional construct-props bag through the declared setters; nick coercion plus a `Gtk.Align` table held against the GIR. | NS | nothing (parameter is optional; XML still calls `new T()`) | an unknown key in the bag reaching a widget without throwing; a nick table member whose number disagrees with the GIR; `check-nativescript-xml-doors.mjs` on a setter that gained a door it did not declare |
| 9 | **LANDED 2026-09-05**, see § Amendment 12 — both arms in one change rather than NS then web, and behind an OPT-IN `--gi-renderer`. The `gi://` arms: `--app nativescript` and `--app browser`, each `resolveId` `pre` plus `emptyGirs: false`. | NS, web | nothing (opt-in; a build that does not pass the flag is byte-identical) | `tests/e2e/gi-renderer-arms`, a sibling of `tests/e2e/ns-bridge-bundles`, per target: it imports `gi://Adw?version=1`, constructs `Adw.ActionRow` and asserts the result — and keeps the flag-LESS build as a permanent row, because that one still has to produce `Class extends value undefined` |

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

## Amendment 3, 2026-09-01 — clause 2 holds on React Native, and what it cost to make it not a second list

> **Superseded in part by § Amendment 8 (2026-09-03).** "Additive" below described the
> adoption step; the flat widget classes are now gone from all three barrels, and the
> "two mentions of each module" argument became a one-mention one with vectors under it.

Stage 1's remaining content was the `Adw` namespace export. It is done for
`@gjsify/adwaita-react-native`: all three barrels — base, `.gtk`, `.native` — export
`Adw`, additive, with `AdwBin` and `AdwClamp` unchanged.

**The three-barrel shape is the whole difficulty, and § 3's sketch does not show it.**
`export const Adw = { Bin, Clamp }` written once in a shared module would bind the BASE
components, so `Adw.Bin` on the GTK build would hand back the thing that refuses at
first render. That is the failure rule 3 of `check-adwaita-rn-platform-split.mjs` exists
to prevent, arriving through a door rule 3 does not watch: it reads `export … from`
lines, and a namespace member is neither. So each barrel builds `Adw` from its OWN
platform modules, and a new rule 8 holds every member against the widgets on disk in
both directions, per barrel, including which module each member is bound from.

**§ 3 says the object is "generated from the table"; on this surface it is checked
against the table instead, and the difference is worth stating.** The members are
written out, because the `export { AdwBin } from './widgets/bin.js'` lines above them
are load-bearing for a second reader — `adwaitaReactNativeWidgets` derives this
package's widget set from exactly that form and refuses a line whose exported name and
module name disagree. Collapsing the two into `import` + `export {}` would generate the
namespace and destroy that coupling. Two mentions of each module, held equal by a rule,
beats one mention that no longer says which widget it is.

A/B, each branch separately, real exit codes: a missing member, an invented member and
a member bound from the wrong platform module each take the check to exit 1; restored,
exit 0. The check's summary line now states the namespace it verified, so a rule that
stops finding anything cannot look like a rule that found nothing wrong.

**What is left of clause 2.** `@gjsify/adwaita-web` (44 members plus 10 the alignment
table already knows) and `@gjsify/adwaita-nativescript` (the largest, and the only one
whose mapping has to be written before it can be generated). The ordering argument in
§ 3 still holds for both. What has changed is that the pattern now exists in the
repository rather than only in this document — including the part the document got
wrong.

## Amendment 4, 2026-09-01 — clause 2 holds on the web surface, and the split is `Gtk` vs `Adw` vs nothing

`@gjsify/adwaita-web` exports `Adw` and `Gtk`. Additive as § 3 promised: every `Adw…`
class export keeps working, every `<adw-…>` tag keeps working, nothing published moves.

**Which namespace a member lands in is not decided per element.** It is the prefix of
the GIR tag the element already answers to, which makes clause 1 a string split rather
than a mapping this repository would have to invent and then keep:

- the element's own spelling is a tag in the generated widget table (`adw-action-row`)
  → libadwaita owns the GType → `Adw.ActionRow`;
- the alignment table declares the element an alias of a `gtk-*` tag (`<adw-entry>` is
  `gtk-entry`) → GTK owns the GType → `Gtk.Entry`.

**The ten aliases therefore go under `Gtk`, not under `Adw`.** That is the table's own
verdict read out loud: each of the ten `why` fields says libadwaita subclasses nothing
here and styles the GTK type through a stylesheet partial, so the `adw-` prefix names
the design system and the widget is GTK's. Exporting them as `Adw.Entry` would have
carried the flattening this ADR exists to undo one indirection further in — the same
mistake in a new place, which is what § 1 says about documenting a GTK widget under an
Adwaita heading.

**§ 3's arithmetic was off by one, and the reason is in the ledger.** "44 members plus
10" is 53, not 54: `<adw-checkbox>` and `<adw-radio>` both declare `gtk-check-button`,
because GTK4 has no radio TYPE — a radio is a `GtkCheckButton` with its `group` set,
which `<adw-radio>`'s own `why` states. One GIR name cannot name two constructors, so
`Gtk.CheckButton` is `AdwCheckbox`, the plain form, and the grouped one stays reachable
as `AdwRadio`. A collision between two aliases is a shape § 3 did not anticipate and the
next surface will meet again.

**The eleven web-only elements get no member, and that absence IS the declaration.** A
`webOnly` entry says no widget in the reference vocabulary stands behind the element, so
there is no GIR name to export it under. The tempting exception is the four that DO name
a real libadwaita GType — `AdwTabPage`, `AdwViewStackPage`, `AdwSidebarItem`,
`AdwSidebarSection` descend from `GObject.Object` and not `GtkWidget`, so a table of
concrete widgets has no row for them — and taking it would have put four names in the
export whose only support is a sentence in this repository's own prose, which § 5 names
as the half that cannot go red. It is also unnecessary: the derivation reads the tag
table, so the day that table starts carrying one of them, its member appears by itself.
`<adw-toggle>` already made exactly that move (§ Amendment, 2026-08-28) and this export
would have needed no edit.

**Where it lives.** `packages/web/adwaita-web/src/namespace.ts`, re-exported from
`src/index.ts`, because a member per element plus an import per module is construction
and the repo rule is that an `index.ts` is re-exports only. `namespaceExport` in
`scripts/adwaita-elements.mjs` follows exactly one re-export hop for that reason, and now
reads each member's BINDING as well as its name — `Gtk.Entry: AdwEntry` and
`Gtk.Entry: AdwButton` are the same member list and different vocabularies.

**The hold is a rule in `check-vocabulary-alignment.mjs`, not a test in the package**, and
the choice follows from where the two sides live: the GIR-derived tag table and
`WEB_ELEMENT_ALIGNMENT` are both already read there, while a package-owned test would have
to reach across into `gtk-host/src/generated/widgets.ts` — a package `@gjsify/adwaita-web`
does not depend on — and become the second reader of it that `WIDGET_SURFACE_READERS`
refuses one level up. What a package test would buy is identity (`Gtk.Entry ===
customElements.get('adw-entry')`) and what it cannot do is enumerate what is MISSING, which
is the direction that matters. So the rule compares identifiers, and says so.

A/B, each branch separately, real exit codes read without a pipe: a deleted member
(`Adw.Clamp`), an invented member (`Adw.Ghost`), a member bound to another widget
(`Gtk.Entry: AdwButton`), an alias placed under the wrong namespace (`Adw.Entry`), the
whole export removed from the barrel, and — the derivation itself — a `webOnly` entry
re-declared as a `gtk-box` alias, which made the check demand a `Gtk.Box` that was not
there: exit 1 each time, exit 0 restored each time. The summary line now reads
`Namespace exports (ADR 0034 clause 2): 2 of 3 renderer(s)`.

**What is left of clause 2.** `@gjsify/adwaita-nativescript` alone — the largest, and the
only one whose mapping has to be written before it can be generated. Its widget ledger is
keyed on GTypes rather than tags, so its derivation is a lookup through
`NS_WIDGET_ALIGNMENT` rather than a prefix split, and it belongs beside the web rule when
it lands.

## Amendment 5, 2026-09-01 — clause 1 holds on the web surface, and the distance was measuring two surfaces out of three

`@gjsify/adwaita-web` names every element it registers after the library that owns the
GType. The nine that did not now do:

| was | is | GType |
|---|---|---|
| `<adw-button>` | `<gtk-button>` | `GtkButton` |
| `<adw-checkbox>` | `<gtk-check-button>` | `GtkCheckButton` |
| `<adw-drop-down>` | `<gtk-drop-down>` | `GtkDropDown` |
| `<adw-entry>` | `<gtk-entry>` | `GtkEntry` |
| `<adw-icon>` | `<gtk-image>` | `GtkImage` |
| `<adw-menu-button>` | `<gtk-menu-button>` | `GtkMenuButton` |
| `<adw-popover>` | `<gtk-popover>` | `GtkPopover` |
| `<adw-progress-bar>` | `<gtk-progress-bar>` | `GtkProgressBar` |
| `<adw-switch>` | `<gtk-switch>` | `GtkSwitch` |

The targets were read out of `WEB_ELEMENT_ALIGNMENT`, not chosen: every one of them is the
`gtk` field of that element's own entry, and every entry's `why` already said the widget is
GTK's and the `adw-` was the design system. The class and the module follow the tag —
`AdwEntry` is `GtkEntry` in `elements/gtk-entry.ts` — and `elements/adw-checks.ts` becomes
`elements/checks.ts`, because it registers one element from each namespace and naming the
file after either would put the mixing back one level down.

**NO ALIAS, NO DEPRECATION LAYER.** `<adw-entry>` is gone, not redirected. The package is
alpha and unversioned against outside consumers, and an alias would keep exactly the thing
the ADR is removing: two spellings for one widget, with the wrong one still working, still
copied out of a search result, and still needing an entry in a table. The cost of the
refusal is that a page written against the old tags renders nothing — loudly, since an
unregistered custom element is an inert `HTMLElement`, not an error.

### The TAG moved and the CSS CLASS did not, and that is the whole shape of the change

`<gtk-entry class="adw-entry">` — a GTK widget, Adwaita-styled — is the intended end state
and not a transitional one. The tag names the WIDGET and follows the GIR; the class names
the SKIN and follows libadwaita's stylesheet, which is what `refs/libadwaita`'s
`_entries.scss` is and what the `why` fields cite. So `scss/_entry.scss` now opens
`gtk-entry { … }` above an unchanged `.adw-entry { … }`, `_icon.scss` masks `.adw-icon`
under a `<gtk-image>` heading, and `input.className = 'adw-entry'` inside `GtkEntry` is
correct as written.

What makes a blind replacement wrong is that BOTH piles sit on the same string, and no
name is reliably one shape. At the merge base `eb33d22ee`, across the nine: **283
occurrences in tag position against 119 in class position** — but `adw-switch` is 15
class against 14 tag, `adw-icon` 38 against 49, and `adw-checkbox` and `adw-progress-bar`
have no class occurrence at all. A per-NAME rule would have been wrong for two names in
opposite directions, so the split was made per site.

```sh
# The two piles per name, at the commit before the rename. Pinned, because this is a
# statement about a tree that no longer exists — the same reason the table at the top
# of this ADR pins `refs/libadwaita` at 42f647ff.
for t in adw-button adw-checkbox adw-drop-down adw-entry adw-icon \
         adw-menu-button adw-popover adw-progress-bar adw-switch; do
  printf '%-18s tag=%-4s class=%s\n' "$t" \
    "$(git grep -hoE "</?$t[ />]" eb33d22ee -- . ':!refs' | wc -l)" \
    "$(git grep -hoE "\.$t([^a-z0-9-]|$)" eb33d22ee -- . ':!refs' | wc -l)"
done
```

The class pile is measurably intact: re-run the second half against `HEAD` and it has
gone UP, never down — not one `.adw-*` occurrence of the nine was carried off by the
rename.

(An earlier draft of this section read *"35 tag occurrences against 87 CSS ones"* for
`adw-entry` and *"636 occurrences moved and 129 deliberately did not"* repo-wide, with no
command under either. Neither is reproducible at any revision or under any reading of
"occurrence" — `adw-entry` has 73 occurrences in total at the base — and the first got the
DIRECTION wrong, which is the half the argument leans on. That is the failure the
§ *How the numbers here were obtained* table at the top of this ADR exists to prevent,
committed inside the file that states the rule.)

**Reading each site is what was done, and reading is not a mechanism.** Five sites a
context rule got wrong were caught only because a human read the diff — three
`h('span', { class: 'adw-icon …' })` calls in the storybook, and two prose sentences about
the NativeScript `AdwIcon`, whose class did not move. That is the incident behind
`scripts/check-adwaita-tag-vs-class.mjs`: the two piles have DISJOINT definition sets — an
element exists because `customElements.define` names it, a class because a rule selects it
— so a tag position resolving to no registered element and a `gtk-` name in class position
are each a failure a machine can see. Both failure modes are otherwise silent: an
unregistered custom element is an inert `HTMLElement`, and a class whose rule stopped
matching reports nothing at all.

### `<adw-radio>` keeps its name, and its kind changes from `gtk` to `webOnly`

Two elements declared `gtk-check-button`, and one tag cannot name two constructors. The
plain form takes the GIR name — the same verdict § Amendment 4 reached one level up, where
`Gtk.CheckButton` is `AdwCheckbox` and the grouped one stays reachable under its own name.

`<adw-radio>` therefore stays `<adw-radio>`, and its entry moves to `webOnly`. That is not
a demotion to "no GTK widget behind it": there plainly is one, and the entry says so. It is
the honest reading of what the kinds MEAN. A `gtk` entry says *this should converge, and
here is why it has not yet*; `<adw-radio>` can never converge, because GTK4 has no radio
TYPE to converge towards — a radio is a `GtkCheckButton` with its `group` set, which is
what `GtkCheckButtonProps.group` says in `generated/props.ts`. An entry that permanently
promises a convergence that cannot happen is worse than one that records why there is
nothing to promise.

So `webOnly` now covers two shapes and the table's header says which: no GTK widget at all
(`<adw-card>` is a style class, `<adw-alert-response>` is a method call), or a widget whose
GIR name a sibling element already carries. Both are the same verdict — no GIR name is left
for this element to converge on — which is why they are one kind rather than two. The
alternative considered and rejected was merging the two elements into a single
`<gtk-check-button group="…">`, which is what GTK actually does: it is a behaviour change,
not a rename (a different native `<input type>`, a different ARIA role, a different
upgrade path for server-rendered markup), and `elements/checks.ts`' own header already
argues for keeping them as two elements over one partial.

### § 3's "never a rename" is not refuted, and a rename happened beside it

§ 3 is about clause 2, the NAMESPACE EXPORT: satisfying it moves nothing, because an export
is additive. That still holds and nothing here contradicts it. What this amendment records
is a separate act on clause 1 — the elements that were named WRONG were renamed — and the
two are not in tension: § 3 promises that adopting the namespace costs no consumer
anything, and says nothing about elements that name the wrong library. The distinction
matters because § 3's sentences are quotable in the other direction ("`<adw-entry>` keeps
working"), and after this amendment they are true of the namespace and false of the tag.

### The distance was narrower than its own sentence

"Distance to one vocabulary" summed the RENDERER tables only. The web surface's ten aliases
— ten elements naming a GTK widget under an `adw-` spelling, the exact thing the number
claims to measure — were not in it. The omission is old and structural rather than an
oversight in arithmetic: `WEB_ELEMENT_ALIGNMENT` was the only table when the line was
written, `renderers` was everything else, and the day the renderers grew a second table
nobody re-read the sentence.

So the number moved twice, and only the second move is progress:

| | printed distance |
|---|---|
| before, renderers only | **6** |
| the web surface counted, nothing else changed | **16** |
| after the nine renames | **6** |

The web element segment is where the work shows: `65 elements — 44 share a spelling, 10
alias one, 11 declared web-only` became `65 elements — 53 share a spelling, 0 alias one,
12 declared web-only`. What is left of clause 1 anywhere is the NativeScript port's six,
which this ADR already refuses to rename on cost.

### What renaming the tags made VISIBLE, which is the larger finding

`check-adwaita-element-properties.mjs` holds every element against the scalar GIR
properties of the widget it names. It could not see these nine at all: a tag with no GIR
counterpart has nothing to be measured against, so nine elements sat outside a ratchet that
has been running since 2026-08-26. Renaming them added **56** property gaps to
`KNOWN_GAPS` in one commit — the backlog goes from 75 across 28 elements to 131 across 37 —
and not one of them is new. `<adw-entry>` observed five attributes against `GtkEntry`'s
scalar surface for its whole life.

Two shapes are mixed in that 56 and are listed rather than separated, because separating
them would be a verdict nobody has reached: an attribute the element does not carry
(`gtk-image/pixel-size`), and one it carries under its own spelling — `gtk-entry` observes
`placeholder` and `maxlength` where GTK spells them `placeholder-text` and `max-length`.
The second is `AdwEntry.placeholder` vs `GtkEntry:placeholder-text`, the example § Amendment
2 uses for the NativeScript property distance, now measurable on the web surface too. It is
a rename of a PUBLISHED attribute and out of scope here; what changed is that it is
countable.

### What it cost, stated because it is a loss and not a rounding error

`check-storybook-widget-coverage.mjs` joins the two renderers on the BARE name, and the
rename split two of those joins: the browser's `image` no longer meets NativeScript's
`icon`, and `checkbox` became `check-button`. The pair is one widget — `NS_WIDGET_ALIGNMENT`
declares `adw-icon` to be `GtkImage` and the distance counts it — but this check cannot see
that, so `GtkImage` left the both-renderers scope that demands a story, and its story
exemption had to be carried into two asymmetry entries that each say the other is the same
widget. Making the join vocabulary-aware needs the alignment tables out of
`check-vocabulary-alignment.mjs`, which runs a self-test and exits at module scope and
therefore cannot be imported; that extraction is a separate change and this is the entry
that says why it is owed. The row retires by itself the day the NativeScript widget
converges.

Three copies of one derivation also surfaced and were lifted: `AdwWidget.astro` and the two
gates that check its attribute pane each rebuilt a gallery title into an element tag by
prefixing `adw-`, and one of the copies carried a comment saying a second spelling "would be
the drift this file is against". It was, the moment the prefix stopped being a constant.
`galleryElementTag` in `website/src/components/attr-sample.mjs` is now the one of them, and
it reads the namespace out of the title instead of assuming it.

## Amendment 6, 2026-09-01 — the namespace is the surface, and the flat classes are gone

§ 3 says the namespace is "a RE-EXPORT layer, never a rename", that "**all of it is
additive**", and that `AdwEntry` keeps working. On `@gjsify/adwaita-web` it no longer
does. Every widget class the package root exported under a prefixed name — `AdwActionRow`,
`GtkEntry`, and the rest of that run — is removed from `src/index.ts`. `Adw.ActionRow` and
`Gtk.Entry` are the only spellings left.

**Why the clause that said "additive" is the clause being amended.** § 3's promise was
about the COST of adoption, and it bought what it was meant to buy: the export landed
without touching a consumer, and § Amendment 4 could hold it with a rule instead of a
migration. What it did not decide is what happens afterwards. A second spelling that is
never removed is not a migration path, it is a permanent second vocabulary — the exact
thing § 1 was written against, one level in from the four flattened GTK widgets that
started this ADR. The repository owner asked for the flat names to go; the argument for
going was already in § 1, and § 3 only ever deferred it.

The other three refusals in § 3 stand unchanged. The namespace is still not a rename of
the CLASSES: `elements/gtk-entry.ts` still declares `class GtkEntry`, because
`scripts/check-adwaita-tag-vs-class.mjs` derives that name from the tag and clause 1 is
what puts the tag there. What moved is one line in one barrel. The TAGS did not move
either — `<adw-action-row>` and `<gtk-entry>` are what § Amendment 5 left them.

### The split is widget-with-a-GIR-name versus everything else, and it is not 53 out of 53

The removal is not "every capitalised export". Of the package root's value exports:

| | count | what happens |
|---|---|---|
| widget classes with a namespace member | 53 | flat export **removed**; reachable as `Adw.X` / `Gtk.X` |
| element classes declared `webOnly` | 11 | flat export **kept** |
| non-widget values (helpers, constants, one factory) | 11 | flat export **kept** |
| supporting types, enums and unions | 13 | flat export **kept** (`export type`) |

The eleven `webOnly` classes are the interesting column, and they are kept for the reason
§ Amendment 4 gave for their having no member in the first place: no widget in the
reference vocabulary stands behind them, so there is no GIR name to export them under.
Inventing `Adw.Card` or `Adw.SidebarItem` to make the root uniform would put four names
back in the export whose only support is this repository's prose — § 5's half that cannot
go red — and would do it in the name of removing a second vocabulary. **A flat name that
is a widget's ONLY name is not a second spelling.** The duplication clause 2 removes is
two spellings of one widget, and after this amendment the package root has none.

`createGtkImage` is in the third row and is worth naming, because it looks like the second:
it is the factory that builds a `<gtk-image>` node without a tag, used by every element
that draws an icon. `Gtk.Image` is the class; a factory is not a widget and has no GIR name
either.

### The types had to become reachable, and the first way of doing it did not survive the bundler

`export const Adw = { ActionRow: AdwActionRow, … }` gives `Adw.ActionRow` in VALUE position
only. Every one of the seven call sites in this repository that imported a flat widget
class imported it with `import type`, to annotate a `document.createElement(...) as …`
cast. Removing the flat export without a type would have replaced a name with
`InstanceType<typeof Adw.HeaderBar>`, which is the same convergence spelled worse.

**The first attempt merged each object with a type-only `export namespace` of the same
name. `tsc` accepts that; rolldown's oxc parser does not, and the failure is a
`PARSE_ERROR`:**

```
rolldown: Bundler::generate: BatchedBuildDiagnostic([
  BuildDiagnostic { severity: Error, kind: "PARSE_ERROR",
                    message: "Identifier `Adw` has already been declared" },
  BuildDiagnostic { severity: Error, kind: "PARSE_ERROR",
                    message: "Identifier `Gtk` has already been declared" }])
```

Declaration merging is a type-checker rule; the parser sees two bindings of one name and
stops. It took down every showcase that imports the package — and `gjsify tsc --noEmit`
was green on the same tree, in the package AND in the consumers, because **the two tools
check different things and the bundler is the stricter one**. That is the note worth
keeping: on this repository, "the types compile" is not evidence that the code builds.

**What it is instead: `export * as`, and the namespace is a MODULE.** `src/namespace.ts`
became `src/namespace/adw.ts` + `src/namespace/gtk.ts`, each a barrel of
`export { AdwActionRow as ActionRow } from '../elements/adw-action-row.js';` lines, and
`src/index.ts` does `export * as Adw from './namespace/adw.js'`. No TypeScript construct
at all — a module namespace carries the value AND the type meaning of every name in it, so
`new Adw.ActionRow()` and `as Adw.ActionRow` both work.

This is better than what it replaced and not merely equal to it. The merged version needed
a member in the object and a matching entry in the type namespace: two lines per widget,
in two lists, in one file. Here there is **one line per widget and one list**, so the
question "can the types drift from the values" has no place to happen. It is also closer
to what § 3 asked for — the members are re-exports, not construction, and the module that
holds them is a barrel in the sense this repository already uses.

`namespaceExport` in `scripts/adwaita-elements.mjs` therefore DID need the change the
brief anticipated, and it reads a second shape rather than a looser one: an object literal
(`export const Adw = { Bin, Clamp }` — React Native, and what NativeScript will be) or a
module (`export * as Adw from '…'`, whose `export { X as Y } from` lines are its members).
Both yield the same member → binding map. A barrel that yields NO member throws, for the
reason every other reader in that file throws on an empty scan. The gate still prints
`Namespace exports (ADR 0034 clause 2): 2 of 3 renderer(s) — @gjsify/adwaita-web exports
Adw with 44 and Gtk with 9`.

§ Amendment 4's "**Where it lives**" paragraph names `src/namespace.ts`; that was true the
day it was written and the file is now the two modules above.

### What the flat exports were silently load-bearing for

Two browser drivers — `connect-lifecycle.spec.ts` and `slotted-children.spec.ts` — derive
their element set from the package rather than from a list: `Object.values` of the module
namespace, kept to the functions whose prototype is an `HTMLElement`. That worked because
the barrel re-exported every widget class flat. After the removal the identical scan finds
eleven classes instead of sixty-four, and **nothing about it looks different**: it still
enumerates, still asserts per tag, still passes. The only thing between that and a green
run reporting a fifth of the coverage it used to was `connect-lifecycle.spec.ts`'s
`tags.length > 40` floor.

A floor catches a collapse. It does not catch a scan that is merely narrower than it
reads, and the next removal will be smaller. So the walk is now one shared function —
`exportedElementClasses` in `src/exported-elements.ts`, one level into the exported objects
because that is where `Adw` and `Gtk` put their members — rather than the same eight lines
in two files.

The number is a SET COMPARISON and not a net: the package's browser bundle runs **4633
assertions on the commit before this change and 4633 after it**, so nothing was traded for
anything. A/B on the helper, each branch built and run separately, exit codes read without
a pipe: with the top-level-only scan restored the leg exits 1 with two floors red
(`finds the elements and their containers`, `finds the elements that declare slots`) and
**4446** assertions — 187 gone; with the helper, exit 0 at 4633.

### The local build that was green did not build a single consumer, and the reason is a name

`gjsify run build` passed on the tree that CI then failed. It is not a stale-artifact
story: the root script's `foreach` carries `--exclude "@gjsify/example-*"`, and **every
one of the 23 showcases under `showcases/` is named `@gjsify/example-…`**. So the one
command that sounds like "build everything" builds no consumer of any package in this
repository, and an export SHAPE — as opposed to an export's type — is only ever exercised
by a consumer bundle. `gjsify run build:examples` is the command that reaches them, and
`gjsify workspace @gjsify/example-dom-canvas2d-fireworks build` is the one that reproduces
this failure in about a minute.

Worth writing down because the gap is not obvious from either side: the exclusion is there
so a library change does not pay for 23 app bundles on every run, and the name
`build`/`build:examples` does not say that the second one is where the type-checker stops
being the authority.

This is the third time in this ADR that the interesting finding was not the change but
what the change made visible. § Amendment 5 found nine elements sitting outside a property
ratchet; this one found two drivers whose subject was the export list and not the registry,
and a build command whose scope nobody had had a reason to read.

## Amendment 7, 2026-09-01 — clause 2 holds on all three, and the NativeScript names moved

> **Superseded in part by § Amendment 9 (2026-09-03).** The additive arrangement below was
> the adoption step; the prefixed widget classes are now gone from the package root. "The
> shape is the object literal" also moved — `Adw` and `Gtk` became MODULES for the same
> reason § Amendment 6 gives, one surface later.

`@gjsify/adwaita-nativescript` exports `Adw` (38 members) and `Gtk` (5) from
`src/namespace.ts`, and the summary line reads **`Namespace exports (ADR 0034 clause 2):
3 of 3 renderer(s)`**. Clause 2 is done.

**The lookup § 3 predicted is the whole difference, and it was the easy half.** This
ledger is keyed on GTYPES (`gir: 'GtkButton'`), not on tags, so placing a member goes
through the generated widget table before the prefix split can run. That made
`namespaceProblems` take a *surface descriptor* rather than the web world it used to read
four fields off: one rule, two surfaces, and the only per-surface part is how a widget
resolves to a GIR tag. React Native stays where it was — rule 8 of
`check-adwaita-rn-platform-split.mjs` — because the three-barrel split makes its question
a different one, and a surface this file is handed no `namespace` for is simply not held
here.

**The shape is the object literal, not the module § Amendment 6 moved the web surface to.**
That amendment's constraint was a bundler one — declaration merging is a type-checker rule
and rolldown's parser refuses two bindings of a name — and it applies to a barrel that must
carry a TYPE meaning as well as a value one. Nothing here annotates with `Adw.ActionRow`:
this surface's widgets are constructed and its consumers import the class. So the literal
stays, `namespaceExport` reads both shapes already, and the day a consumer needs the type
meaning this file moves the same way with no rule to change.

**Three widgets get no member, and one of them refutes § 1's own sentence.**
`AdwSliderRow` and `AdwDataGrid` are `own`: no counterpart type, so no GIR name.
`AdwImageButton` is a `composes`, and § 1 says a composition *"converges in NAME
(`gtk-button`), never in shape"* — but this port ALSO ships the plain button, which is
`GtkButton` now, so the name § 1 hands it is taken. One GIR name cannot name two
constructors: the same collision `Gtk.CheckButton` met on the web surface (§ Amendment 4),
arriving from the other direction. The plain form holds the name; the composed one keeps
its own and converges in neither. § 1 has no word for that outcome, and the ledger entry
says so rather than pretending it is one of the four kinds it fits worst.

### Clause 1: four of the five renamed, and the fifth is blocked on a sibling

`AdwButton`, `AdwDropDown`, `AdwEntry` and `AdwMenuButton` are `GtkButton`,
`GtkDropDown`, `GtkEntry` and `GtkMenuButton`, in `gtk-*.ts`. **No alias, no
back-compat shim** — the repo is alpha and the owner decided that; each file's header
already carried the reason its class name contradicted (*"libadwaita has no menu button
of its own; it styles the GTK one"*).

`AdwIcon` → `GtkImage` did NOT happen, and the reason is not the port. Converging it is
the only one of the five that also changes the **bare** name (`icon` → `image`), and the
bare name is what `check-storybook-widget-coverage.mjs` joins the two renderers on. Doing
it here alone turns one widget into two one-renderer-only widgets, and invalidates its own
`NO_STORY_OF_ITS_OWN` exemption: three failures whose only repair is three ledger entries
that would each state something false. The two surfaces rename together, in one change.
That is a cross-surface coupling § 1 does not mention and the next converging port will
meet: **a rename is per-surface only where the bare name survives it.**

### What the readers cost, which is more than the rename did

`adwaitaNativeScriptWidgets` now keys on the TAG rather than the bare name — `button`
alone cannot say whether the file is `adw-button.ts` or `gtk-button.ts`, and the ledger it
feeds is keyed on exactly that distinction. Everything downstream takes `elementName(tag)`,
the hop the web reader's callers already made.

The defect worth recording is in `check-generated-website-data.mjs`, which used
`node.tag.startsWith('Adw')` to mean *"a class this package declares"*. Under the rename a
`Gtk*` widget read as a NativeScript-CORE class, so no setter was ever looked up for it and
every attribute it carries fell through to the core-property exemption list — the gate went
red saying `<GtkButton>` has no setter `variant`, which it does. A prefix used as a
*membership test* is the shape to look for: it is invisible while exactly one prefix exists.

### The property names: eleven of twenty-five, and the rule that split them

| converged | to |
|---|---|
| `AdwButtonContent.icon`, `AdwIcon.icon`, `AdwImageButton.icon`, `AdwStatusPage.icon`, `AdwSplitButton.actionIcon` | `iconName` |
| `AdwButtonRow.startIcon` / `.endIcon` | `startIconName` / `endIconName` |
| `AdwComboRow.selectedIndex` | `selected` |
| `AdwToggleGroup.selected` | `active` |
| `GtkEntry.placeholder` | `placeholderText` |
| `AdwSplitButton.disabled` | `sensitive` — a rename AND an inversion |

**A name converges when the two sides hold the same KIND of value and differ only in
spelling.** A string is a string whether it is a theme name or an SVG source, which is why
every icon slot moved. `disabled` → `sensitive` moved too, and it is the one that had to:
a `disabled` sitting beside GTK's `sensitive` is the false friend this ADR exists to
remove, and leaving it declared would have been leaving it.

The ones that stayed are not a backlog of the same shape. Almost all of them are a SHAPE
difference wearing a name — the GIR key holds a list model (`model`, `menuModel`), an
adjustment (`adjustment`), a widget (`titleWidget`), a page object (`selectedPage`), a
class list (`cssClasses`) or a name where the port holds an index (`visibleChildName`).
Taking those names would put a GTK word on a value that is not the GTK thing, which is the
flattening this ADR undoes, one level down. Some of those are additionally structural:
`AdwSpinRow`'s `min`/`max`/`step` and `AdwHeaderBar`'s `title`/`subtitle` each collapse
into ONE key, and one name cannot be two.

> **Superseded by § Amendment 11 (2026-09-05)** in subject and verdict: `openState` converged,
> and the rule now explains every entry the ledger still carries. The paragraph below is left
> as written because the mistake in it is what the amendment is for — it ruled a convergence
> out after considering exactly one repair for the obstacle. The rest of this section stands.

`AdwBottomSheet.openState` is the single entry the rule does not reach, and naming it is
the point: both sides hold a BOOLEAN, so the rule says converge. What stops it is a
collision inside JavaScript — `open` is taken by the class's own `open()` method, and
libadwaita gives the type no method names to rename those to, so converging would trade a
declared property divergence for an invented, undeclared method one.

**No per-group count is written here.** The first draft of this paragraph split the
remainder eleven-plus-three, which comes to fifteen against a table of fourteen and put
`openState` in a bucket it does not belong to. § *Why the distance has to be PRINTED by a
gate and not written in prose* is about the total; a breakdown beside it is the same
hazard one level down.

### The numbers, and what is left

    Distance to one vocabulary: 2 widget name(s) and 14 property name(s)   (was 6 and 25)
    46 @gjsify/adwaita-nativescript widgets — 42 share a spelling, 2 should converge, 2 declared own, 0 undecided
    143 settable properties — 102 agree with the counterpart's ConstructorProps, 41 do not

A/B, each branch separately, real exit codes read without a pipe: a deleted member
(`Adw.Clamp`), an invented member (`Adw.Ghost`), a member bound to another widget
(`Gtk.Entry: AdwButton`), an alias placed under the wrong namespace, the whole export
removed from the barrel, a converged widget renamed back to `adw-*`, a widget file whose
class stopped matching its name, a ledger entry left behind for a converged widget, a
converged property renamed back, and a ledger entry left behind for a converged property:
exit 1 each time, exit 0 restored each time.

What is left of the convergence on this surface is `AdwIcon` (with `@gjsify/adwaita-web`,
in one change), `AdwImageButton` (nothing to converge to), and the property names whose
GIR key names a different kind of value.

### What the rename left behind, and the two gates that now hold it

Review of this branch found six call sites the rename missed, in two shapes, and neither
gate above could see either — so the fix is two arms rather than six edits.

**The prefix used as a membership test, a second time.** § *What the readers cost* records
`check-generated-website-data.mjs` reading `startsWith('Adw')` as *"a class this package
declares"*. `scripts/generate-adwaita-nativescript-templates.mjs` asked the same question
the same way, twice: to decide which element gets the `adw:` module prefix, and to decide
what the probe app's `xmlns` barrel re-exports. So `GtkButton` and `GtkEntry` shipped into
`app/views/*.xml` UNPREFIXED — NativeScript then resolves them against its own components
and Builder finds nothing — and out of the barrel entirely. Every gate was green, because
the arm that reads those files compares them with the generator that wrote them: one
answer, wrong on both sides. The generator now uses the shared `WIDGET_CLASS`, and
`check-generated-website-data.mjs` holds the emitted bytes against `export class
<anything>` over the widget files, which knows no prefix rule.

**A converged property still written under its old name.** `AdwToggleGroup.selected`
became `active`, and four story files plus one published fence kept assigning `.selected`
and `.icon`. A NativeScript view takes an unknown assignment as a dead own-property — no
throw, no warning — and the showcase that would type-check the same code is `private`,
declares `@nativescript/core` as an optional peer and is compiled by no CI job. So the
storybook's `active` control moved and did nothing, which is the exact incident
`check-storybook-control-parity.mjs` opens with, and `buttons.mdx` taught the dead name.
Both corpora now hold every write on a constructed widget against that widget's members
plus the ambient `ns-core.d.ts` slice: `check-storybook-control-parity.mjs` for the
stories, `check-doc-fences.mjs` for the fences.

**A rename is per-surface only where the bare name survives it** — § *Clause 1* already
says that about `AdwIcon`. These two add the other half: a rename is only DONE where every
reader that decides "is this ours" and every caller that writes the name have been asked,
and on this surface neither question had an oracle. Four A/B pairs, each after the
formatter ran (a wrapped guard is a defused guard): an unprefixed element, a barrel export
dropped, a story write renamed back, a fence write renamed back — exit 1 each, exit 0
restored each.

## Amendment 8, 2026-09-03 — the flat classes are gone from React Native too, and one line now carries what two did

`@gjsify/adwaita-react-native` exports `Adw` with 28 members on each of its three
barrels, and nothing else names a widget. The run of `export { AdwActionRow } from
'./widgets/action-row.js'` lines — 28 per barrel, 84 in the package — is removed from
`src/index.ts`, `src/index.gtk.ts` and `src/index.native.ts`. `Adw.ActionRow` is the only
spelling the package root has.

This is § Amendment 6 applied to the second surface, for the reason given there: § 3's
"**all of it is additive**" bought the ADOPTION and decided nothing about afterwards, and
a second spelling that is never removed is a permanent second vocabulary — the thing
clause 1 exists to remove, one level in. § Amendment 3's "Additive: `AdwBin` keeps
working and nothing published moves" is the sentence being amended here; it was true of
the export and is not true any more.

**It cost nothing to migrate, and that is a measurement rather than luck.** Outside the
package, `@gjsify/adwaita-react-native` is named in 20 files and IMPORTED in none
(`git grep -l`, minus the package's own four): `gtk-host`'s `descriptors/adw.ts`,
`adwaita-core`'s `wrap-box.ts`, the NativeScript `wrap-box-layout.ts`, a showcase's
refusals table and the website's React Native page all mention it in prose or provenance;
the rest are the readers, the workflows, the changelog and this document. Inside the package, no module imports the barrel
either — the specs import widget modules directly, which `parity.spec.ts` explains is
forced (`platform-resolve` rewrites `./index.js` to `./index.gtk.js` before the bundler
sees it, so the obvious version of that suite asserted a refusal against the GTK
component). So the two things § Amendment 6 had to pay for on the web — six showcase
files and a browser driver whose element set came out of the barrel — have no counterpart
here.

### The split, and the one place a flat `AdwClamp` still lives on purpose

|  | count per barrel | what happens |
|---|---|---|
| widget components with a namespace member | 28 | flat export **removed**; reachable as `Adw.X` |
| prop interfaces, handles and shared unions | 34 | flat export **kept** (`export type`) |

There is no third column, because this package root has nothing else in it: no helper, no
factory, no widget without a GIR name. The 12 `webOnly` element classes that made
§ Amendment 6's table interesting have no counterpart — every widget here already shares
a spelling with a GTK tag, which is what `check-vocabulary-alignment.mjs` has printed
since § Amendment 3 (*"28 share a spelling, 0 should converge, 0 declared own, 0
undecided"*).

The types stay flat for the reason § Amendment 6 gave: `AdwClampProps` is not a second
name for a widget, and `Adw.ClampProps` would name something libadwaita does not have.

**What is NOT removed is the components' own `AdwClamp` identifier**, and it is worth
saying why, because unlike the web surface this package publishes a per-widget entry
point. `exports['./widgets/clamp']` is how a consumer takes one widget without the barrel,
and there `AdwClamp` is the widget's ONLY name — § Amendment 6's rule, at a different
door. Renaming it to a bare `Clamp` would put an unqualified noun in a consumer's import
list, and it would break the coupling three readers derive through `widgetClass`:
`adwaitaReactNativeWidgets` holds the class name against the module name,
`check-adwaita-rn-platform-split.mjs` rule 8 holds the namespace member against the
module it is bound from, and `refuseBaseModule` prints the component in the message a
mis-resolved base module throws. Rule 10 (below) says this in its failure text, so the
distinction does not have to be re-derived from this document.

The residual is therefore real and named: a consumer CAN still write `AdwClamp`, from the
subpath. What it cannot do any more is write it and mean the barrel.

### An object literal here, a module on the web, and the difference is types

§ Amendment 6 had to make `Adw` a MODULE (`export * as Adw from './namespace/adw.js'`)
because the web's classes are annotated — `document.createElement(...) as Adw.HeaderBar`
— and `export const Adw = {…}` gives value position only. This surface keeps the object
literal, on both halves of the fork, and needs nothing more: the members are function
components, and the TYPE authority is the `Adw…Props` interfaces that stay exported flat
beside them. `React.ComponentProps<typeof Adw.Clamp>` works off the literal.

The second reason is the platform split. Each barrel must build `Adw` from its OWN
platform modules (§ Amendment 3), and rules 3 and 5 of
`check-adwaita-rn-platform-split.mjs` read module specifiers out of the barrel file
itself. A namespace module per barrel would put the fork one hop away from the file those
rules read, and buy nothing this surface uses.

### The reader lost its second mention, and that is the interesting part

§ Amendment 3 explained why the namespace members were IMPORTED a second time instead of
being built from the re-exports above them: those `export … from` lines were load-bearing
for `adwaitaReactNativeWidgets`, which derives this package's widget set from them and
refuses a line whose exported name and module name disagree. "Two mentions of each module,
held equal by a rule, beats one mention that no longer says which widget it is."

Removing the export leaves ONE mention, so the coupling moves onto the line that stayed —
which carries one half more than the old one did. `adwaitaReactNativeWidgets` now reads
`import { AdwClamp as Clamp } from './widgets/clamp.js'` and holds BOTH halves against the
module name: the binding must be `widgetClass('clamp')`, and the member must be
`Clamp`, because since this amendment the member IS the name the package publishes.

**And a one-mention reader needs vectors, which the two-mention one did not.** Its
under-read is the QUIET kind: fewer widgets read means a shorter widget set, and
`RN_WIDGET_ALIGNMENT` — empty — agrees with a shorter set exactly as well as with the
right one. That is § Amendment 6's "scan that is merely narrower than it reads", arriving
where no floor and no assertion count would notice. So `reactNativeBarrelWidgets` is split
out as a pure function over source, and `check-vocabulary-alignment.mjs` gained eight
vectors beside the namespace-barrel ones (19 reader vectors → 27).

**The first of them went red on the first run, and the bug was a comma.** The regex
required `}` directly after the alias, and oxfmt writes a trailing comma as soon as an
import wraps — so the day the longest-named widget in the barrel wrapped
(`AdwNavigationSplitView as NavigationSplitView` is 94 characters with its specifier), it
would have dropped out of every set derived from the barrel with every gate green. The
vector is what found it; nothing in the real tree does, because the real tree has not
wrapped yet.

### Rule 10: what stops the flat spelling from growing back

Rule 8 holds what `Adw` CONTAINS. Nothing held what sits beside it, and the removed run
was one `export … from` line per widget — the cheapest thing in this repository to put
back, and invisible in a review that is looking at the namespace. Rule 10 of
`check-adwaita-rn-platform-split.mjs` refuses a widget class in any `export { … }` clause
of any of the three barrels.

It is derived from the widgets on disk rather than from a `/^Adw[A-Z]/` shape, because
the barrels legitimately export `AdwClampProps` and `AdwToastOverlayHandle`, and a rule
that refuses a SHAPE is one prop type away from a false alarm — which is how a gate gets
loosened. And it reads BOTH halves of a specifier: `export { AdwClamp as Clamp }`
publishes no `AdwClamp` and is still the barrel re-exporting a widget class, one that
would put a bare `Clamp` at the root as a THIRD spelling.

A/B with real exit codes, each shape separately, restored between: `export { AdwClamp }`
→ exit 1; `export { AdwClamp as Clamp }` → exit 1; removed → exit 0. Rule 3 was
re-falsified in the same way after the comment stripper it shares was factored out, so a
refactor made for rule 10 could not have quietly stopped rule 3 from reading anything.

### The numbers, and what did not move

Both halves, each rebuilt and run separately, exit codes read without a pipe: **478
assertions on the Node leg and 350 on the GJS leg, on the commit before this change and
after it**. Nothing was traded for anything — the specs import widget modules directly, so
no suite's subject was the barrel's export list. `check-adwaita-rn-platform-split` reports
28 widgets on all three barrels before and after; `check-vocabulary-alignment` still
prints `28 @gjsify/adwaita-react-native widgets — 28 share a spelling, 0 should converge,
0 declared own, 0 undecided` and `@gjsify/adwaita-react-native exports Adw with 28`, with
its reader-vector count up from 19 to 27.

### What is still not held, and it is not this surface's to hold

> **§ Amendment 9 (2026-09-03) built the gate this section asks for**, on
> `@gjsify/adwaita-web` and `@gjsify/adwaita-nativescript`: a file outside a surface's own
> package may not import a binding that sits behind a namespace member. It does not reach
> this surface, which `check-vocabulary-alignment.mjs` is handed no `namespace` for, and it
> does not reach the 12 `webOnly` classes either — they keep their flat export, so they are
> not retired and a consumer importing one is still importing a name that exists.

Nothing checks how a CONSUMER spells the vocabulary. On this surface that gap is
currently closed by arithmetic rather than by a gate: the root exports NO flat widget
class at all, so `import { AdwClamp } from '@gjsify/adwaita-react-native'` is a
resolution error in every tool that reads the barrel. The web surface is where the gap is
real — 12 `webOnly` classes keep their flat export there, so a flat import still resolves
and a consumer can go on spelling the vocabulary the old way with nothing failing. A
gate over consumer import sites belongs beside that, not here.

## Amendment 9, 2026-09-03 — the flat classes are gone from NativeScript too, and the XML prefix became the library

§ Amendment 7 left `@gjsify/adwaita-nativescript` holding clause 2 ADDITIVELY: `Adw.SwitchRow`
and `AdwSwitchRow` were both exports of the package root, and every consumer in this
repository still wrote the second. That is the arrangement § Amendment 6 refused on
`@gjsify/adwaita-web` and § Amendment 8 refused on `@gjsify/adwaita-react-native` — *"a second
spelling that is never removed is not a migration path, it is a permanent second vocabulary"* —
and the same sentence applies here unchanged. The 43 prefixed widget classes with a namespace
member are gone from `src/index.ts`; `Adw.*` and `Gtk.*` are the only spellings left. This is
the third of the three surfaces, so with it no widget that HAS a namespace member is reachable
flat from any package root — the ones that keep a flat name are the ones for which it is their
only name, on every surface for the reason § Amendment 6 gives.

**What moved with them, and it is the interesting half.** On the other two surfaces the removal
stayed inside the barrels, because their dialects carry the library somewhere the removal does
not reach: the web's TAGS do it — `<gtk-entry>` says GTK whether or not any JS identifier does
— and React Native's JSX names a component with the binding itself, so `Adw.Clamp` says it
(§ Amendment 8). NativeScript's XML dialect has neither. An element is resolved by reading its
LOCAL NAME off the module its `xmlns` prefix names — `component-builder`'s
`createComponentInstance` ends in `instanceModule[elementName]`, nothing else — so before this
change the library lived in the element name (`<adw:GtkEntry>`, where the `adw:` prefix was
just the module and the class name carried the meaning). Take the prefix out of the class name
and the XML prefix is the ONLY thing left that can say which library a widget belongs to.

### Two prefixes, and — the part that is not obvious — two MODULES

`<adw:PreferencesGroup>` and `<gtk:Button>` is the spelling. The decision that took an
argument is what each prefix points at.

`xmlns` names a module path, so two prefixes may perfectly well name ONE module. That is the
cheap option and it is wrong: the module would export `PreferencesGroup` and `Button`
together, `<adw:Button>` would resolve, and NativeScript would build the GTK button under the
Adwaita prefix at exit 0. It re-creates, in the one dialect where the prefix is the whole
signal, exactly the flattening § 1 exists to undo. A lint rule could catch it — and would be a
guard watching a mechanism, which the root AGENTS.md § Governance names as the smell.

So there are two disjoint modules, `~/adw` and `~/gtk`, which § 3 anticipated in one clause
(*"a second XML barrel so `xmlns:gtk="~/gtk"` resolves `<gtk:Entry/>`"*) without arguing for
it. The argument is that it turns a silent wrong answer into a load-time failure, with no rule
to run: `findMatch` in `module-name-resolver/qualifier-matcher` compares the resolved path for
EQUALITY, so `~/adw` resolves to the `adw` barrel and nothing else, and a member it does not
export throws out of `createComponentInstance`'s catch. The package publishes the two barrels
as the subpaths `@gjsify/adwaita-nativescript/adw` and `/gtk`, so an app's barrel is one
`export { … } from` line rather than a hand-kept list of classes.

**Measured, against upstream's own resolver.** No Android emulator would start on the
workstation this landed from — `qemu-system-x86` SEGVs about twenty seconds into boot on every
AVD, with and without KVM, so `showcases/dom/adwaita-gallery-nativescript` could not be run
and the device leg of this change is UNPROVEN. What was run instead is upstream
`@nativescript/core@9.1.0-alpha.11`'s real `getComponentModule` under Node, with its CJS
directory imports and `.android` variants resolved by a loader hook and the screen metrics
handed to its own `ModuleNameResolver`:

    PASS  <adw:PreferencesGroup>        ->  PreferencesGroup
    PASS  <adw:SwitchRow title="x">     ->  SwitchRow
    PASS  <gtk:Button>                  ->  Button
    PASS  <adw:Button> (must FAIL)      ->  Module 'adw' not found for element 'adw:Button'.
    PASS  <adw:AdwSwitchRow> (must FAIL)->  Module 'adw' not found for element 'adw:AdwSwitchRow'.
    PASS  attribute reached the instance ->  Automatic updates

That is the resolution rule and the wrong-prefix failure, both from upstream's code rather
than from a reading of it. It is not a substitute for the probe: it says nothing about a view
TREE, which is the half `gallery-page.ts` exists for and the half that stays unmeasured here.

### The other dialect keeps the class names, and that is not an inconsistency

`registerAdwaitaElements()` registers `AdwSwitchRow`, `GtkEntry` and the rest with the
`registerElement` global that `@nativescript/angular` / `nativescript-vue` provide. Those names
do NOT move. That dialect has one flat global namespace and no prefix at all, so the class name
is the widget's ONLY name in it — the same reason § Amendment 6 kept `<adw-action-row>` and the
eleven `webOnly` classes: a flat name that is a widget's only name is not a second spelling.

### Three widgets have no name in the XML dialect, and the generator says so

`AdwImageButton` (a `composes`), `AdwSliderRow` and `AdwDataGrid` (`own`) have no namespace
member, so neither barrel exports them and no `prefix:Member` names them. No gallery template
uses one. `qualify()` in `generate-adwaita-nativescript-templates.mjs` THROWS on such a widget
rather than emitting it unprefixed, because unprefixed is what NativeScript resolves against
its own components — the exact failure § Amendment 7 records four clause-1 renames shipping
through. A consumer app is unaffected: its own barrel may export whatever it likes, including
the class.

`ADWAITA_GALLERY_NS_REFUSALS` still names classes (`AdwComboRow.model is a list of
items`), and that is a DECLARED divergence rather than an oversight: a refusal is a statement
about the port's implementation, the classes did not move, and
`check-generated-website-data.mjs` tells a class MENTION from the gallery block's title by
exactly that spelling (`CLASS_MENTION`, `\b((?:Adw|Gtk)[A-Z]\w*)`). Converging the prose would
take that discriminator away from the arm that caught `AdwToast` standing in for
`AdwToastOverlay`.

### The gate: nothing was watching the CALLER, which is why the examples never had to change

`check-vocabulary-alignment.mjs` held the PACKAGES. It could not have failed on a consumer
writing `AdwStatusPage`, and it still cannot on one writing a property that moved — that is
`check-doc-fences` and `check-storybook-control-parity`. Two arms close it, both in that file
because both sides of each already live there:

- **the flat name is gone**: a widget with a namespace member may not ALSO be exported flat
  from the package root. Until this, § Amendments 6 and 9 were prose — one re-added
  `export { AdwStatusPage }` line restores the second vocabulary with every other rule green,
  because the member is present, the widget is present, and they agree.
- **no caller writes it**: no file outside a surface's own package may import a retired
  binding. The retired set is DERIVED — it is the bindings behind the namespace members, and
  the arm above is what makes "has a member" and "has no flat export" the same statement.

**Why a gate and not the compiler.** Removing an export is a build error for every consumer
that is BUILT, and none of the consumers that TEACH the vocabulary are:
`showcases/dom/adwaita-storybook-nativescript` and `…-gallery-nativescript` are excluded from
the workspace globs and have no `check` script, the 40 published `.mdx` fences have no compiler
anywhere, and the XML dialect has no type-checker at all. Every story file and published fence
this amendment rewrote could have gone in wrong at exit 0.

**Two readers that decide "is this ours" had to move with it**, which is § Amendment 7's own
lesson arriving again: `check-doc-fences`'s `NS_CONSTRUCTION` and
`check-storybook-control-parity`'s `NS_WIDGET_FIELD` both keyed on `(?:Adw|Gtk)\w+`, and `.` is
not a word character — so `new Adw.StatusPage()` and `_row: Adw.SwitchRow` match neither. Both
gates SKIP what they cannot resolve, so a half-migrated tree would have quietly shed coverage
one file at a time (117 held writes → 0, still green). They share one `WIDGET_REFERENCE`
pattern and one `widgetClassOf` resolver now. The story arm reports 117 held writes after the
migration, which is what it reported before it — the number is here because it is a BEFORE and
an AFTER of the same reader, not because 117 is interesting.

A/B, each branch run separately and its exit code read without a pipe: a caller importing a
retired flat spelling, a flat export re-added beside its member, a caller scan that finds
nothing, an element written under its class name, an element under the wrong prefix, and a
barrel export dropped — exit 1 each, exit 0 restored each. Three of those are self-test vectors
(71 now, was 68); three are A/B against the real tree.

### What is left

`AdwIcon` → `GtkImage` still waits for `@gjsify/adwaita-web` to rename in the same change
(§ Amendment 7, § Clause 1) — the namespace does not wait, and `Gtk.Image` is its member
today. `@gjsify/adwaita-react-native` lost its flat widget exports the same day (§ Amendment 8),
and neither arm above reaches it: this file is handed no `namespace` for that surface, so
`NAMESPACE_PACKAGES` names two packages rather than three. Its flat half is held one file over,
by rule 10 of `check-adwaita-rn-platform-split.mjs`; its CALLER half is held by nothing, and
that is the gap that is left. Adding the third entry today would buy no coverage — with no
namespace to derive from, the retired set is empty and `callerProblems` skips the surface,
including the vacuity arm. It closes on the day this file is given that surface's namespace.

## Amendment 10, 2026-09-05 — the fifth NativeScript widget, and the class that stays behind

`AdwIcon` is `GtkImage`, and the widget-name distance is one.

**Why it was the one held back.** Amendment 6 renamed four NativeScript widgets and left this
one, because a second gate joins the two renderers on the widget's BARE name:
`check-storybook-widget-coverage.mjs` matched `icon` on NativeScript with `image` on the web
through a `sameWidgetAs` bridge, and renaming one surface alone was read as splitting one
widget into two one-renderer-only rows. The browser element had already taken the GIR name
(Amendment 5), so converging this one CLOSED the pair instead of splitting it — which the gate
confirmed in the only way worth having: it went red twice on the way, once per stale row, and
the two messages are different because the two rows became stale for different reasons —

    adw-icon:  ledgered as one-renderer-only, but it is on NEITHER renderer. Drop the entry.
    gtk-image: ledgered as one-renderer-only, but it is on BOTH renderers now — it landed.
               Drop the entry.

— then green with one row where two had been.

The story exemption the retired rows said the pair "inherits the day it converges" is now that
one row, carrying the same reason: there is no Adwaita or GTK icon WIDGET to demonstrate — GTK
draws a `Gtk.Image` inline, and the browser element exists because CSS needs a box to hang a
symbolic on.

**And a distinction this rename got wrong first, which a third gate caught.** The widget's
emitted STYLE CLASS was renamed with it, `adw-icon` → `gtk-image`, and
`check-nativescript-theme-classes.mjs` refused: *"gtk-image is listed, but no widget emits it
any more"*. It was right for a reason worth writing down, because the two vocabularies are not
one:

> A widget is named after the library that owns its **GType** (clause 1). A style class is
> named after the **design system whose stylesheet carries it**, which is Adwaita's.

`GtkButton` next door already does exactly this — the class it sets is `adw-button` — so the
four earlier renames left their classes alone and only this one moved them. The class is back
to `adw-icon` and the widget file says why in place.

That gate has a blind spot underneath, and it is worth stating rather than fixing here:
`isTracked` counts a name only when it starts with `adw-`. Today that is exactly right, since
every style class this port emits is Adwaita's. It stops being right the day a widget emits a
`gtk-`-prefixed class, and nothing would report it — the class would simply leave the gate's
sight. Recorded in `status/open-todos.md`; not changed now, because a rule widened before it
has a case to serve is a rule nobody can check.

## Amendment 11, 2026-09-05 — `openState` converged, and the reasoning that said it could not

§ Amendment 7's *The property names: eleven of twenty-five, and the rule that split them*
named `AdwBottomSheet.openState` as **the single entry the rule does not reach**, and gave
the reason: both sides hold a boolean, so the rule says converge, and what stops it is a
collision inside JavaScript with the class's own `open()` method — "libadwaita gives the type
no method names to rename those to, so converging would trade a declared property divergence
for an invented, undeclared method one."

The premise is right and the conclusion had one option too few. **Renaming the methods was
never the only way out of the collision; deleting them was.** Measured against
`refs/libadwaita/src/adw-bottom-sheet.h`: `grep -c 'adw_bottom_sheet_open\|adw_bottom_sheet_close'`
is **0** — the type has no open/close pair at all, and
`refs/libadwaita/src/adw-bottom-sheet.h:50#adw_bottom_sheet_set_open` is the setter of this
very property. So `open()` and `close()` were port-owned conveniences that existed to write
the property, and the property could not take its own GIR name because of them.
`sheet.open = true` is what both did.

That paragraph is left as written under a supersession note, because what is worth keeping is
not the verdict but the shape of the mistake: the reasoning ruled out a convergence by
considering exactly one repair for the obstacle and finding it worse than the disease. **A
collision with a port-owned method is not a reason a name cannot converge — it is a question
about the method**, and the question is whether the counterpart has one.
`check-vocabulary-alignment.mjs` carries that sentence in its ledger header now, where the
next entry of this shape will be read.

What it does NOT change: the rest of that section stands. The six entries the ledger still
carries are structural — a widget (`titleWidget`, twice), a page object (`selectedPage`), a
class list (`cssClasses`, twice) and a name where the port holds an index
(`visibleChildName`) — and none of them is a collision.

## Amendment 12, 2026-09-05 — the `gi://` arms, opt-in, and a refusal per granularity

Stage 9 is in. `import Adw from 'gi://Adw?version=1'` now resolves to the target's widget
renderer on `--app browser` and `--app nativescript` when the build passes `--gi-renderer`,
which is the last of the two things keeping the website's *Native TypeScript* and
*NativeScript* snippets from being the same text.

### The red, measured before the change and kept as a permanent row

`tests/e2e/gi-renderer-arms` builds `fixtures/probe.ts` — a `gi://` default import, a widget
taken out of the namespace, and `class ProbeRow extends Adw.ActionRow {}` — and evaluates
the bundle. Without the flag, on both targets:

```
TypeError: Class extends value undefined is not a constructor or null
```

which is the string this ADR's stage table predicted. The bundle rolldown emits for it is
one line — `var e={},ProbeRow=class extends e.ActionRow{}` — and it needs no host at all,
which is what makes that row usable as the suite's CONTROL rather than only as history.

### What is now true, per target

| | `--app browser` → `@gjsify/adwaita-web` | `--app nativescript` → `@gjsify/adwaita-nativescript` |
|---|---|---|
| flag-less bundle | 133 B, `Class extends value undefined` | 133 B, same |
| `--gi-renderer` bundle | 500 202 B | 214 041 B |
| `typeof Adw.ActionRow` | `function` | `function` |
| `Object.getPrototypeOf(ProbeRow) === Adw.ActionRow` | true | true |
| the class is the renderer's | `customElements.get('adw-action-row') === Adw.ActionRow`, 64 elements defined | `Adw.ActionRow.prototype instanceof` an `@nativescript/core` class |
| `new ProbeRow()` | an `HTMLElement` | not asserted — see *what is left open* |
| `import Adw from '@girs/adw-1'` | `function` with the flag, `undefined` without | same |
| `gi://` / `@girs/` substrings left in the bundle | 0 / 0 | 0 / 0 |
| `@nativescript/core` import clause | — | 1, still external |

Suite: **17 tests, 17 passing**. Mutation-tested by making the arm's `resolveId` return
`null`: **12 of the 17 go red**, and the 5 that stay green are exactly the rows that do not
depend on the arm resolving anything — the two flag-less controls, the two "flag refused on a
target with no arm" rows, and the version-provenance row.

### The four decisions, and what each was decided on

**1. Which namespaces can be answered: `Adw` and `Gtk`, and nothing else.** Those are the
namespace objects clause 2 puts on every renderer, and they are what a renderer HAS.
Measured, per `scripts/adwaita-elements.mjs`' own reader against gtk-host's GIR-derived
table (169 tags: 63 `adw-`, 106 `gtk-`):

| surface | `Adw` members | `Gtk` members |
|---|---:|---:|
| `@gjsify/adwaita-web` | 44 of 63 | 9 of 106 |
| `@gjsify/adwaita-nativescript` | 38 of 63 | 5 of 106 |

**A namespace with no renderer fails the BUILD, by name**, from `resolveId` — it does not
fall through to the empty module, which is the clause of § 6 this amendment refines in place.
The specifier carries the namespace, so nothing has to run for the answer to be knowable, and
the refusal prints what the arm does answer:

```
gjsify build --app browser: `gi://Gio?version=2.0` has no widget renderer. --gi-renderer
answers Adw (version 1), Gtk (version 4.0) out of @gjsify/adwaita-web and nothing else …
```

**Sparseness needed a second refusal at a second granularity.** § 6 called the browser `Gtk`
namespace sparse and said every absent member has to be a named refusal; the table above says
both namespaces are sparse on both surfaces. A property access is not knowable from a
specifier, so that one is a RUNTIME refusal — the emitted module wraps the renderer's
namespace in a `Proxy` whose `get` throws for any member it does not have, naming the member,
the renderer and the members it does have. Symbols and `then` pass through, because those are
protocol probes and refusing them breaks the module instead of reporting a missing widget.
Measured on `fixtures/absent-member.ts`, whose `AdwApplicationWindow` is a real libadwaita
widget neither renderer ships:

```
the Adw arm (version 1) on --app browser: @gjsify/adwaita-web has no ApplicationWindow. …
It has: AboutDialog, ActionRow, AlertDialog, Avatar, …
```

**2. `@girs/adw-1` is answered, through `emptyGirs: false`, exactly as § 6 said.** The arm
claims `gi://` at `resolveId` `pre` ahead of `gjsImportsEmptyPlugin`, and the flag flips
`emptyGirs` off on the same build, so `@girs/adw-1` resolves to its real body
(`import Adw from 'gi://Adw?version=1'; export default Adw;`) and its inner `gi://` lands on
the arm. Measured both ways: `typeof Adw.ActionRow` is `function` with the flag and
`undefined` without it, on both targets — no lowercased-package→namespace map anywhere.

The carve-out is not scoped to `@girs/adw-1`: with the flag on, EVERY `@girs/*` on that
target reaches its real body. Instrumented across the 53 `--app browser` test entries in this
repository, the only `@girs`/`gi://` specifier that reaches the empty-import plugin at all is
**`@girs/gjs`, 7 times**, whose body is `globalThis.imports || {}` — no typelib, no `gi://`,
harmless where it lands.

**3. The emitted module exports `default` and nothing else**, because that is what GJS's
`gi://` exports. Measured on gjs 1.88.1:

| spelling | GJS |
|---|---|
| `import Adw from 'gi://Adw?version=1'` | an object; `typeof Adw.ActionRow === 'function'` |
| `import * as Adw from 'gi://Adw?version=1'` | a namespace whose only key is `default` |
| `import { ActionRow } from 'gi://Adw?version=1'` | `SyntaxError: … doesn't provide an export named: 'ActionRow'` |
| `import Adw from 'gi://Adw?version=9'` | throws `Requiring Adw, version 9: Typelib file for namespace 'Adw', version '9' not found` |

So the bridge converts a NAMED export of the renderer barrel (`export * as Adw`) into the
DEFAULT export the specifier is imported with, and stops there. Emitting named members as
well would compile on these two targets and be a `SyntaxError` on `--app gjs` — a spelling
that works on two surfaces of three is the second vocabulary this ADR exists to remove.

The last row is why **a `?version=` that does not match is a build-time refusal**: GJS is loud
here, and a target that accepted `?version=2` would be the only place a wrong version passes.
The versions the arms answer are held against `@gjsify/gtk-host`'s `GENERATED_PROVENANCE`
(`Gtk-4.0/4.23.3 Adw-1/1.10.0`) by the suite's last row — a stamp written by a generator that
never reads the build layer, so a GIR bump moving `Adw-1` fails there rather than in a
consumer.

**4. Opt-in — and NOT because turning it on breaks things.** That was the hypothesis, and it
is wrong. Measured by forcing the arm on across every build in this repository that has one:

| population | builds | changed outcome with the arm on |
|---|---:|---:|
| `packages/*/*/src/test.browser.mts` (`--app browser`) | 53 | **0** (7 fail either way, on a pre-existing unbuilt dep in this checkout) |
| `packages/nativescript-bridge/*/src/index.ts` | 5 | **0** (1 fails either way, same cause) |

The instrumentation above explains it: no `gi://` reaches those builds at all, which is this
repository's own rule working (`tests/AGENTS.md`: a `gi://` in a browser bundle is a missing
alias). **That measurement bounds the blast radius here and says nothing about a consumer
tree**, where a transitively-imported `gi://GLib` would go from a silent stub to a build
failure.

What opt-in actually buys is stated without a breakage claim: the arm makes a **tier-2 widget
toolkit a build-time dependency of any bundle that names `gi://Adw`** — 133 B → 500 202 B and
214 041 B on the probe, and on NativeScript a `@nativescript/core` import clause the
flag-less bundle did not have — and nothing in a tree can infer that its `gi://Adw` was meant
to be `@gjsify/adwaita-web` rather than nothing. That is the same shape as `--dialect
react-native`, which is opt-in for the same reason and whose header says so. `config.ts`
refuses the flag on `--app gjs` and `--app node`, naming both arms, because a flag accepted
and ignored is the failure this repository keeps paying for.

### One constraint the implementation discovered

**The arm's diagnostics may not quote a `gi://` URL.** `tests/e2e/app-browser` and
`tests/e2e/ns-bridge-bundles` both assert `!bundle.includes('gi://')` — a SUBSTRING, because
on those targets an unresolved GI import is always a missing alias. The first version of the
runtime refusal quoted the specifier, and measured, that put one `gi://` occurrence into every
green bundle: a diagnostic string the guard cannot tell apart from the defect it watches for.
The refusal names namespace and version separately instead, and both green probe bundles carry
zero. The build-time refusals still quote the specifier — they are thrown, never emitted.

### What is deliberately left open

- **Nothing here runs on a browser engine or on NativeScript's V8.** `probe-runner.mjs` stubs
  a DOM and generates a `@nativescript/core` from the bundle's own import clause, so the suite
  proves the class exists, is subclassable, is the one the renderer registered, and — on the
  browser — constructs. It does not prove an `<adw-action-row>` lays out or that a
  `GridLayout` measures. `tests/browser/` and `tests/integration/nativescript/` are those
  venues; `ns-bridge-bundles` states the same limit for its own leg. The stub is admissible
  only because the flag-less control row, run under the SAME stub, still reports
  `Class extends value undefined`.
- **`new Adw.ActionRow()` is not asserted on NativeScript.** With a mechanically generated
  core the module LOADS and the class is a constructor, but construction reaches
  `GridLayout.addColumn`/`setColumn`, and a stub rich enough to answer those would be a
  reimplementation of NativeScript rather than a measurement of this arm.
- **The renderer is a fixed table, not a declaration.** `GI_RENDERERS` in
  `@gjsify/resolve-npm` names one renderer per target. A third-party surface cannot opt its
  own package in; whether it should is a question for the day one exists, and the answer is
  probably a `gjsify.widgetVocabulary` sub-key with a `manifest-conformance` rule behind it
  rather than a flag value.
- **The two snippets are still not the same text, and this stage did not rewrite them.** Read
  off `website/src/content/docs/adwaita/presentation.mdx` today, the `Adw.Avatar` block's
  `gjs` fragment opens `import Adw from 'gi://Adw?version=1'` and its `nativescript` fragment
  `import { Adw } from '@gjsify/adwaita-nativescript'`. The arm is what makes the first line
  legal on the second target; changing the published snippet is a separate move, because
  `check-generated-website-data` holds those fences verbatim against the showcase that
  compiles them. What remains after the import line is the construction — the `gjs` fragment
  passes a props object, the `nativescript` one assigns four properties afterwards, which is
  stage 8's optional construct-props bag and is not landed — plus a genuine capability gap
  the snippet already declares in a comment (`showInitials` / `iconName` have no NS
  equivalent). Convergence with a declared remainder, not a bijection.
