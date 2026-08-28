# 33. A widget tree is declared in a template file; TypeScript holds the behaviour

- Status: **Proposed**
- Date: 2026-08-28
- Deciders: Pascal Garber
- Related: [ADR 0027 (GTK host layer)](0027-gtk-host-layer.md), [ADR 0028 (widget table provenance)](0028-widget-table-provenance.md), [ADR 0032 (React Native on the GTK host)](0032-react-native-on-the-gtk-host.md)

## Context

Every runtime this project targets has a declarative form for a widget tree, and in
each of them the imperative form is also available and shorter to type:

| runtime | declarative | imperative |
|---|---|---|
| GTK / GJS | Blueprint `.blp`, compiled to a `GtkBuilder` template | `new Adw.Clamp({ child: … })` |
| NativeScript | XML markup, resolved through an `xmlns` module barrel | `new AdwWrapBox(); box.add(pill)` |
| Browser | `adw-*` custom elements in HTML | `document.createElement('adw-clamp')` |

The two forms are not equivalent in what they cost a reader. A template is a tree
written as a tree: nesting is nesting, a slot is where it appears, and the diff of a
layout change is the layout change. The same tree built imperatively is a sequence of
assignments whose SHAPE the reader has to reconstruct, and whose diff shows a
statement moving rather than a child moving.

`easy6502` is the worked reference and the reason this is worth writing down: 24
`.blp` files, and a consistent split beside each one. `packages/app-gnome/src/widgets/main-button.ts`
imports `./main-button.blp` as `Template`, registers with `GObject.registerClass({
GTypeName, Template, InternalChildren: […] })`, declares each internal child, and then
contains only behaviour. The markup contains no logic; the class contains no tree.

### Two measurements that shape the rule rather than merely support it

**The template root is constrained.** Measured on libadwaita 1.9.3 via `registerClass`:
`AdwHeaderBar`, `AdwToolbarView`, `AdwStatusPage`, `AdwNavigationView` and `AdwClamp`
are **final types** — subclassing them fails with *"Cannot inherit from a final type"*.
`AdwBin`, `AdwWindow`, `AdwApplicationWindow`, `AdwPreferencesGroup` and `AdwActionRow`
are not. So a template roots at a subclassable type and the widget it is about is that
root's child. `easy6502` does exactly this (`template $MainButton : Adw.Bin`), which is
why the pattern transfers rather than being one app's taste.

**A headless program must call `Adw.init()` itself.** `GtkBuilder` resolves
`Adw.HeaderBar` by GType *name*; without it the template build fails with
*"Invalid object type 'AdwHeaderBar'"* and internal children come back `null`.

## Decision

**A widget tree is declared in a template file. TypeScript holds the behaviour.**

This is the preferred form for application code, showcases, templates under
`templates/`, and every documentation example the website ships.

**Pure TypeScript is not forbidden.** It stays available and is sometimes right — a
tree whose shape is computed, a widget built from data, a single-element wrapper where
a template file would be pure ceremony, a runtime whose declarative form cannot express
what the code needs. What the rule asks is that the choice be a **choice**: where a
widget tree is built imperatively, the reason is written where the code is, in one
sentence. "It was quicker to type" is not one of the reasons; "the children come from a
`Gio.ListModel` whose length is not known until runtime" is.

The obligation is on the *reason*, not on a gate, because the honest cases are too
varied to enumerate and a checker that guessed would be refused for the same argument
this project refuses hand-maintained tables elsewhere.

## Consequences

- Documentation examples show the template and its loader side by side, the way the
  gallery's Vanilla TypeScript window already shows `.ts` beside `.blp`. Where a runtime
  has a declarative form, the example uses it.
- A reader comparing two runtimes compares two trees, not a tree against a script.
- `Adw.init()` and the final-type constraint above become part of what an example has to
  get right — which is a cost, and is why they are recorded here rather than rediscovered.
- **NativeScript's XML path: measured, and the row stays** — by a different mechanism than
  this ADR first wrote down, and only after a package fix. Android emulator, API 37,
  `@nativescript/core` 9.1.0-alpha.11, `@nativescript/vite` 8.0.0-alpha.57, 2026-08-28.

  `registerAdwaitaElements()` is not the way in. `typeof registerElement` is `undefined`
  in a plain NativeScript app — `@nativescript/core` 9.1 does not contain the identifier
  anywhere; it belongs to `@nativescript/angular` / `nativescript-vue` — so the function
  took its documented no-op branch and `<AdwSwitchRow>` resolved to nothing. What does
  work is NativeScript's own rule: a namespace is a MODULE, and the builder reads the
  element name off its exports. `xmlns:adw="~/adwaita"` over an app-local barrel resolves;
  `xmlns:adw="@gjsify/adwaita-nativescript"` does not.

  Resolving the class was only half. Every child then went through
  `LayoutBase._addChildFromBuilder`, which ignores the slot name and calls `addChild` —
  so a toolbar view's top bar and content were painted on top of each other in row 0, a
  header bar's buttons never reached `startBox`/`endBox`, a clamp's child left `child`
  null and clamped nothing, and preferences rows landed beside the boxed list rather than
  in it. All four rendered SOMETHING, which is why nothing caught them. Fixed in
  `@gjsify/adwaita-nativescript`; the four Layout widgets are now documented from
  templates that were rendered and screenshotted before they were written down.
