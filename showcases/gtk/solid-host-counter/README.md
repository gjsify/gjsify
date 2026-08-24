# solid-host-counter

The [`adw-host-counter`](../adw-host-counter) window written as **SolidJS JSX** and compiled by
[`@gjsify/rolldown-plugin-solid`](../../../packages/infra/rolldown-plugin-solid). Same widgets,
same assertions — one showcase imperative through the host ops, this one through a real framework
compiler, so the two are a deliberate A/B.

```bash
gjsify run build:gjs && gjsify run start:gjs   # the window
gjsify run probe                               # the assertion
```

## What only this showcase proves

`gtk-host`'s type surface is gated by `scripts/check-type-surfaces.mjs`, and that gate states its
own limit: *"Nothing about RUNTIME."* Until this showcase existed nothing in the repository
compiled a single line of JSX.

The build step is the half that fails silently. Pointed at a `.tsx` with no JSX configuration,
Rolldown's transformer defaults to the automatic React runtime, emits
`import { jsx } from "react/jsx-runtime"`, reports the unresolved import as a **warning** and exits
0 — so the artifact exists, CI is green, and the app dies at its first import under GJS.

## The compiler's output shape

Measured on this showcase's own markup:

```js
var _el$ = _$createElement("adw-application-window"),
    _el$2 = _$createElement("adw-toolbar-view");
_$insertNode(_el$, _el$2);
_$setProp(_el$, "title", "solid-host counter");
```

Three facts follow, and each is an assertion in the probe:

- children are inserted **before** properties are set, and `createElement` never sees a prop — so
  a construct-only property (`cssName`) only survives because the host defers materialisation
  (ADR 0027 § Decision 5);
- handlers arrive through `setProp` under their JSX spelling (`onClicked`), not through a separate
  op — so the probe emits `clicked` on the real `Gtk.Button` rather than calling the closure;
- the renderer op names are emitted **literally**, so `@gjsify/gtk-host/solid` must re-export every
  member of Solid's `Renderer<NodeType>` under its contract name.

## The probe

`GJSIFY_HOST_PROBE=1` builds the tree headlessly, asserts it against the **real** widget tree,
prints `PROBE: PASS <json>` — including the GLib diagnostic count — and exits 0, or
`PROBE: FAIL <json>` and exits 1. The same assertions run on `activate` before the window is
shown, so the existing `showcase-smoke` CI leg carries them; a throw inside a GLib callback prints
`JS ERROR` and lets the process exit 0, and that marker is what the smoke gate greps for.

`<For>` is imported from the **adapter**, never from `solid-js/web`: that package is the DOM
renderer, and its components build DOM elements nothing here can place — measured as a subtree
that renders nothing, silently, at exit 0.

## License

MIT
