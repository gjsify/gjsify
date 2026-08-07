// @gjsify/adwaita-core/conformance — the cross-renderer spec, as data.
//
// WHY THIS IS A SEPARATE SUBPATH, AND WHY IT IS DATA
//
// `@gjsify/adwaita-core` holds the behavior; this subpath holds the EXPECTATIONS
// that behavior is judged against, derived row by row from the libadwaita C
// source. Both renderers — `@gjsify/adwaita-web` (Custom Elements) and
// `@gjsify/adwaita-nativescript` (native NS views) — import these tables into
// their own spec suites and drive their real widgets with them.
//
// That is the point: a renderer which quietly re-implements a derivation instead
// of delegating to core does not fail "eventually, in a screenshot diff" — it
// fails a unit test, on the machine, in CI, naming the exact input that drifted.
// The avatar family is why this exists: the two ports carried near-identical
// copies of the initials + colour derivation, one of them had silently drifted
// to two-letter initials for single-word names, and BOTH hashed UTF-16 code
// units where GLib hashes UTF-8 bytes — so every accented name got the wrong
// colour in both. Nothing in the build was in a position to notice.
//
// Vectors are opt-in via this subpath rather than the package root so shipping
// applications never bundle the test corpus.
//
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

export { AVATAR_COLOR_VECTORS, AVATAR_INITIALS_VECTORS } from './avatar.js';
export type { AvatarColorVector, AvatarInitialsVector } from './avatar.js';
