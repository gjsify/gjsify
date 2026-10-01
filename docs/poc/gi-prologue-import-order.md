# POC — where a `--app gjs` bundle may put its GI search-path prologue

**Date**: 2026-09-30
**Host under test**: macOS 27 / Apple M4 (darwin-arm64) / Homebrew `/opt/homebrew` / GTK 4 /
gjs 1.88.1 — the FIRST darwin-arm64 measurement of this mechanism; everything before it was
either the macOS 15.7.x x86_64 VM or a stand-in host on Linux.
**Reproduction**: [`gi-prologue-import-order.gjs.mjs`](gi-prologue-import-order.gjs.mjs) —
`gjs -m docs/poc/gi-prologue-import-order.gjs.mjs`
**Decision it feeds**: [ADR 0085](../adr/0085-gi-namespaces-are-acquired-after-the-prologue.md)

## TL;DR

The prologue works on this Mac, and it reaches exactly what the Linux measurement said it
would: a namespace loaded LATER. A static `import … from 'gi://Ns'` is still out of reach,
because ESM evaluates a module's imports before its body and a banner IS the body. Four
placements fix that, three of them measured working; the ADR picks the one that keeps a single
artifact AND keeps the `gi://` specifier in it.

Every row runs as a child `gjs` with `DYLD_FALLBACK_LIBRARY_PATH`, `DYLD_LIBRARY_PATH` and
`GI_TYPELIB_PATH` **deleted** — not merely unset. This host's `~/.zshenv` exports the fallback
path (the documented Homebrew workaround); inheriting it makes every row pass and measures
nothing.

## What the harness holds fixed

The prologue text is imported from the real generator (`giRuntimePathsStub`), not retyped: a
placement study measuring a hand-copied prologue keeps agreeing with itself after the generator
changes. The candidate libdir is read off the running repository's own search path by GI's
install-layout rule (`<libdir>/girepository-1.0/Ns-V.typelib` beside `<libdir>/libns.dylib`),
so the harness lands on Homebrew at either prefix, MacPorts or a custom build without knowing
any of them exist. The host-marker gate is deliberately NOT varied here — that is
`giSystemProbes()`' question and `tests/e2e/gi-runtime-prologue` plus
`gi-runtime-paths-banner.spec.ts` own it.

## Rows

| Scenario | Outcome | What it establishes |
|---|---|---|
| `no-prologue` | fails | The control for the file. Without it, nothing below is a measurement — this host genuinely cannot resolve `libgtk-4.1.dylib`: dlopen tries gjs's own rpath, `…/Cellar/gjs/1.88.1/bin/../../../../opt/glib/lib`, i.e. **glib's keg alone**. |
| `banner-then-dynamic-import` | loads | What ships today, against the load shape it reaches. |
| `banner-then-static-import` | fails | The gap ADR 0085 exists for. Byte 1 of the FILE is not byte 1 of the evaluation order. |
| `prologue-module-first` | loads | A second module, imported first, works — so the constraint is evaluation ORDER, not "a bundle cannot repair itself". |
| `prologue-module-last` | fails | The row above is about POSITION, not about being a separate file. |
| `prologue-module-first-transitive-import` | loads | The `gi://` import may sit one module DEEPER, which is where most of them are (`@gjsify/gtk-host` imports Gtk, the app imports that). |
| `lowered-to-await-import` | loads | The decision. |
| `lowered-to-imports-gi-accessor` | loads | A rejected alternative — refused on the grounds in the ADR, NOT because it fails to load a namespace. |
| `lowered-to-gjs-gi-resource` | loads | The other rejected alternative, same reading. |
| `lowered-then-blocking-main-loop` | **stalls** | The decision's own cost, below. |
| `lowered-then-run-async` | loads | …and where it lands. |

The failure is always the same pair of lines, which is worth quoting once because it reads like
a type-system bug and is not:

