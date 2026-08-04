// Gamepad backend availability — the ONE place this package decides whether a
// gamepad backend exists on this host, and the ONE place a failed load is
// CLASSIFIED.
//
// It lives here rather than inside `GamepadManager` because the answer must be
// obtainable WITHOUT constructing a monitor: `hasGamepadBackend()` is a platform
// capability query, and a caller asking it should not have to start listening
// for devices. Both callers go through the same cached probe, so the capability
// export cannot disagree with what the manager actually got.
//
// ## Why a capability export exists at all
//
// The W3C Gamepad API has no word for "this platform has no gamepad subsystem"
// (see the note on `GamepadManager.getGamepads()`), so the spec-conformant
// answer — an all-null list — is indistinguishable from "nothing is plugged in".
// That is the same shape `@gjsify/webcrypto`'s entropy chain had: Web Crypto
// says "returns random bytes" and has no word for "these are not
// cryptographic", so `@gjsify/webcrypto/random` added `isSecureRandomSource()`
// next to the conformant surface. `hasNativeSab()` and `hasOcspSupport()` are
// the same pattern for a native bridge. This is that export for gamepads:
// boolean, named `has*`, answerable on its own.
//
// ## Why the load failure is split in two
//
// The previous code caught EVERY failure of `import('gi://Manette')` and
// reported it as "no gamepads" — so a host with no libmanette (macOS, Windows:
// libmanette hard-requires libevdev, which is Linux/FreeBSD-only) and a host
// with a BROKEN libmanette install produced the identical silent empty answer.
// The second is a fault and must be loud; only the first is expected.
//
// ## node-gi parity
//
// The package declares `node: "partial"` and the same `gi://Manette` import runs
// under `@gjsify/node-gi`, so this module must classify identically there. It
// cannot do that by watching the IMPORT alone: `--app node` rewrites
// `gi://Manette` to a virtual module whose default export is a lazy Proxy
// (`giNodeShimSource()` in `@gjsify/rolldown-plugin-gjsify`), and the
// `requireGi('Manette')` call happens on the first PROPERTY ACCESS — so on Node
// the import ALWAYS resolves and the old try/catch was a no-op there. The
// failure then landed on `new Manette.Monitor()` inside a promise nobody awaits:
// an unhandled rejection, which on Node is fatal by default. So the probe
// RESOLVES A MEMBER (`Monitor`) inside its own guard. On GJS that is free (the
// namespace object is already materialised); on Node it is what moves the fault
// back into the guard where it can be classified. Measured on an emitted
// `--app node` bundle with `@gjsify/node-gi` absent: the probe now reports the
// fault with `Cannot find module '@gjsify/node-gi/gi'` attached instead of
// answering "no gamepads" — a missing BRIDGE is a setup fault, not an OS that
// has no libmanette, and only the latter is the quiet path.

import type Manette from '@girs/manette-0.2';

/**
 * What this host has.
 *
 * - `manette` — the Manette-0.2 typelib loaded and exposes `Monitor`.
 * - `absent`  — no such typelib. Expected on any host without libmanette.
 * - `failed`  — the typelib is there but did not load or is unusable. A fault.
 */
export type GamepadBackendStatus = 'manette' | 'absent' | 'failed';

/** The resolved backend probe. `module` is non-null iff `status === 'manette'`. */
export interface GamepadBackend {
    status: GamepadBackendStatus;
    module: typeof Manette | null;
    /** The original load error for `absent`/`failed`; `null` otherwise. */
    error: unknown;
}

export interface LoadGamepadBackendOptions {
    /**
     * Override the `gi://Manette` import.
     *
     * Only for tests — it is the single seam that lets a suite exercise the
     * absent and failed paths on a host where libmanette IS installed, which is
     * every CI runner this package is tested on. Same role as
     * `fillRandomBytes({ webcrypto })` in `@gjsify/webcrypto/random`.
     */
    importer?: () => Promise<{ default: typeof Manette }>;
}

/**
 * The GI wording that means "this host has no such typelib".
 *
 * Neither loader hands the structured error to JS. GI reports a missing typelib
 * as `GI_REPOSITORY_ERROR_TYPELIB_NOT_FOUND`, but GJS turns the `GError` into a
 * plain `Error` whose only own properties are
 * `fileName`/`lineNumber`/`columnNumber`/`message` (measured on gjs 1.88 —
 * no `domain`, no `code`), and `@gjsify/node-gi`'s `requireNamespace()` re-wraps
 * `error->message` into a `Napi::Error` string. The message is therefore the
 * only signal BOTH loaders preserve, and this substring is GI's own wording
 * (`girepository`), not GJS's `Requiring Manette, version none: …` framing nor
 * node-gi's `Failed to require Manette: …` framing — which is what lets one test
 * serve both.
 *
 * It names the namespace on purpose. GI emits `Typelib file for namespace
 * 'Manette' (any version) not found` when Manette itself is missing and
 * `… for namespace 'GObject' …` when a DEPENDENCY is missing — the latter is a
 * broken install, not an absent backend, and must stay loud.
 *
 * The classification defaults to `failed`: only this exact wording is quiet. If
 * upstream ever rewords it we get a loud fault on a host that simply has no
 * libmanette — noisy, and fixable. The other direction would put us back to a
 * silent wrong answer, which is the defect this module exists to remove.
 */
