# react-host-counter

The [`adw-host-counter`](../adw-host-counter) window a **fourth** time — written as React JSX and
rendered by a real `react-reconciler` over [`@gjsify/gtk-host/react`](../../../packages/framework/gtk-host).
Same widgets, same assertions: one showcase imperative through the host ops, one through Solid's
JSX compiler ([`solid-host-counter`](../solid-host-counter)), one through `@vue/compiler-sfc`
([`vue-host-counter`](../vue-host-counter)), and this one through React's automatic JSX runtime.
Four contracts over one host is what makes "framework-agnostic" a measurement instead of a
decision — and the four report the same tree size and the same widget order, which is the point of
keeping them identical.

```bash
gjsify run build:gjs && gjsify run start:gjs   # the window
gjsify run probe                               # the assertions, headless
gjsify run check                               # tsc over the JSX
```

## What only this showcase proves

React was the one adapter with **no end-to-end evidence**. `src/adapters/react.spec.ts` drives the
reconciler through `createElement` calls, and `scripts/check-type-surfaces.mjs` gates the element
list — but nothing in the repository compiled a line of React JSX, and nothing ran a React tree
inside a `GApplication`. Three things only this file reaches:

- **The automatic runtime.** Unlike both siblings, this build does not preserve JSX for a framework
  compiler: `jsx: "react-jsx"` + `jsxImportSource: "@gjsify/gtk-host/react"` makes oxc emit
  `import { jsx } from "@gjsify/gtk-host/react/jsx-runtime"`, and that subpath re-exports React's
  own `jsx`/`jsxs`/`Fragment`. There is no plugin under `gjsify.bundler.plugins` here and nothing
  for one to consume. The export **names** are the framework's contract — TypeScript emits those
  three literally, so a rename there is a `MISSING_EXPORT` in this bundle.
- **The scheduled lane, under GJS, in an application.** `resolveUpdatePriority` returns the
  DEFAULT lane, so a `setState` from a `clicked` handler is concurrent: it is handed to
  `scheduler`, which under GJS lands on a GLib timer source. The probe asserts **both** halves —
  the tree is unchanged the instant the signal returns, and it is patched once the main context
  runs. Measured: wrapping the `emit('clicked')` in `flushSync` turns the first of those red, which
  is what makes it an assertion about the lane rather than about the handler.
- **React's own `ref` spelling.** The React surface types `ref` as `Ref<T>` — a callback *or* a
  `useRef`/`createRef` object — which is why it does not reuse the Solid surface's `ref` type. The
  probe holds a `createRef` and asserts the widget it receives is **identical** to the one found by
  walking the real GTK tree; `getPublicInstance` returning something plausible is not the claim.

## The window is the application's, the content is React's

Same structural split as the Vue sibling, and for the same reason rather than by imitation:
`createRoot(container)` renders *into* a widget, and a toplevel window is not a child of anything.
An `adw-application-window` at the root of the tree would ask GTK to parent a toplevel and earn a
`Gtk-WARNING` at exit 0. So the application owns the window and `adopt`s it, and the component's
`adw-toolbar-view` lands through `Adw.ApplicationWindow.set_content()` — the `single` placement
policy the descriptor table declares for that GType.

## Build recipe, and it is not optional

```
--define 'process.env.NODE_ENV="production"'   --exclude-globals navigator
```

`react-reconciler/index.js` picks its bundle from `process.env.NODE_ENV`, and the development one
reaches for `document`, `HTMLCanvasElement` and `Path2D` — which makes `--globals auto` inject the
GTK-backed DOM registers and pull `gi://Gdk`, `GdkPixbuf`, `Pango` and `PangoCairo` into a bundle
that needs none of them. Even the production `scheduler` carries
`typeof navigator !== 'undefined' && navigator.scheduling`, dead code under GJS but still a free
identifier the detector answers with the same register. Two probe assertions hold the recipe: no
`document` and no `navigator` exist at runtime.

## The probe

`runHostProbeApp` from `@gjsify/gtk-host` owns the harness — the env gate, the diagnostics
collector, the `check()` recorder, the `PROBE: PASS|FAIL <json>` protocol, the `app.hold()`
discipline and the rule that the GUI path runs the same assertions before presenting.

`GJSIFY_HOST_PROBE=1` builds the tree headlessly, asserts it against the **real** widget tree
(`get_first_child`/`get_next_sibling` and the exact getters, never the host's own bookkeeping),
prints `PROBE: PASS <json>` — including the GLib diagnostic count — and exits 0, or
`PROBE: FAIL <json>` and exits 1. The same assertions run from `activate` before the window is
shown, so the existing `showcase-smoke` CI leg carries them; a throw inside a GLib callback prints
`JS ERROR` and lets the process exit 0, and that marker is what the smoke gate greps for.

**Every slot assertion is about PLACEMENT, not presence**, because the siblings measured what
presence is worth: with the presence version, `slot="bottom"` on the header bar passed with the
header genuinely rendered at the foot of the window, output byte-identical. Measured on this
showcase, each of these turns the probe red on its own — deleting `slot="title"` (the label is
still in the subtree; only `get_title_widget()` notices), flipping `orientation` to `horizontal`,
moving `slot="content"` to `slot="bottom"`, dropping the `ref`, appending the conditional label
instead of placing it in the middle, and swapping the list `key` from `row.id` to the array index
(the surviving row is then a re-used widget with a patched title, not the same object).

The probe drives the main loop itself: `scheduler`'s host callback is a GLib timer source, and
nothing runs it inside a probe. The pump is **bounded**, because a scheduler that never runs has to
fail an assertion rather than hang the process — an unbounded wait is what `showcase-smoke` reads
as "still up after the dwell", a failure reporting itself as a pass.

## The type half

`check` is plain `tsc` (via `gjsify tsc --noEmit`), not a per-framework program checker: React JSX
is TypeScript's own dialect, so unlike the Vue sibling there is no `.vue` file a compiler cannot
read. The fixture-level gate for the same surface is
`scripts/check-type-surfaces.mjs`'s **`react` half**, which holds it negative-first — including the
measurement that matters most for a consumer: under `jsx: "react-jsx"`, an unset or empty
`jsxImportSource` **defaults to `"react"`**, so forgetting it is the same failure as naming it, and
`@types/react`'s 208 HTML/SVG/MathML tags type-check clean on a GTK renderer and render nothing.

## License

MIT
