// THE APP-LEVEL OPT-IN (ADR 0105 stage 4) — and the first module `app/app.ts` imports.
//
// `useRealGObjectEngine` fills the core's engine slot, and that slot FREEZES on its first read.
// So the opt-in has to happen before any module that reads it has a module body — in ESM that
// means a side-effect import above every other import, in a file of its own. The order is the
// app's duty and cannot be delegated: component modules call `registerClass` at module load, so
// deferring the engine to first use would already be too late.
//
// `__GJSIFY_GI_OPT_IN__` is a build-time define (see ../vite.config.ts). The control run flips it
// to `false` and changes NOTHING else: same bundle shape, same APK, same payload in
// `lib/<abi>/` and `assets/app/girepository-1.0/`. What the two runs compare is therefore the
// DECISION, not the presence of the plugin — which is the claim stage 4 makes about it.
//
// The static `@gjsify/node-gi/gi` import is deliberate. Under Vite the `nativescript` resolve
// condition routes node-gi's `#host` to `host.nativescript.js`, which reaches the addon through
// the NS module loader rather than through Node's `process.dlopen`; nothing is dynamic about it
// and nothing should be, because an import that can be elided is an import whose failure is
// deferred past the point where the message still means something.
import requireGi from '@gjsify/node-gi/gi';
import { useRealGObjectEngine } from '@gjsify/adwaita-gobject-native';

/** What the engine spec reports against — the same constant the specs branch on. */
export const optedIn: boolean = __GJSIFY_GI_OPT_IN__;

/**
 * The error a failed opt-in produced, or `null`. Read by `app/app.ts`, which then reports it as
 * ONE failed case and runs no vectors at all.
 *
 * Why it is recorded rather than rethrown: a throw out of this module body kills the whole
 * module graph, so the run produces no markers and the harness can only say "the app crashed
 * at startup" — the message naming the missing ABI or typelib stays buried in logcat. Why it is
 * not simply ignored: the pure-JS engine would then back the subset, every GObject vector would
 * PASS exactly as it does on pure JS, and the run would report success for a measurement that
 * never happened. That silent fallback is the thing ADR 0105 refuses, and it is refused here
 * too — just with a parseable failure instead of a dead app.
 */
export let optInError: unknown = null;

if (optedIn) {
    try {
        useRealGObjectEngine(requireGi);
    } catch (error) {
        optInError = error;
    }
}

export { requireGi };
