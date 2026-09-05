# 0050. Effect's platform services for GNOME are a platform package, not a renderer

- Status: Accepted
- Date: 2026-09-06
- Deciders: Pascal Garber

## Context

[Effect](https://effect.website) is a TypeScript library whose value is in the type
system: `Effect<A, E, R>` puts the failure channel and the dependency set in the
signature, fibers can be interrupted where promises cannot, and a `Scope` releases
what it acquired even when the work is interrupted.

Its 4.0 RC runs on GJS **unmodified**. `tests/integration/effect` measures that: 64
cases on Node and 85 on GJS, no `@gjsify/*` change required. Bare GJS supplies only
`WeakRef` and `FinalizationRegistry` of what Effect reaches for; the rest —
`structuredClone`, `MessageChannel`, `AbortController`, `queueMicrotask`,
`performance`, `Symbol.dispose`, `process` — is `@gjsify/*` output and holds.

That answered the compatibility question and raised the design one: what does
supporting Effect here actually mean?

The obvious answer was wrong. This repo binds UI frameworks to `@gjsify/gtk-host`,
and three of them are bound already (React per ADR 0032, Vue, Solid). Treating
Effect the same way would mean inventing an Effect UI layer. But Effect has no
components, no templates, no reconciliation, and retained mode was never the hard
part for an effect system: immediate mode would be, because a graph re-evaluated
per frame is what makes one expensive, while a GTK tree keeps its own state and
Effect only sequences the mutations.

What a GNOME application is missing is the other half, and all three pieces of it
have a GNOME-shaped answer that no cross-platform layer can give:

- Every failing GIO call arrives as one type, a `GLib.Error` carrying a number whose
  meaning depends on its domain. Measured: `Gio.IOErrorEnum.NOT_FOUND` and
  `GLib.FileError.ISDIR` are both `1`, so a code read without its domain reports "is
  a directory" as "not found".
- GIO's async calls take a `Gio.Cancellable`. `Effect.callback` hands its register
  function an `AbortSignal`. Wiring the two means interrupting a fiber stops the
  in-flight I/O rather than abandoning its result, which no promise-based layer can
  offer.
- A widget's lifetime is GObject refcounting and a fiber's is its `Scope`, and
  nothing connects them.

## Decision

Ship `@gjsify/effect-platform`: Effect's platform services implemented over GNOME's
own APIs. **Not** a renderer, and not routed through `@gjsify/gtk-host`.

The precedent is Effect's own ecosystem, which is one platform package per host —
`@effect/platform-node`, `-bun`, `-deno`, `-browser`, each implementing the same
services over that host's APIs. GNOME is a fourth host, and naming it that way makes
the claim small and checkable instead of aspirational.

Two entries, split by what they import:

| entry | provides | reaches |
|---|---|---|
| `@gjsify/effect-platform` | `effect/FileSystem` over `Gio.File`, `effect/Path` over GLib, `GError` → `SystemError` | GLib, GIO |
| `@gjsify/effect-platform/gtk` | a `Scope` a GObject lifetime closes, a GObject signal as a `Stream` | GTK, GObject |

The root entry declares `gjsify.headless` and CI walks its import graph to hold it.
A service layer that dragged in GTK could not be used from a daemon, a CLI or a
test, and that is exactly where these services are most useful.

**The conformance suite decides whether the FileSystem layer is real.** Upstream
authored `FileSystem.test-utils.ts` as a suite parameterised by a layer, so that
Node, Bun and Deno answer the same questions. `tests/integration/effect` ports it
once and runs it twice: over `node:fs` (i.e. `@gjsify/fs`) and over this package's
Gio layer. Both pass all 21 cases. Neither implementation chose the questions.

## Consequences

**A new published `@gjsify/*` name needs its npm first-publish and Trusted Publisher
bootstrap before the release that ships it** (§ Package convention). Until
`gjsify onboard @gjsify/effect-platform` has run, a release stalls at this name and
at every alphabetically later one.

**`effect` is a peer dependency, not a dependency.** A consumer's Effect and the
layer's must be the same instance or the service keys do not match. The RC is pinned
exactly in `devDependencies` for the tests, because `^` does not mean what one
expects across prerelease tags.

**What the layer does NOT implement, it kills rather than fakes.** `FileSystem.make`
is used instead of `makeNoop`, so the complete interface is spelled out and a method
added upstream cannot arrive as a silent default; `makeNoop` answers `remove()` with
`Effect.void`, a silent success, and its other defaults fail with `NotFound` — the
tag a genuinely missing file carries, which a `catchTag` would swallow. Unimplemented
methods raise a defect. Today that is `realPath`, `link` and `glob`, each with the
reason in place: GIO has no symlink-resolving canonicalizer, no hard-link call and
no glob matcher.

**Three GIO semantics had to be corrected against the conformance suite**, and each
is recorded where it bites: `g_file_replace*` is atomic-replace and therefore not
POSIX `w`/`w+`; a `GFileOutputStream` buffers where a descriptor does not, so every
write flushes; and `g_file_copy_async`/`move_async` are typed with `GObject.Closure`
parameters by `@girs`, so the layer takes the synchronous call and says so.

**Cost, measured before committing rather than after.** Importing Effect and running
one effect adds 25 KB to a GJS bundle and 2 ms to cold start (12 runs, 45 ms → 47 ms).
The showcase window with this layer is 213 KB against 165–188 KB for two comparable
GTK showcases that use no Effect at all. Tree-shaking over Effect 4 works; you pay
for what you import.

## Alternatives considered

**Bind Effect to `@gjsify/gtk-host` as a fourth renderer.** Rejected: it has nothing
to render with, and the repo already answers that question three times.

**Leave the bridge inside the showcase.** That is where it started, and it was the
right first step, because the two design questions — which signal closes a widget
scope, and how much of `FileSystem` a Gio layer should implement — were open until
something used it. Both are now answered by measurement, so the code has outgrown
the demo.

**Use `NodeFileSystem.layer` and ship no FileSystem at all.** It works on GJS and
this repo holds it there. Rejected for two reasons: GIO's async calls are async in
the GLib main loop rather than only in JavaScript, which is the difference between a
read that shares the loop with the frame clock and one that does not; and
cancellation has no addressee on the Node path.
