# @gjsify/gtk-host

The element model UI-framework renderers bind to, for GTK4 and libadwaita.

Vue, React, Solid and Angular each publish a contract for rendering into
something that is not the DOM. What none of them provides is the *something*:
an object model that can create a widget, set a property, adopt a child, and
navigate the result. That is this package.

```ts
import type Adw from '@girs/adw-1';
import { createElement, insert, materialize, registerBuiltinWidgets } from '@gjsify/gtk-host';

registerBuiltinWidgets();

const window = createElement('AdwApplicationWindow', { title: 'Hello' });
const box    = createElement('GtkBox', { orientation: 'vertical', spacing: 12 });
const button = createElement('GtkButton', { label: 'Press me' });

insert(box, window);
insert(button, box);
(materialize(window) as Adw.ApplicationWindow).present();
```

## Why a shared host

NativeScript carries five framework flavours over one host, and the adapters are
small because the host exists: its Solid adapter is **91 lines**, its React
adapter **505** — and both hold *zero* lines of widget knowledge. Under GTK4 the
shared share is larger still: GTK4 deleted `GtkContainer`, so there is no generic
`add`, and `Gtk.Buildable.add_child` is introspected as a vfunc only. Every
container's adoption rule has to be written down somewhere. Written once, it is a
table; written per adapter, it is the same table three times — which is what
stalled `react-gtk`, `react-native-gtk4` and `svelte-gjs`.

See [ADR 0027](../../../docs/adr/0027-gtk-host-layer.md) and
[ADR 0028](../../../docs/adr/0028-widget-table-provenance.md).

## What it refuses to do quietly

GTK's failure mode is exit 0, so this host is loud on purpose. Measured on
gjs 1.88.1:

| What you write | What GObject does | What this host does |
|---|---|---|
| `orientation: 'vertical'` | keeps `HORIZONTAL`; `set_property` logs `GLib-GObject-CRITICAL`, the JS setter says nothing at all | resolves the nick against the enum's GType |
| `orientation: 'sideways'` | same silence | throws, naming `GtkOrientation` |
| a read-only property | accepts the write, stores nothing | throws, naming the property |
| a misspelled property | nothing | throws, naming the widget |
| text inside `<GtkImage>` | nothing | throws, naming the tag and the fix |
| a child under a childless widget | `Gtk-WARNING` at exit 0 | throws, naming the three fixes |
| `selectable: 'false'` (a string) | JS truthiness makes it TRUE | honours `'true'`/`'false'`, throws on any other string |
| a string for a flags property | dropped silently | throws, naming the flags GType and asking for the numeric value |

## The node tree

Three node kinds — `element`, `text`, `anchor` — linked by the host's own
`parent`/`first`/`next`, never by `Gtk.Widget.get_parent()`. Text and anchors own
no widget, so GTK cannot answer navigation questions about them.

**Anchors never enter the GTK tree.** Vue's `createComment` and every
`v-if`/`<Show>` boundary becomes one, and insertion resolves forward past it to
the next node that owns a widget. An empty branch therefore cannot shift a
sibling's index.

**An element is `attached` only once GTK has taken it.** Owning a widget is not
the same fact: every framework materialises a subtree bottom-up, long before
inserting it. Placement reads `attached`, never `widget !== null` — deriving it
from the widget made the `remove-all` policy detach non-children and re-add
already-parented ones, at exit 0.

**Text has no node in GTK.** It goes to the owning widget's declared `textSink`
(`Gtk.Label:label`, `Gtk.Entry:text`, …). A widget without one rejects text by name.

## Child placement

Seven policy kinds, declared per widget as data and dispatched on the policy's
own `kind`. Descriptor lookup is by exact GType name; `mountRoot` is the one path
that walks the type hierarchy (`GObject.type_is_a`, via `nearestRegistered`), so
an application's own subclass resolves to its ancestor's rules:

