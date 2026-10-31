// SPDX-License-Identifier: MIT
// @gjsify/node-gi — host.node.js with ONE export overridden: foreign parent classes are
// allowed. Selected by the `gjsify-foreign-parents` condition (package.json `imports` →
// `#host`), i.e. only by a program launched as `node --conditions=gjsify-foreign-parents`.
//
// WHY A HOST AND NOT A FLAG. host.node.js keeps FOREIGN_PARENT_CLASSES false on purpose and
// its comment says why: on Node/Bun/Deno/GJS a program can also be run under real GJS, so
// `registerClass` must keep throwing GJS's invalid-base error rather than accept a base GJS
// would reject. That reasoning is about PROGRAMS, and it is the right default for every one of
// them. It is not a statement about the capability: route D is host-agnostic C++, and flipping
// this one export is enough to drive it on a desktop — measured, 2026-10-31.
//
// WHAT IT BUYS, and why the hole is worth having. Route D (`withProperties` over a foreign
// NativeScript base, ADR 0105 § 2) had NO harness anywhere but an Android device run: the
// pure-JS leg answers from the seam's own accessors and passes by construction, so the one path
// that can break was measured only by plugging in a phone. It broke exactly there —
// `Gtk.MenuButton` reached the device with `resolved.giConnect === undefined` and five red
// cases (ADR 0128 Amendment § A5). With this condition the same five fail on a laptop in 17ms,
// which is the difference between a regression test and a field report.
//
// WHY IT IS NOT A BACK DOOR. The condition has to be passed on the COMMAND LINE of the process:
// no dependency, bundle, env var or config file can select it, and nothing in node-gi reads it
// at runtime. A consumer that types it has made the same deliberate choice a NativeScript build
// makes, and has this file's name in their command to say so. The GJS-compatibility promise
// holds for every program that does not.
//
// The only consumer is `@gjsify/adwaita-nativescript`'s `test:gjs-on-node` leg. Everything other
// than the one flag comes from host.node.js, so this file cannot drift from it.
export {
    setImmediate,
    setInterval,
    clearInterval,
    runtimeProcess,
    windowingEnvWrites,
    bundledLocaleDir,
    refreshLocale,
    RUNTIME,
    LAZY_NATIVE,
    loadNativeHost,
} from './host.node.js';

/**
 * Whether `GObject.registerClass` may register a class whose JS parent is NOT a node-gi
 * GObject class. TRUE here — the one export this host overrides; see the header.
 * @type {boolean}
 */
export const FOREIGN_PARENT_CLASSES = true;
