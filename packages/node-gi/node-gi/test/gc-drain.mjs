// SPDX-License-Identifier: MIT
// "Have the native finalizers actually run?" — one answer, shared by every
// ownership test.
//
// A boxed handle's release is a napi finalizer, and napi finalizers do NOT run
// inside the collection: V8 resets the weak persistent during GC and Node defers
// the finalize callback to a later loop turn (#1475). So a double free raised by
// a wrong transfer only aborts after BOTH a collection and a turn of the loop,
// and a `gc()` alone proves nothing — a suite that skips the loop turn reports
// green while the abort is still queued.
//
// Two rounds because the first collection is what makes the wrappers unreachable
// and the second turn is what lets their finalizers run; `globalThis.gc` is
// optional so the same test file still runs without `--expose-gc` (it then only
// stops proving the ownership half, rather than failing).

/** Collect, then give the loop the turn the napi finalizer queue needs. */
export async function drainFinalizers() {
    for (let i = 0; i < 2; i++) {
        globalThis.gc?.();
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}
