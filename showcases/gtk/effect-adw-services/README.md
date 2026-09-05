# effect-adw-services

[Effect](https://effect.website) 4 running the **services** behind an Adwaita window on GJS —
typed errors, deterministic resource release, and cancellation that reaches the C library. The
widget tree is Blueprint's; Effect renders nothing.

```bash
gjsify run build && gjsify run start:gjs   # the window
gjsify run probe                           # the assertions, headless
gjsify run shot                            # regenerate the pictures below
```

| a directory read | the same read against a path that is not there |
|---|---|
| ![Listing](docs/listing.png) | ![NotFound](docs/not-found.png) |

`NotFound` is Effect's word, not this showcase's — see *one program, two layers* below.

## Why this is not a fourth renderer

`@gjsify/gtk-host` already has three UI frameworks bound to it — React, Vue and Solid — so
"declarative UI over a retained-mode tree" is a solved problem here three times over. Retained
mode was never the hard part for an effect system anyway: immediate mode would be, because a
graph re-evaluated sixty times a second is what makes one expensive, while a GTK tree keeps its
own state and Effect only sequences the mutations.

What no GJS application has is the other half. So this showcase is deliberately the small,
honest cut: Effect sits *beside* the widgets and supplies

| module | what it bridges |
|---|---|
| [`effect-gio/errors.ts`](src/effect-gio/errors.ts) | `GError` → Effect's eleven normalized `SystemError` tags |
| [`effect-gio/filesystem.ts`](src/effect-gio/filesystem.ts) | a read-only `effect/FileSystem` over `Gio.File`, cancellable for real |
| [`effect-gio/scope.ts`](src/effect-gio/scope.ts) | a `Scope` a GObject lifetime closes — RAII for GJS |
| [`effect-gio/signal.ts`](src/effect-gio/signal.ts) | a GObject signal as a `Stream`, with the buffering strategy named |

Effect's own behaviour is upstream's business and is covered in this repo by
[`tests/integration/effect`](../../../tests/integration/effect) — 63 cases, green on GJS and on
Node. This showcase asserts only what a *running GTK application* can answer.

## Four things measured here, not assumed

**`GtkWidget::destroy` is emitted from `dispose`, not from `gtk_window_destroy()`.** With the
application still holding a JS reference to its window — which is always — on GTK 4.22 /
libadwaita 1.9 / gjs 1.88.1:

| action on a presented `Adw.Window` | signals emitted |
|---|---|
| `close()` | `close-request`, `unrealize` |
| `destroy()` | `unrealize` — **no `destroy`** |
| `run_dispose()` | `unrealize`, `destroy` |

So "close the scope on `destroy`" — the obvious design — leaves a window's fibers running after
the user closes it. `destroy` is exactly right for the question *may a fiber still touch this
widget* (after it, GJS marks the wrapper disposed and every property read is a CRITICAL) and
exactly wrong for *is this window still open*. Hence two functions: `widgetScope` for the
correctness boundary, `windowScope` for the useful one.

**A GIO `*_finish` must run on the object that started the operation.**
`Gio.File.new_for_path(p)` returns a NEW `GFile` each call, and `g_task_is_valid(result, source)`
checks identity. Finishing on a freshly constructed file logged
`g_file_real_enumerate_children_finish: assertion 'g_task_is_valid (res, file)' failed`, returned
`null`, and surfaced one call later as `can't access property "next_files_async", r is null` — a
null dereference that names nothing about the actual mistake. `gioAsync` therefore takes the
source object as a parameter.

**Subscribing to a signal stream is asynchronous, and nothing buffers what beats it.**
`Stream.callback`'s register — where `connect()` happens — runs when the stream is first *pulled*,
and `forkChild({ startImmediately: true })` does not get the fiber that far. An emission before
that is simply not seen. Invisible in an application, where the subscription is set up in a
constructor and the first emission comes from a user; immediate the moment a test emits
programmatically. `propertyStream` starts with the property's *current* value for that reason.

**`Effect.forkIn` is itself an Effect that yields the fiber.** `runFork(forkIn(e, scope))` hands
back a `Fiber<Fiber<A, E>>` — an outer fiber that completes at once with the real one as its
value. Polling it returns a finished `Exit` while the work is still running, which reads exactly
like "the scope never started anything".

## What the window does

Type a path. Each keystroke is a `Stream` element; `debounce` collapses a burst; `switchMap`
starts a directory read and **interrupts the previous one**. Because the read is
`Effect.callback` with its `AbortSignal` wired to a `Gio.Cancellable`, that interruption reaches
GIO and stops the in-flight I/O rather than merely discarding its result — which is what closing
a window mid-read should do, and what no promise-based layer can offer. The two counters at the
bottom of the window make it visible rather than claimed.

A path that does not exist shows `NotFound`, verbatim: that string is Effect's vocabulary, not
this showcase's, and it is what makes the Gio layer a drop-in for the Node one rather than a
lookalike.

## The probe

`runHostProbeApp` from `@gjsify/gtk-host` owns the harness — the `GJSIFY_HOST_PROBE=1` env gate,
the GTK diagnostics collector, the `check()` recorder, the `PROBE: PASS|FAIL <json>` protocol and
the rule that the GUI path runs the same assertions before presenting.

The pictures above are `gjsify run shot`'s output, captured through
`captureWidgetPng` (`Gtk.WidgetPaintable` → `render_texture`) rather than the compositor — no
screenshot portal, same bytes on a headless runner. They are regenerated rather than remembered,
for the reason the probe harness records: the only witness to *did this draw* is the window.

The load-bearing assertion is **one program, two layers**: a single `Effect` that lists a
directory, stats a missing path and asks `exists`, run once against
`GioFileSystem.layer` and once against `@effect/platform-node-shared`'s `NodeFileSystem.layer`.
Both must return the same listing and the same `NotFound` — including on the failure path, where a
private error vocabulary would have diverged. The mapping is then checked for being a *mapping*:
`Gio.IOErrorEnum.NOT_FOUND` and `GLib.FileError.EXIST` are both `1`, so a same-coded error from
another domain must come back `Unknown`, and a GIO code Effect has no tag for (`IS_DIRECTORY`)
must come back `Unknown` too rather than a near miss.

## Scope of the Gio layer

Read-only, and stated in the code: `access`, `exists`, `stat`, `readFile`, `readFileString`,
`readDirectory`, `realPath`, `readLink`. `FileSystem.makeNoop` fills the rest with failures, so an
unimplemented call reports itself instead of quietly returning a wrong answer. Nothing that writes
is implemented — a showcase that can delete files is a showcase nobody runs twice.

## Why this is not a `@gjsify/*` package (yet)

The four modules under `src/effect-gio/` are the shape a reusable layer would have, and they are
deliberately not one. A new `@gjsify/*` name needs an ADR and an npm first-publish plus Trusted
Publisher bootstrap *before* the release that ships it, and the two design questions this showcase
answered — which signal a widget scope closes on, and how much of `effect/FileSystem` a Gio layer
should implement — were open until it was written. Living in a showcase is what let them be
answered by measurement instead of by argument.

What would have to be true to promote it: the write half of `FileSystem` (with the flag semantics
the [integration suite](../../../tests/integration/effect) already holds the Node layer to), a
`Path` layer over GLib, and the same suite run against *this* layer rather than only against
`NodeFileSystem`.