| kind | example | how a child lands |
|---|---|---|
| `single` | `AdwBin`, `GtkWindow` | `set_child` / `set_content` |
| `ordered` | `GtkBox` | `append` + `insert_child_after` |
| `indexed` | `GtkListBox` | `insert(row, i)` — the parent addresses a **wrapper** row |
| `slotted` | `AdwHeaderBar` | `pack_start` / `pack_end` / `set_title_widget`, chosen by the child's `slot` |
| `keyed` | `GtkStack` | `add_titled(child, name, title)` |
| `coords` | `GtkGrid` | `attach(child, column, row, …)` |
| `none` | `GtkLabel` | rejected, with the three fixes named |

A container that cannot reorder in place declares it. `Adw.PreferencesGroup` has
`add` and `remove` and no `insert` — measured — so it declares
`reorder: 'remove-all'` and pays a tail re-append. The degradation is in the
table, not a surprise in an app. The re-append is ordered so a refusal costs
nothing: the new child is appended FIRST, then the tail is rotated — detaching the
tail first and failing on the append took already-rendered siblings with it.

Its sibling `Adw.PreferencesPage` looks identical and is not: `insert(group, i)`
exists there, so it uses `indexed` and reorders natively. Near-identical APIs with
opposite capabilities are exactly why the table is measured per widget rather than
inherited.

`slot` and `layout` are props the CHILD declares: `slot="end"` picks a `slotted`
attachment point, `layout={{ column, row, columnSpan, rowSpan }}` a `coords` cell,
`layout={{ name, title }}` a `keyed` page. Both are read at placement time, so
changing either RE-PLACES the child rather than doing nothing.

## Lifetime

`remove` detaches and is reversible, because frameworks move nodes. The wrapper
row an `indexed` parent demanded is handed back at the same time — it belongs to
that parent, and dragging a `GtkListBoxRow` into the next one would carry the
still-parented widget with it — so a re-insert gets a fresh row. Author your own
`<GtkListBoxRow>` when the row itself holds state. `destroy`
tears a subtree down: it disconnects every handler, unparents, drops the
reference, and closes a toplevel window (the one node unparenting cannot reach —
it has no parent and its `GtkApplication` still holds it). It is recursive, it is
eager, and it is the only place a handler is disconnected for good — a rebuild
disconnects and re-binds, a re-render replaces. GJS blocks JS callbacks during GC,
so **whatever is not disconnected here stays connected for the life of the
process**.

Construct-only properties cannot be patched; GObject accepts the write and keeps
the old value. Changing one **rebuilds** the widget in place, preserving position,
properties and listeners.

## Conformance

`@gjsify/gtk-host/conformance` exports the checks that keep the table honest and
the readers every vector asserts through:

- `descriptorProblems()` — every method and text sink a descriptor names must
  exist on that GType in the *installed* GTK.
- `gtkChildren()` / `gtkChildTypes()` / `dumpTree()` — read the **real** widget
  tree. A renderer that asserts against its own bookkeeping agrees with itself
  while the window is wrong.

## Adapters

Three of them today — `/solid`, `/vue`, `/react` — over one table.
`scripts/check-adapter-import-direction.mjs` holds all three to that mechanically:
an adapter that reaches for `descriptors`, `policies` or `registry` fails the check.

`@gjsify/gtk-host/solid` is the first, and it is the thesis made checkable: Solid
publishes a ten-method renderer contract, every one of them is a host op, and the
adapter is the mapping — no widget name, no insertion rule, no GTK knowledge.

```ts
import { For, createComponent, createElement, insert, mount, setProp } from '@gjsify/gtk-host/solid';

const dispose = mount(() => {
    const box = createElement('GtkBox');
    insert(box, createComponent(For, { get each() { return items(); }, children: renderRow }));
    return box;
}, myWindow);
```

`adopt(container)` is the mount seam every adapter needs: it wraps a widget the
application owns as a host element, resolving its descriptor through the same
table as every other parent, and **records the children the container already
had** so placement offsets past them. Without that record the first insertion
resolves to GTK's "make first" and the rendered tree lands above the app's own
chrome.

Three things the adapter has to know that the contract does not say:

