# vue-host-counter

The [`adw-host-counter`](../adw-host-counter) window a third time — written as a **Vue single-file
component** and compiled by
[`@gjsify/rolldown-plugin-vue`](../../../packages/infra/rolldown-plugin-vue). Same widgets, same
assertions: one showcase imperative through the host ops, one through Solid's JSX compiler
([`solid-host-counter`](../solid-host-counter)), this one through `@vue/compiler-sfc`. Two contracts
over one host is what makes "framework-agnostic" a measurement instead of a decision.

```bash
gjsify run build:gjs && gjsify run start:gjs   # the window
gjsify run probe                               # the assertions, headless
gjsify run check                               # vue-tsc over the SFC, held non-vacuous
```

## What only this showcase proves

The Vue adapter was complete and tested before any of this existed — but it was tested through
`h(...)` calls, which is to say through the renderer calls an SFC template compiles *to*. Nothing
in the repository compiled a `.vue` file, so the whole compile step was unmeasured.

This showcase runs the real pipeline end to end and asserts the **real** widget tree
(`get_first_child`/`get_next_sibling`, never the host's own bookkeeping), including the two things
only a compiled SFC can produce: a `v-for` list through `Adw.PreferencesGroup`'s `remove-all`
placement degradation, and a `v-if` whose empty branch must not occupy a GTK slot.

**And it is honest about its limit.** Three deliberate breaks in the plugin — dropping
`isCustomElement` from the parse options, narrowing the predicate to kebab only, and pointing
`runtimeModuleName` back at `vue` — all built and all printed `PROBE: PASS`. `resolveComponent`
falls back to the tag string when it resolves nothing, `createVNode("gtk-box", …)` is an element
vnode, and Vue even normalises an unresolved component vnode's slots object back into element
children. So the tree is identical; what differs is a resolution attempt per tag per render and a
`__DEV__`-only warning the required production defines strip. Those settings are gated by the
plugin's own suite (`packages/infra/rolldown-plugin-vue/src/*.spec.ts`), which asserts the
**emitted code**. The tree is this showcase's subject; the code is that suite's.

## The window is the application's, the content is Vue's

This is the one structural difference from the two siblings, and it is Vue's mount model rather
than a choice: `app.mount(container)` renders *into* a widget, and a toplevel window is not a child
of anything. An `adw-application-window` at the root of the template would ask GTK to parent a
toplevel and earn a `Gtk-WARNING` at exit 0.

So the application owns the window (it also owns the `Adw.Application` the window needs), and
`mount(rootComponent, container)` from the adapter `adopt`s it. The SFC's `adw-toolbar-view` then
lands through `Adw.ApplicationWindow.set_content()` — the `single` placement policy the descriptor
table declares for that GType.

## `app.hold()` is load-bearing

The probe has to `await` Vue's scheduler, and `activate` is a GLib callback that cannot be awaited.
Without the hold, measured: `activate` returned having presented nothing, GApplication's hold count
hit zero, and `gtk_application_shutdown` ran its own nested main loop. The probe's continuation was
then dispatched **from inside that shutdown**, constructed a window with `application: app`, and
`gtk_application_window_added` segfaulted — `PROBE: PASS` on stdout, exit 139, and a stack ending in
`gtk_application_shutdown → g_main_loop_run → PromiseJobDispatcher`. Nothing about the crash names
the missing hold.

The `catch` around the async body is there for the same reason: a rejected promise would leave the
`hold()` un-released forever, and an application that never exits is what `showcase-smoke` reads as
"still up after the dwell" — a failure reporting itself as a pass.

## The probe

`GJSIFY_HOST_PROBE=1` builds the tree headlessly, asserts it, prints `PROBE: PASS <json>` —
including the GLib diagnostic count — and exits 0, or `PROBE: FAIL <json>` and exits 1. The same
assertions run from `activate` before the window is shown, so the existing `showcase-smoke` CI leg
carries them; a throw inside a GLib callback prints `JS ERROR` and lets the process exit 0, and that
marker is what the smoke gate greps for.

One assertion is not about the tree at all: `globalThis.document` must be `undefined`. That holds
the **build recipe** — `@vue/runtime-core` is DOM-free in fact, but `--globals auto` is a static
scan and injects a polyfill per identifier it sees in a dev-only branch, which made a bundle require
`gi://Gdk`, `GdkPixbuf`, `Pango` and `PangoCairo` at load. The four defines in `build:gjs` are what
let dead-code elimination remove those branches.

## The type half

`check` runs **`vue-tsc`**, not `tsc`: `tsc` cannot read a `.vue` file at all, and this showcase is
where the two-halves contract is exercised on a real app rather than on fixtures.

`tsconfig.json` extends nothing on purpose. Measured on `vue-tsc@3.3.11`, the **base** of an
`extends` chain wins `vueCompilerOptions.strictTemplates` in both directions, so a per-package
override does nothing — this file being the base is the only reason the setting takes effect.

Measured on this showcase, with `strictTemplates: true`: an unknown prop (TS2353), an unknown tag
(TS2339), an unknown event (TS2561, with a "Did you mean `onClicked`?"), a wrong value type (TS2322)
and a bad enum nick (TS2322 naming `GtkOrientationNick`) all fail. With it set to `false`, the
unknown prop and the unknown **tag** are both silently accepted.

Which is why `check` goes through **`scripts/check-vue-program.mjs`** rather than calling `vue-tsc`
directly: a bare `vue-tsc --noEmit` is an exit code and nothing else, so dropping `strictTemplates`
or putting an `extends` above it leaves the check green and no longer holding the surface — both
measured, both now red. The script also runs `--listFiles` and requires every `.vue` on disk to be
in the program. Note what that assertion does *not* catch, also measured: `App.vue` reaches the
program through `app.ts`'s import and is fully type-checked with or without `src/**/*.vue` in
`include`, so the glob is what covers a component that is not wired up yet — an unimported
`Unwired.vue` with the glob dropped is the case that turns it red.

## License

MIT
