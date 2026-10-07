# 96. A GObject subset runs on the browser and NativeScript, measured by the gap report

- Status: **Accepted** (2026-10-07)
- Date: 2026-10-07
- Deciders: Pascal Garber
- Related: [ADR 0033 (declarative templates)](0033-declarative-templates-preferred.md),
  [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md) § Amendments 13–15,
  [ADR 0051 (one authored tree, rendered)](0051-one-authored-tree-rendered.md),
  [ADR 0070 (a second specifier)](0070-a-blp-reaches-a-renderer-through-a-second-specifier.md),
  [ADR 0088 (typed ids)](0088-a-blp-exports-its-ids-as-typed-names.md),
  [ADR 0093 (template constructs per renderer)](0093-template-constructs-are-carried-and-each-renderer-declares-what-it-builds.md)
- Completes: the "NOT done" items of ADR 0093 Progress rows 3 and 4 (the scope defaulting to the
  template instance, a `template` bind source, the bind flags). Extends ADR 0070 § 1 by one exit.

## Context

`--gi-renderer` resolves `gi://Adw` and `gi://Gtk` to `@gjsify/adwaita-web` on `--app browser`
and to `@gjsify/adwaita-nativescript` on `--app nativescript` (`GI_RENDERERS`,
`packages/infra/resolve-npm/lib/gi-renderers.mjs`). A GNOME component class does not stop there.
It is written like this:

```ts
import GObject from 'gi://GObject';
import Adw from 'gi://Adw';
import Template from './hexdump.blp';

export class Hexdump extends Adw.Bin {
    declare _copyButton: Gtk.Button;
    constructor(params?: Partial<Adw.Bin.ConstructorProps>) {
        super(params);
        this._copyButton.connect('clicked', () => this.copy());
    }
}
GObject.type_ensure(Hexdump.$gtype);
GObject.registerClass({ GTypeName: 'Hexdump', Template, InternalChildren: ['copyButton'],
    Properties: { code: GObject.ParamSpec.string('code', '', '', GObject.ParamFlags.READWRITE, '') } },
    Hexdump);
```

`gi://GObject` resolves to an empty module on both targets, so `GObject.registerClass` is
`undefined`, and nothing installs `this._copyButton`. Learn6502 therefore keeps a hand-written web
copy and a hand-written Android copy of each of its templated components. ADR 0051 exists to
remove exactly that second source.

**What a component class needs from GObject is measured, not assumed.**
`node scripts/report-target-gap.mjs <project-dir>` lists every `gi://` member a project uses at run
time, separated from type-only uses. For Learn6502 the `GObject` members are `registerClass`,
`ParamSpec`, `ParamFlags`, `type_ensure`, `TYPE_STRING`, `signal_stop_emission_by_name` and
`Value`; the counts are in the report's output. The report cannot see instance methods, so these
were read from the source: `this.notify(…)`, `connect('notify::…')` on `this`, `emit(…)` for the
class's own `Signals`, and `vfunc_*` overrides. `bind_property` is not called in Learn6502;
`bind` in its templates is.

What the two ports have already (ADR 0093 Progress):

- `registerTemplateClass(name, …)` on both, so a `$Name` in a `.blp` resolves to an application
  class. The web stores a custom-element TAG, NativeScript a constructor.
- Signal and notify declarations per widget class (`static signals` on the web, `static
  emittedSignals` on NativeScript), which the builders check before they connect a handler or a
  `bind`.
- A `connect`/`disconnect` door on every NativeScript widget (`withSignals`, ADR 0034 § Amendment
  14). The web elements use `addEventListener` and have no `connect`.
- A `scope` option for handlers, required: it does not default to the template instance.
- A refusal of `bind template.x` and of every bind flag.

What a widget class IS on each port decides most of the design:

- **Web:** `Adw.Bin` is `AdwBin extends HTMLElement`. A subclass is legal, but it must be
  `customElements.define`d under its own tag before `new`, and a custom element's constructor must
  not give it children or attributes when the parser or `createElement` creates it.
- **NativeScript:** `Adw.Bin` is a `@nativescript/core` `View` subclass. `new` works, and its
  constructor applies a construct bag that throws on an unknown key (ADR 0034 § Amendment 13).

## Decision

**Each port exports a `GObject` namespace, routed by `GI_RENDERERS`, whose `registerClass` makes
an unmodified GNOME component class work: it builds the class's `.blp` template, installs the
internal children, and gives the class GObject properties, signals and `notify`. The behaviour
lives once, in `@gjsify/adwaita-core`; each port supplies only the door to its widget model. The
subset is what the gap report lists, and nothing it does not list.**

### 1. Where it lives

- `@gjsify/adwaita-core` gains a renderer-free GObject core: a per-instance property store with
  `notify`, a signal registry with `connect`/`disconnect`/`emit`, the binding engine with GObject's
  flag semantics, and the meta-object reader for `registerClass`. It reaches no DOM and no
  `@nativescript/core`, as the rest of `adwaita-core` does not.