- **`removeNode` is a detach, never a teardown.** Solid uses one op for a
  reconciliation move and for an unmount, and `<For>` moves the same nodes across a
  reorder (measured: 3 of 3 widget objects reused). Destroying there would recreate
  every row on every reorder.
- **The unmount signal is Solid's per-node scope, not `removeNode`** — but it may
  only disconnect HANDLERS, never unlink. A node dropped by reconciliation is
  unreachable from the root, so no later teardown can find its handlers, and GJS
  blocks JS callbacks during GC. `onCleanup` fires exactly when a node is gone for
  good and survives a reorder. Unlinking there breaks ordering, though: Solid
  disposes these scopes BEFORE `insertExpression` runs, and `reconcileArrays` opens
  with `getNextSibling(last)` — on an unlinked node that reads null, and every
  trailing insertion appends at the end of the parent instead of before the marker.
  A dynamic list with a static sibling after it rendered `head | foot | c`.
- **`solid-js/universal`'s `render` returns the disposer and nothing else** — the
  DOM renderer additionally clears its container, the universal one has no
  equivalent, so disposing tears down the reactive scopes and leaves the widgets
  mounted (measured: a button kept firing). Tearing the subtree down is `mount`'s job.

Solid's control-flow components (`For`, `Index`, `Show`) are re-exported re-typed:
their runtime is renderer-agnostic, their types are pinned to the DOM's `Element`.

**`Dynamic` is the exception and is implemented here, not re-exported.** `For`,
`Index` and `Show` live in `solid-js`; `Dynamic` lives in `solid-js/web`, and that
package *is* the DOM renderer — its string branch is
`document.createElement(component)` followed by the DOM's own `spread`, so under a
universal renderer nothing arrives through the host ops at all. Measured with
`<Dynamic component="GtkLabel">` imported from `solid-js/web` into a GJS bundle:
container `["GtkBox"]`, the box's children just the static sibling, **no throw, no
GTK diagnostic, exit 0**. (Importing it also makes `--globals auto` inject
`document`, `HTMLCanvasElement` and `Path2D` and pull `gi://Gdk`, `GdkPixbuf`,
`Pango` and `PangoCairo`.) Import `Dynamic` from `@gjsify/gtk-host/solid`; the
adapter's version takes the same `component` — a registered tag name or a
component function — and **refuses anything else by name**, where Solid's own
`switch` falls through to `undefined`: `component={registry[key]}` with a key that
missed is indistinguishable from an empty branch, and rendering nothing on purpose
is `<Show>`'s job.

That silence had a second, more general cause, now closed at the seam:
`insertExpression`'s last branch is `insertNode(parent, value)` for **any**
non-array object, and the host wrote its `parent`/`prev`/`next` links onto it and
returned — the kind was neither `element` nor `text`, so nothing else happened. A
phantom in the shadow tree that never reaches GTK. `insertNode` now refuses a
value that is not one of the three node kinds, naming what it got and which
`solid-js/web` exports (`Dynamic`, `Portal`, `template`) are DOM-bound.

`@gjsify/gtk-host/vue` is the second, and it is what makes "framework-agnostic"
a measured claim rather than an ADR sentence: the same descriptor table and the
same placement engine satisfy Vue's `RendererOptions` (10 required + 4 optional)
and Solid's universal renderer (10) without either knowing about the other.

```ts
import { mount } from '@gjsify/gtk-host/vue';
mount(defineComponent({ render: () => h('GtkBox', null, [h('GtkLabel', { label: 'hi' })]) }), myWindow);
```

Where Vue differs from Solid, and it is all in what Vue asks for:

- **`createComment`.** Vue marks every `v-if` branch and fragment boundary with
  one. That is why the host has anchors: they never enter the GTK tree, so an
  empty branch cannot shift a sibling's index.
- **`createElement` receives the vnode props**, so construct-only values arrive at
  construction instead of forcing a rebuild. Solid's `createElement(tag)` cannot.
  The props are RAW though — `key`, `ref` and the `onVnode*` hooks are Vue's own
  and are filtered out; passing them through produced
  `<GtkLabel> has no property "key"` on the first keyed list.
