// SPDX-License-Identifier: MIT
// PoC shim: the cairo.cc surface without libcairo.
//
// cairo.cc is the foreign-struct seam: it wraps cairo_t/cairo_surface_t/
// cairo_pattern_t so a GI function taking one round-trips through the cairo
// module instead of the generic boxed path. It needs libcairo itself, which
// this PoC does not build for Wasm — the question under test is GObject +
// girepository, not the drawing stack.
//
// Leaving the seam unregistered is safe: marshal.cc falls back to the boxed
// path for an unregistered foreign struct. Nothing in the M3/M4 harness calls
// a cairo-typed GI function.

#include "common.h"

namespace nodegi {

void InitCairo(Napi::Env env, Napi::Object exports) {}

}  // namespace nodegi