```
GLib-GIRepository-WARNING **: Failed to load shared library 'libgtk-4.1.dylib' referenced by
the typelib: dlopen(libgtk-4.1.dylib, 0x0009): tried: … '/opt/homebrew/Cellar/gjs/1.88.1/bin/
../../../../opt/glib/lib/libgtk-4.1.dylib' (no such file) …
Gjs-CRITICAL **: JS ERROR: Error: Unsupported type void, deriving from fundamental void
```

`gi_repository_require` resolved the typelib; `g_module_open` then failed, so no `gtk_*_get_type`
was ever registered.

## The cost, and why it lands where it does

The lowering puts a top-level `await` in every bundle that had a static `gi://` import — and
those are the GTK applications. The consequence is NOT the claim
[`tla-microtask-draining.md`](tla-microtask-draining.md) refuted: microtasks DO drain under a
pending top-level await, and that still holds here.

The narrower fact is re-entrancy. A module that has awaited is a promise JOB, and a **blocking**
`GLib.MainLoop.run()` entered from a job parks the job queue: the idle source fires, the
continuation it schedules is queued behind the still-running job, and the `loop.quit()` inside
that continuation never arrives. Measured three ways on this host:

| Program | Result |
|---|---|
| static imports, `loop.run()` | drains inside the loop, exits |
| lowered to `await import()`, same `loop.run()` | **wedges** — only the timeout source fires |
| no await anywhere, but `loop.run()` called from inside a plain `Promise.resolve().then(…)` | **wedges** identically |

The third row is what identifies the mechanism: it is the blocking `run()` inside a job, not
the top-level await as such.

And it falls on a shape the repo already forbids — a GTK application runs via
`await Application.runAsync()`, never the synchronous `run()` (root AGENTS.md § GLib MainLoop,
and the reason `runAdwaitaApp` exists). The `lowered-then-run-async` row is that program: the
source callback's continuation drains and the application quits.

## The host facts behind the candidate

| | |
|---|---|
| `systemGiLibraryDirs()` | `["/opt/homebrew/lib"]` — unchanged with `pkg-config` off `PATH` and the env stripped, i.e. the answer comes from `PROBED_GI_LIBDIRS`, not the pkg-config source |
| `hostGtkIsWorthTrying()` | `true` |
| host marker | `/System/Library/CoreServices/SystemVersion.plist` present |
| probed candidates holding a `girepository-1.0/` | `/opt/homebrew/lib` only; `/usr/local/lib` and `/opt/local/lib` do not, and are not prepended |

## Reproduction

```console
$ gjs -m docs/poc/gi-prologue-import-order.gjs.mjs
# GI prologue placement on this host — candidate /opt/homebrew/lib
## no-prologue — PASS (fails, expected fails)
## banner-then-dynamic-import — PASS (loads, expected loads)
## banner-then-static-import — PASS (fails, expected fails)
## prologue-module-first — PASS (loads, expected loads)
## prologue-module-last — PASS (fails, expected fails)
## prologue-module-first-transitive-import — PASS (loads, expected loads)
## lowered-to-await-import — PASS (loads, expected loads)
## lowered-to-imports-gi-accessor — PASS (loads, expected loads)
## lowered-to-gjs-gi-resource — PASS (loads, expected loads)
## lowered-then-blocking-main-loop — PASS (stalls, expected stalls)
## lowered-then-run-async — PASS (loads, expected loads)
# EVERY PLACEMENT BEHAVED AS ADR 0085 RECORDS IT
```

Exit 0 = every placement behaved as the ADR records it on this host; non-zero = one regressed,
i.e. the decision rests on a fact the runtime no longer has. It SKIPS (exit 0) where no
search-path entry holds the namespace at all: the whole question is dyld's, and on a host whose
loader already finds the leaf every row would pass having measured nothing.

## Related

- `packages/infra/rolldown-plugin-gjsify/src/plugins/gi-runtime-paths.ts` — the generator
- `packages/infra/cli/src/utils/gi-runtime-paths.ts` — what a bundle is told, and the two gates
- `tests/e2e/gi-runtime-prologue` — the same mechanism measured through a real build
- `status/open-todos/macos.md` § "A globally installed GJS launcher still cannot load a system
  GTK on macOS"
