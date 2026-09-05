# @gjsify/effect-platform

[Effect](https://effect.website)'s platform services over GNOME. `effect/FileSystem` on
`Gio.File`, `effect/Path` on GLib, `GError` mapped onto Effect's normalized platform errors, and a
`/gtk` subpath that binds GObject lifetimes to Effect `Scope`s.

Effect 4 runs on GJS unmodified. This package is not what makes it run; it is what makes it
**GNOME**. See [ADR 0050](../../../docs/adr/0050-effect-platform-services-for-gnome.md) for why
that is a platform package rather than a fourth renderer.

```ts
import { Effect } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import { fileSystemLayer } from '@gjsify/effect-platform'

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  return yield* fs.readDirectory('/etc')
})

await Effect.runPromise(Effect.provide(program, fileSystemLayer))
```

## Two entries, split by what they import

| entry | provides | reaches |
|---|---|---|
| `@gjsify/effect-platform` | `fileSystemLayer`, `pathLayer`, `reasonOf`, `toPlatformError`, `gioAsync` | GLib, GIO |
| `@gjsify/effect-platform/gtk` | `widgetScope`, `windowScope`, `signalScope`, `runInScope`, `signalStream`, `propertyStream` | GTK, GObject |

The root entry declares `gjsify.headless` and CI walks its import graph to hold it. A service
layer that dragged in GTK could not be used from a daemon, a CLI or a test, which is where these
services earn their keep.

## What only this layer can do

**Cancellation reaches GIO.** `Effect.callback` hands its register function an `AbortSignal`;
every GIO async call takes a `Gio.Cancellable`. `gioAsync` wires the two, so interrupting a fiber
stops the in-flight read rather than discarding its result. Nothing promise-based can offer that.

**A `GError` becomes a tag you can branch on.** Today every failing GIO call is a `GLib.Error`
with a number whose meaning depends on its domain. Measured: `Gio.IOErrorEnum.NOT_FOUND` and
`GLib.FileError.ISDIR` are both `1`, so a code read without its domain reports *is a directory* as
*not found*. `reasonOf` refuses that, and a GIO code Effect has no tag for comes back `Unknown`
rather than as a near miss.

**A `Scope` closes with the widget.** `windowScope(window)` closes on `close-request` **or**
`destroy`, whichever is first, and everything forked into it is interrupted. Two triggers, because
`GtkWidget::destroy` is emitted from *dispose*: with the application holding a reference, which is
always, `gtk_window_destroy()` emits `unrealize` and no `destroy`. The full measured matrix is in
`src/gtk/scope.ts`.

## Conformance

Upstream authored `FileSystem.test-utils.ts` as a suite parameterised by a layer, so Node, Bun and
Deno answer the same questions. [`tests/integration/effect`](../../../tests/integration/effect)
ports it once and runs it twice: over `node:fs` and over this package's Gio layer. **Both pass all
of it**, including the cases about the file cursor that nobody here would have thought to ask —
seek backwards, `a+` with separate read and write positions, truncate under a live cursor. The
per-run counts live in
[`status/integration-coverage.md`](../../../status/integration-coverage.md), which is where a number
can be re-measured instead of remembered.

Three GIO semantics had to be corrected to get there, and each is recorded where it bites:

- `g_file_replace*` is GIO's *atomic replace*: it writes a temporary file and moves it into place
  on close, so the path still holds the old bytes until then. POSIX `w`/`w+` truncate in place, so
  those flags open read-write and truncate instead.
- A `GFileOutputStream` buffers where a descriptor does not, so every write flushes.
- `g_file_copy_async`/`move_async` are typed with `GObject.Closure` parameters by `@girs`, which
  is not constructible from GJS in any reasonable way, so the layer takes the synchronous call.
  Interruption still reaches GIO through the cancellable; what is lost is that the call blocks.

## What it does not implement

`realPath`, `link` and `glob` raise a **defect**, not a failure — GIO has no symlink-resolving
canonicalizer, no hard-link call and no glob matcher. The distinction matters: `FileSystem.makeNoop`
would answer `remove()` with a silent success and the rest with `NotFound`, which is the tag a
genuinely missing file carries and which a `catchTag` would swallow. This package spells out the
complete interface through `FileSystem.make` so a method added upstream cannot arrive as a silent
default.

## Cost

Tree-shaking over Effect 4 works: you pay for what you import, and a GTK window using this layer
lands in the same size class as comparable showcases that use no Effect at all. The figures, and
which artifact each one came from, are in
[ADR 0050](../../../docs/adr/0050-effect-platform-services-for-gnome.md) § Cost.

## Peer dependency

`effect` is a **peer** dependency. A consumer's Effect and this layer's must be the same instance,
or the service keys do not match.
