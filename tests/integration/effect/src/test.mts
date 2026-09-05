// Integration-test entry for @gjsify/integration-effect.
//
// Effect 4 (RC) on both runtimes — Node as the control, GJS as the measurement.
//
// Why Effect and not another library: its fiber runtime is the most demanding
// scheduling consumer in the tree. Every fiber yield goes through a microtask or a
// host timer, every interruption unwinds finalizers, every resource is a Scope that
// must close on the way out — so a class of @gjsify/* timing defects surfaces here
// that a request/response library never reaches.
//
// Why the 4.0 RC and not stable 3.x: 4.0 folds platform, schema, stream and http
// into the `effect` package itself, so `effect/FileSystem` and `effect/Path` are
// core rather than a separate dependency, and upstream ships
// `FileSystem.test-utils.ts` — a layer-PARAMETERISED conformance suite written so
// Node, Bun and Deno answer the same questions, which we point at @gjsify/fs. The
// RC announcement states no further broad breaking changes and asks for exactly
// this kind of third-party validation before stable. Pinned to an exact version:
// `^` does not mean what one expects across prerelease tags.
//
//   runtime-surface  the platform APIs Effect reaches for, before any Effect runs
//   filesystem       21 upstream conformance cases over @gjsify/fs
//   path             POSIX + win32 file-URL conversion over @gjsify/{path,url}
//   scope            finalizer order, interruption, double close
//   scheduler        the sync/host split, and that runSyncExit schedules no timer
//   clock            which of our APIs the Clock reads for wall vs monotonic time
//   stream           push-to-pull (the shape a GTK signal has), plus a real-timer leg
//   config-env       Effect's env reader against @gjsify/process's GLib Proxy
//
// `gjsify build --globals auto` injects the Node/Web globals; no /register import
// appears in this source.

import { run } from '@gjsify/unit';

import { commonSuites } from './suites.js';

run(commonSuites);