- Each port exports `src/namespace/gobject.ts`, the way it exports `adw.ts` and `gtk.ts`, and
  implements one interface over its widget model: how to dispatch and listen for a named event,
  how to create a widget from a tree, and how to attach the built children to the host.
- `GI_RENDERERS` gains `GObject: '2.0'` on both rows. `tests/e2e/gi-renderer-arms` gains the
  arm for it.

### 2. The subset

| GJS spelling | on the browser and NativeScript |
|---|---|
| `GObject.registerClass(meta, klass)` with `GTypeName`, `Template`, `InternalChildren`, `Properties`, `Signals`, `CssName` | implemented. Any other meta key (`Children`, `Implements`, `Requires`, `GTypeFlags`) is refused by name at registration |
| the same keys as static class fields (`static [GObject.GTypeName] = …`, `GObject.properties`, …) | implemented. GJS's `registerClass` only copies the meta object onto these symbols, so they are the internal form here too, and a class written in the field form does not silently lose its keys to `static [undefined]` |
| `GObject.ParamSpec.{boolean,string,int,uint,double}`, `GObject.ParamFlags.{READABLE,WRITABLE,READWRITE,CONSTRUCT}` | implemented, by GJS's rule (`_checkAccessors` / `_generateAccessors` in `modules/core/_common.js`): accessors the class defines are kept; a missing pair is generated, returning the ParamSpec default until set and calling `notify` only when the new value is `!==` the stored one — and the slot starts unset, so the FIRST assignment notifies even when it equals the default, as on GJS; a dashed name is reachable as `dash-name`, `dash_name` and `dashName`. A JS assignment is not range-checked, on GJS either |
| `Signals: { name: { param_types } }`, `GObject.TYPE_{STRING,BOOLEAN,INT,UINT,DOUBLE}` | implemented. A param type outside that list is refused at registration |
| `this.notify(name)`, `connect`/`disconnect`/`emit` on a registered instance, `connect('notify::x')` | implemented, for the class's own properties and signals and for those of the port widget it extends |
| `GObject.type_ensure(klass.$gtype)` | implemented: `$gtype` is an opaque token, and `type_ensure` only proves the class module was evaluated, which is all Learn6502 uses it for |
| `vfunc_*` | refused at registration, naming the method. A port that drives one (a candidate is `map`/`unmap`) flips that method in its own PR, with a vector |
| `GObject.Value`, `signal_stop_emission_by_name` | out of this subset. Both appear only beside clipboard and GtkSource code, which have their own decisions (ADR 0094; the clipboard as `navigator.clipboard`) |

The binding engine implements `SYNC_CREATE`, `BIDIRECTIONAL` and `INVERT_BOOLEAN`, because the
template builders need them. The public `bind_property` method is not exported until a consumer
calls it; when one does, it is one export over the same engine.

Bound on the scope: a member enters the subset when the gap report lists it for a project that
is being converted, together with a vector. "GObject would have it" is not a reason.

### 3. What `registerClass` does

1. Reads the meta object and refuses what § 2 does not list, by name.
2. Installs the property accessors and the signal declarations on the class, and writes them into
   the declaration the builders already read (`static signals` / `static emittedSignals`): one
   `notify::<prop>` per property and one entry per signal. A `bind` on a registered class's
   property, and a handler on its signal, are then accepted by the builders with no second list.
3. Registers the class for `$GTypeName` in templates through the port's existing
   `registerTemplateClass`. On the web it first defines the custom element under a tag derived from
   `GTypeName` (`Hexdump` → `gjsify-hexdump`) and refuses a collision by name. `registerTemplateClass`
   stays the primitive for code that is not a GObject class; an application that uses
   `registerClass` never calls it.
4. Wraps construction in GJS's order (`Gtk.Widget.prototype._init` and `_registerWidgetType` in
   `modules/core/overrides/Gtk.js`): the template is built first (GTK's `init_template` runs in
   instance init), then the construct properties are set, and only when that returns is each id in
   `InternalChildren` installed as `this._<id>`, with `-` replaced by `_`. So `this._x` exists after
   `super(params)` and is `undefined` inside a property setter run during construction, on GJS
   and here alike; the GJS driver of the vectors pins that order. Declared properties are taken
   out of `params` before they reach the port's construct bag, so the NativeScript bag does not
   refuse them; the rest goes through unchanged.
5. Sets the template's handler scope and its `template` bind source to the instance. A handler is
   looked up on the instance and bound to the `object:` of the signal if it names one, else to the
   instance; a missing handler throws `A handler called <name> was not defined on <instance>`, and
   `swapped` is refused, both with `_createClosure`'s message. On GJS that throw is caught by
   GtkBuilder and only logged as a `Gtk-CRITICAL`, and construction goes on; the ports let it
   propagate, because a handler that silently never runs is the drop ADR 0071 § 3 forbids. Bind
   flags go through the binding engine.