- **`remove` is a TEARDOWN here, not a detach** — the opposite of the Solid
  adapter, and measured both ways. Vue moves a node with `insert` alone, so
  `remove` is only ever a real unmount: with it mapped to `destroy`, a keyed
  reorder still reuses 3 of 3 widget objects and the handlers are gone after
  `app.unmount()`. Solid uses one op for both and must therefore detach.
- **`<KeepAlive>` and `<Suspense>` get a detached scratch container.**
  `KeepAliveImpl.setup` opens with `createElement("div")` for its off-screen
  storage and `SuspenseImpl` does the same for its `hiddenContainer`. Forwarded as
  a tag, `"div"` threw `unknown-tag` *inside `setup`* — and Vue routes that through
  `callWithErrorHandling`, whose production arm is `console.error(err)` with no
  rethrow. Measured under the defines below: `mount()` returned normally, the
  container had **zero** children, GTK emitted no diagnostic, exit 0, and the only
  trace was one line of `{"code":"unknown-tag","name":"GtkHostError"}`.

  The adapter hands those calls an unparented box through `adopt`, which is the
  faithful analogue of the DOM's detached `<div>`: deactivating really unparents
  the subtree and really keeps it alive, so reactivating moves the *same* widgets
  back. Measured end to end — a `<KeepAlive>`d component's widget object and its
  own `ref` state both survive a toggle away and back.

  **The discriminator is ARITY, and it had to be measured.** `mountElement` calls
  `hostCreateElement(vnode.type, namespace, props && props.is, props)` — four
  arguments, always; the two built-ins call `createElement("div")` with one.
  Testing the later parameters for `undefined` cannot separate them, because
  `ElementNamespace` *is* `'svg' | 'mathml' | undefined` and a plain GTK element
  gets `undefined` there too. So a user's own `<div>` still arrives with four
  arguments and is still refused by name — the scratch container is never a
  silent yes for something a user wrote.
- **`cloneNode` and `insertStaticContent` throw.** They back Vue's static hoisting,
  and the second one takes an HTML *string*. Compile with `hoistStatic: false` and
  `transformHoist: null`; if that is ever lost, these throw at the first static
  subtree instead of rendering something wrong.