const TYPELIB_ABSENT = "Typelib file for namespace 'Manette'";

/**
 * The cached probe. One per process, which is also what makes the diagnostics
 * below fire exactly ONCE without a separate `warned` flag: `warnInsecureOnce()`
 * in `@gjsify/webcrypto/random` needs one because `fillRandomBytes()` re-runs
 * its chain on every call, whereas this probe cannot run twice unless a test
 * clears the cache — and a test clearing it WANTS to observe the message again.
 */
let cached: Promise<GamepadBackend> | null = null;

/** Absent vs. broken. See {@link TYPELIB_ABSENT} for why the message is the signal. */
function classifyLoadError(error: unknown): 'absent' | 'failed' {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes(TYPELIB_ABSENT) ? 'absent' : 'failed';
}

/** No backend on this host — expected, but never silent. Says what to install. */
function warnNoBackend(): void {
    console.warn(
        '[@gjsify/gamepad] No gamepad backend on this host — the Manette-0.2 typelib is absent, so ' +
            'getGamepads() reports no controllers no matter what is plugged in. ' +
            'Install libmanette + its typelib (Fedora: libmanette; Debian/Ubuntu: gir1.2-manette-0.2); ' +
            'macOS and Windows have no libmanette at all. Gate on hasGamepadBackend().',
    );
}

/**
 * The backend is there in principle but did not come up. A FAULT, not a platform
 * gap — reported at `error` level to keep the two apart, and carrying the
 * original so the actual GI/GLib/loader message is not lost.
 *
 * The wording deliberately does not claim "the typelib is installed": the same
 * path covers a typelib whose shared library will not `dlopen`, a version
 * conflict, an ABI skew, a `Manette.Monitor` that throws at construction, and —
 * on the node target — `@gjsify/node-gi` not being installed at all. Every one
 * of those is a setup problem whose fix is in the error it carries, and none of
 * them is "this OS has no libmanette".
 *
 * Deliberately NOT a rethrow. `GamepadManager` starts its init without awaiting
 * it (`getGamepads()` is synchronous — the W3C polling contract), so a rethrow
 * becomes an unhandled rejection: unattributable on GJS and, with Node's default
 * `--unhandled-rejections=throw`, a process kill. A half-installed typelib must
 * not be able to take down the host application, and an unhandled rejection is
 * not more visible than a named `console.error` anyway.
 */
export function reportGamepadBackendFault(error: unknown): void {
    console.error(
        '[@gjsify/gamepad] The gi://Manette gamepad backend failed to load — a fault on this host, ' +
            'NOT a platform without libmanette. getGamepads() reports no controllers until it is fixed.',
        error,
    );
}

async function probeGamepadBackend(options: LoadGamepadBackendOptions): Promise<GamepadBackend> {
    const importer = options.importer ?? (() => import('gi://Manette') as Promise<{ default: typeof Manette }>);

    let module: typeof Manette;
    try {
        const mod = await importer();
        module = mod.default;
        // Resolve a member INSIDE the guard — see the node-gi parity note in the
        // module header. Reading it also turns "typelib loaded but does not
        // carry Monitor" (an ABI/version skew) into a classified fault instead
        // of a TypeError at the first getGamepads().
        if (typeof module?.Monitor !== 'function') {
            const error = new Error('gi://Manette resolved without a Monitor class — unexpected Manette ABI');
            reportGamepadBackendFault(error);
            return { status: 'failed', module: null, error };
        }
    } catch (error) {
        // The one operation here that genuinely fails per host: GI resolving a
        // typelib that may not exist (absent) or may not load (fault).
        const status = classifyLoadError(error);
        if (status === 'absent') warnNoBackend();
        else reportGamepadBackendFault(error);
        return { status, module: null, error };
    }

    return { status: 'manette', module, error: null };
}

/**
 * Resolve (once) which gamepad backend this host has.
 *
 * The probe runs at most once per process; only the FIRST caller's `options`
 * apply. Diagnostics are emitted by that one probe — a second caller, and the
 * manager's re-init after `dispose()`, stay quiet.
 */
export function loadGamepadBackend(options: LoadGamepadBackendOptions = {}): Promise<GamepadBackend> {
    cached ??= probeGamepadBackend(options);
    return cached;
}

/**
 * Whether this host has a gamepad backend at all.
 *
 * `false` means `navigator.getGamepads()` can never report a controller here, no
 * matter what is connected — which the W3C surface itself cannot express (it
 * returns the same empty list either way, and that is correct: see
 * `GamepadManager.getGamepads()`). Answerable without constructing a monitor or
 * plugging anything in.
 *
 * It is `false` on every host without libmanette, which today means macOS and
 * Windows: libmanette links libevdev unconditionally, and libevdev is
 * Linux/FreeBSD-only. Like `hasNativeSab()` and `hasOcspSupport()` this reports
 * that the BRIDGE is usable, not that every later call will succeed.
 */
export async function hasGamepadBackend(): Promise<boolean> {
    return (await loadGamepadBackend()).status === 'manette';
}

/** Reset the cached probe — tests only. */
export function _resetGamepadBackendCache(): void {
    cached = null;
}