Refusals are the subset's own claims. GJS accepts every meta key and `vfunc_*`, so a vector that
asserts a refusal is marked as holding on the subset only and is not run on the oracle; every
other vector must hold on GJS.

On the web, the built children are attached to the host on its first `connectedCallback`, not in
the constructor, because the custom-element rules forbid children there. They exist and are
connected to their handlers from the constructor on, so `this._x.connect(…)` in the constructor
works. Whether `notify` on a not-yet-connected element reaches its bindings is UNVERIFIED (ADR 0093
Progress row 4 names the gap); the implementing PR measures it and closes it in the core, not per
element.

### 4. The template import gets an exit of its own

`registerClass` on GJS takes the GtkBuilder XML string that `import Template from './x.blp'`
gives. The ports build from the projected tree. ADR 0070 § 1 forbids letting one specifier mean a
string on one target and an object on another. So the template gets its own exit:

```ts
import Template from './hexdump.blp?template';
```

- On `--app gjs` it is the XML string, as `./x.blp` is today.
- Under `--gi-renderer` it is the projected tree, and the build runs ADR 0093's capability check
  against the renderer `GI_RENDERERS` names for the target. The import site therefore needs no
  `for=`, and a construct the port refuses fails the BUILD, naming the file and line.
- Its type is an opaque `BlueprintTemplate` that only `registerClass` accepts. Application code
  cannot read it, so it cannot depend on what it is on one target.

GJS's `registerClass` also takes a `resource://` or `file://` URI and raw bytes as `Template`.
Those, and a `.ui` file imported as XML, stay GJS-only: the ports refuse a `Template` that is not
a `?template` value, naming the class.

Converting a component means changing this one import line. The GNOME app keeps working with it,
because on GJS the value is the same string.

### 5. Proof

- `@gjsify/adwaita-core/conformance` gains `GOBJECT_VECTORS`: per row of § 2, a class, a `.blp`,
  and what must be observable (a property notifies once per change, a bidirectional bind follows
  both ways, a handler on the template instance runs, a refused key throws naming it).
- The vectors run on THREE drivers: the web, NativeScript, and real GJS. GJS is the oracle: a
  vector that does not hold on GJS is a wrong vector, not a port bug. This is what keeps the
  subset GObject's semantics instead of a look-alike.
- The gate is the one ADR 0093 § 4 built: a claim needs a vector, a refusal must throw.
- `tests/e2e/gi-renderer-arms` builds one class (template, property, signal, `bind template.x
  bidirectional`) with `--app browser` and `--app nativescript` from the same source.

## Consequences

- One component class, unchanged except for `?template`, runs on three targets. The
  hand-written web and Android copies, and the controller and interface layer in Learn6502's
  `common-ui` that exists to keep them in step, can be deleted component by component.
- `registerTemplateClass` and `registerClass` do not become two class models: the second calls the
  first, and an application uses only the second.
- `adwaita-core` grows a GObject core. Its size is held by the report: a member nobody uses is
  not built.
- The web defines one custom element per registered class. Its tag is derived and never written
  by hand, so a `.blp` names the class only by `$GTypeName`, as on GJS.
- Widget instance methods (`add_css_class`, `get_first_child`, `set_visible`, …) are not GObject
  and are not decided here; they are ADR 0034's vocabulary. The report does not see them yet,
  which is a known blind spot of the measurement.

## Alternatives rejected

- **Translate the GNOME class into a web component and a NativeScript view at build time.** A
  translator between models is what ADR 0051 refuses; it hides what it cannot translate.
- **A full GObject on both ports** (type system, interfaces, `GValue`, closures). An own runtime
  for the few members a component needs, and the risk this ADR is bounded against.
- **Keep `registerTemplateClass` as the application API and write the class body twice.** That is
  today's second source with fewer lines.
- **Overload `./x.blp` per target.** ADR 0070 § 1's reason stands: one specifier, two meanings,
  chosen by a flag the file cannot see.
- **Implement the subset in each port.** The two ports drifted exactly where behaviour was written
  twice; the core plus a door per port is the shape `AdwBreakpointBin` already proved (ADR 0093 §
  3, `breakpoint`).

## What this does not decide

- `Gio` (actions, settings, files), `GLib` timers and `Gdk` (clipboard, display): each its own
  step, by the interface order of the "one codebase" priority (web standard, then `gi://` port,
  then capability package).
- `Adw.Application` and `vfunc_activate`: the application object stays the per-target entry
  point until the single app package is decided.
- iOS: the NativeScript cells are reasoned for Android, as in ADR 0093.

## Implementation

Tracked in `status/open-todos/adwaita-core.md`. One PR, a commit per step: the core with its GJS
vectors (the oracle first); the NativeScript door; the web door; the `?template` exit with the
build-time check; the `GI_RENDERERS` row and the e2e arm. The first consumer is one Learn6502
component, converted in its own repository once a release carries this.