- **`<Teleport :to="el">` takes a widget the application owns**, and the adapter
  adopts it — once per widget, so every teleported child and both of Vue's own text
  anchors see the same shadow tree. Adopting per `insert` call re-snapshots the
  container's existing children each time and reorders the teleport: measured,
  `['one','two','three']` landed as `['one','three','two']`. `adopt` is re-exported
  from `@gjsify/gtk-host/vue` for the explicit spelling, `:to="adopt(el)"`.

  The coercion is what makes that sentence TRUE. Vue returns a non-string target
  verbatim (`resolveTarget`'s non-string branch is `return targetSelector`), so
  "pass the target widget instead" — which this adapter's own error message and
  this README used to say — handed the host a raw `Gtk.Box` as a parent: nothing
  rendered, nothing threw, no diagnostic. The host now refuses a raw widget by
  name (`not-a-host-parent`) as the backstop for every other route in.
- **A *string* teleport target throws.** Answering null looks gentler and is worse:
  `TeleportImpl` mounts nothing for a falsy target and the warning is `__DEV__`-only,
  which the production defines below strip — so it would render nothing, silently,
  in exactly the configuration this adapter prescribes. Resolving a name would need
  a registry of mounted roots; when a consumer needs it, that is the work.
- **A prop that disappears is reset, not nulled.** Vue signals removal with `null`;
  the host's contract is `undefined` → the ParamSpec default. Forwarding the `null`
  reached `set_property` verbatim, which throws for an int property — and
  `el.props` had already recorded it for the next rebuild to replay.

**Build recipe.** `@vue/runtime-core` is DOM-free in fact — every `document`,
`navigator`, `location` and `HTMLElement` reference sits in a dev/HMR/devtools
path behind `typeof window !== 'undefined'` or `__DEV__`. But `--globals auto` is a
static analysis and injects a polyfill for each identifier it sees, which made the
bundle require `gi://Gdk`, `GdkPixbuf`, `Pango` and `PangoCairo` at load. Define
Vue's flags so dead-code elimination removes those branches:

```
--define '__VUE_OPTIONS_API__=false'
--define '__VUE_PROD_DEVTOOLS__=false'
--define '__VUE_PROD_HYDRATION_MISMATCH_DETAILS__=false'
--define 'process.env.NODE_ENV="production"'
```

A vector asserts `globalThis.document` is `undefined`, so losing the recipe fails
the suite rather than silently growing four typelib dependencies.

**`Suspense` is the one import the recipe cannot save**, so measure the bundle if
you use it. `SuspenseImpl` carries `hydrate: hydrateSuspense`, and that function
contains a literal `document.createElement("div")` which no define eliminates —
hydration is not dead code, it is simply never called here. Measured, same entry
plus one named import, `--app gjs` with the four defines above:

| import | bytes | typelibs | DOM |
|---|---|---|---|
| baseline (`createRenderer`) | 191 032 | `gi://GLib` | — |
| `+ Teleport` | 194 907 | `gi://GLib` | — |
| `+ KeepAlive` | 197 561 | `gi://GLib` | — |
| `+ Suspense` | 274 177 | `+ Gdk, GdkPixbuf, Gio, Pango, PangoCairo` | `HTMLCanvasElement`, `Path2D` |
| `+ Suspense`, `--exclude-globals document` | 196 614 | `gi://GLib` | — |

`--exclude-globals document` is the escape: `--globals auto` is a static scan, so
the identifier is what it reacts to, not whether the branch can run. Three more
built-ins measured clean alongside `Teleport` and `KeepAlive` — `BaseTransition`
(192–197 KB, `gi://GLib` only), `defineAsyncComponent` and `Fragment`. `Transition`
is not in this table because `@vue/runtime-core` does not export it at all
(`MISSING_EXPORT` from rolldown); it belongs to `runtime-dom`.

`@gjsify/gtk-host/react` is the third, and it is the one whose contract can be
READ instead of restated. `react-reconciler` is `module.exports = function
$$$reconciler($$$hostConfig) { … }` and its body opens by destructuring the whole
config, so a recording `Proxy` over the config reports exactly which members the
installed version asks for. Measured on **0.29.2**, production bundle: **76**
members read, **37** answered here, **39** switched off by three flags the config
does declare (`supportsPersistence: false`, `supportsHydration: false`,
`supportsTestSelectors` absent) plus `supportsMicrotasks`, and 4 more declared for
the development bundle, which reads 94. `react.spec.ts` asserts all three
directions, so a version bump that starts asking for something new fails a test
instead of reading `undefined` inside a commit.

```ts
import { createRoot, flushSync } from '@gjsify/gtk-host/react';

const root = createRoot(myWindow);
root.render(createElement('GtkBox', null, createElement('GtkLabel', { label: 'hi' })));
```

- **`render()` is synchronous, and that is a choice with a reason.** A
  `ConcurrentRoot`'s updates are DEFAULT-lane, so they are handed to `scheduler`,
  which under GJS is a GLib timer source — with no main loop running yet, an
  unflushed first render leaves the container empty and says nothing. `render()`
  therefore wraps `updateContainer` in `flushSync`, which sets the current update
  priority to `DiscreteEventPriority` and makes everything scheduled inside it a
  sync lane the same call then flushes.
- **A `setState` from a GTK signal handler is concurrent** and lands on the next
  main-loop iteration, because `getCurrentEventPriority` returns the default lane
  (there is no ambient DOM event to derive a priority from). `flushSync` is the
  escape hatch. A vector pumps `GLib.MainContext.default()` and proves the
  scheduled path works at all under GJS — it does, on gjs 1.88.1, with no
  polyfill: `scheduler` feature-detects `performance`, `setImmediate`,
  `MessageChannel` and `navigator` and falls back to `setTimeout`, which the GJS
  prologue already provides.
- **React CLEARS the container before its first commit.** `updateHostRoot` sets
  the `Snapshot` flag whenever the previous render produced no child — in the DOM
  to discard leftover markup. Here the container is a widget the application built
  and filled, so `clearContainer` destroys only the SHADOW children and never
  `el.foreign`. A vector records the call, because surviving chrome alone would
  also be explained by React never making it.
- **`removeChild` is a TEARDOWN, like Vue's `remove` and unlike Solid's
  `removeNode`.** React moves a node with `insertBefore`/`appendChild` alone, so
  `removeChild` is only ever a real unmount. The reorder vector holds both halves:
  the same widget objects survive, and `removeChild` was never reached.
- **`getPublicInstance` IS `ref`,** and it returns the author's widget — never the
  `GtkListBoxRow` the host wrapped it in.
- **`shouldSetTextContent` answers `false`, always.** `true` would leave the string
  in `props.children` for the adapter to write, which is a widget-knowledge test in
  an adapter; the host already routes a text node to the descriptor's `textSink` and
  refuses text by tag name where there is none.
- **`<Suspense>`'s `hideTextInstance` empties the run's contribution** to its
  parent's sink — a text run owns no widget — and nothing has to be remembered,
  because `unhideTextInstance` is handed the text back.

**Build recipe**, and it is not optional:

```
--define 'process.env.NODE_ENV="production"'
--exclude-globals navigator
```

`react-reconciler/index.js` picks its bundle from `process.env.NODE_ENV`, and the
development one reaches for `document`, `HTMLCanvasElement` and `Path2D`, which
makes `--globals auto` inject the GTK-backed DOM registers and pull `gi://Gdk`,
`GdkPixbuf`, `Pango` and `PangoCairo` into a bundle that needs none of them. Even
the production `scheduler` carries `typeof navigator !== 'undefined' &&
navigator.scheduling`, dead code under GJS but still a free identifier the
detector answers with the same register. With both flags the bundle loads with no
`document` and no `navigator`, and a vector asserts exactly that.

`react` and `react-reconciler` are OPTIONAL peer dependencies, like `solid-js` and
`@vue/runtime-core`.

## The widget table, and the type surfaces

The table is **generated from the GIR** and committed. 164 concrete GtkWidget
descendants (Gtk 102, Adw 62), each with its GType name, its kebab tag and a lazy
`ctor`; 26 of them also carry a **curated** placement rule, and the generator may
only ever ADD a tag, never contradict one. A tag with no curated rule gets
`children: { kind: 'uncurated' }` — the widget can be created, given properties and
given handlers, while inserting a child raises an error naming the tag that needs a
policy. Guessing is not on offer: `add`, `append` and `set_child` all exist
somewhere in GTK, and calling the wrong one is a warning at exit 0.

Regenerating is a maintainer step, because the GIR files are not in this repo:

```sh
GJSIFY_GIR_DIR=/path/to/girs npm run generate   # then look at git diff
```

A fresh clone needs no GIR to build, check, pack or test. What travels instead is
`generated.spec.ts`, which asks the *installed* GTK whether every generated name is
real: every offered property present as a writable ParamSpec, every offered signal
resolvable by `GObject.signal_lookup`, every enum nick resolvable through the
host's own `coerce()` path. A member the installed library lacks is accepted only
if the GIR says it arrived in a newer release — `GtkApplicationWindow::save-state`
is GTK 4.24 and the check runs on 4.22.4.

### Solid / JSX

```jsonc
{
    "jsx": "preserve",                            // babel-preset-solid does the transform
    "jsxImportSource": "@gjsify/gtk-host",         // TypeScript appends /jsx-runtime
    "noImplicitAny": true                          // load-bearing, see below
}
```

```tsx
<gtk-box orientation="vertical" spacing={8}>
    <gtk-label label="Hello" />
    <gtk-button label="Go" onClicked={() => count(count() + 1)} />
</gtk-box>
```

Tags are kebab because a capitalised `JSX.IntrinsicElements` key is never
consulted — `<GtkBox/>` is `TS2304: Cannot find name 'GtkBox'`. This package ships
its **own** jsx-runtime rather than augmenting `solid-js`, which would leave all
208 tags Solid pre-declares (HTML, SVG, MathML) type-checking clean on a GTK
renderer and rendering nothing.

Two things worth knowing:

- **`noImplicitAny: true` is not optional.** With `jsx: "preserve"`, no
  `jsxImportSource` and `noImplicitAny` off, every JSX element is implicitly `any`
  and `tsc` exits 0 having checked nothing.
- **An unknown *hyphenated* prop cannot be refused.** TypeScript exempts every
  hyphen-containing JSX attribute from excess-property checking, so
  `<gtk-box no-such={1}/>` is accepted. Both spellings are generated, so a declared
  `can-focus={'yes'}` still fails on its VALUE — but prefer `canFocus`, which is
  checked both ways.

### Vue

```ts
import '@gjsify/gtk-host/vue-components';
```

```jsonc
{ "vueCompilerOptions": { "strictTemplates": true } }
```

```vue
<GtkBox orientation="vertical" :spacing="8">
    <GtkButton label="Go" @clicked="go" />
</GtkBox>
```

Keys are GType names, because Volar camelizes and capitalises a template tag before
looking it up — so one `GtkBox` key answers both `<GtkBox>` and `<gtk-box>`.
`strictTemplates: true` is **required**: without it an unknown prop, an unknown
event and an entirely unresolved tag are all silently accepted while wrong VALUE
types still error, so the surface looks alive and checks the wrong half.

**Set it in the BASE of your `extends` chain.** Measured on `vue-tsc@3.3.11`, all
four cells: the base tsconfig's value wins and the child's is ignored outright — a
strict base stays strict under a child that sets `false`, and a lax base stays lax
under a child that sets `true`. In a monorepo the shared base config therefore
decides this for every package and a per-package override does nothing. Confirm
with `vue-tsc --showConfig` rather than by reading the nearest tsconfig.

That camelize has no acronym knowledge (`gtk-gl-area` → `GtkGlArea`), so widgets
with two adjacent capitals get an extra kebab key. The generator finds them by
rule; today there is exactly one, `GtkGLArea`.

### React / JSX

```jsonc
{
    "jsx": "react-jsx",
    "jsxImportSource": "@gjsify/gtk-host/react",   // TypeScript appends /jsx-runtime
    "noImplicitAny": true
}
```

A **separate subpath**, and the split is structural rather than stylistic.
`@gjsify/gtk-host/jsx-runtime` deliberately throws from `jsx()`/`jsxs()`, which is
right for the dialects it serves: Solid's reactivity lives in what
`babel-preset-solid` emits and Vue's in its SFC compiler, so an automatic runtime
reaching those functions means the pipeline was misconfigured and nothing would
render. React is the opposite case — its `jsx()` builds a plain, renderer-agnostic
element record and the host mapping happens later, in `react-reconciler` — so
`@gjsify/gtk-host/react/jsx-runtime` re-exports React's OWN factories and declares
its own `JSX` namespace over the same generated tag list. One module cannot both
refuse the automatic runtime and provide it; `jsxImportSource` picks.

Pointing `jsxImportSource` at `"react"` instead is the 208-tag trap: the element
list then comes from `@types/react`, and every HTML, SVG and MathML tag
type-checks clean on a GTK renderer and renders nothing.

Tags are kebab here too, for the same measured reason as the Solid surface. `ref`
takes React's `Ref<T>` (a callback *or* a `useRef` object), which is why it is not
the Solid surface's `ref` type.

**The export names are the framework's contract, not a style choice** — the same
lesson the Solid adapter paid for when its `setProp` was exported as
`setSolidProp` and `babel-plugin-jsx-dom-expressions` emitted
`import { setProp }` literally. TypeScript's automatic runtime emits `jsx`, `jsxs`
and `Fragment` from `<jsxImportSource>/jsx-runtime`, and `jsxDEV` from
`<jsxImportSource>/jsx-dev-runtime`; those four are exactly what this module
exports, so a rename here is a `MISSING_EXPORT` in a consumer's build rather than
a matter of taste.
