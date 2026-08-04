// Gamepad backend availability — the ONE place this package decides whether a
// gamepad backend exists on this host, and the ONE place a failed load is
// CLASSIFIED.
//
// It lives here rather than inside `GamepadManager` because the answer must be
// obtainable WITHOUT constructing a monitor: `hasGamepadBackend()` is a platform
// capability query, and a caller asking it should not have to start listening
// for devices. Both callers go through the same cached probe, so they cannot
// disagree ABOUT THE PROBE — which is all the cache buys. It is NOT a promise
// that a monitor came up: `manette_monitor_new()`, the device walk and the
// signal wiring all run AFTER the probe and can each fail on their own (no udev
// or `/dev/input` access in a sandbox, any other GError). That failure is a
// different failure and gets its own report, {@link reportGamepadMonitorFault},
// instead of being folded into the load-time one. Like `hasNativeSab()` and
// `hasOcspSupport()`, `hasGamepadBackend()` says the BRIDGE is usable — not that
// every later call succeeds.
//
// ## The diagnostic belongs to the USE, not to the QUERY
//
// `@gjsify/webcrypto/random` is the exemplar: `isSecureRandomSource()` is a pure
// predicate that prints nothing, and the warning fires from `fillRandomBytes()`
// — the OPERATION whose result is affected. Same split here. `hasGamepadBackend()`
// is silent, because the recommended usage is to CALL it and a caller doing the
// right thing must not be punished with an unsuppressable stderr line on every
// macOS/Windows start. The one-time message is emitted by `GamepadManager._init()`
// — the code that actually wanted a monitor — through
// {@link reportGamepadBackendOnce}. This module classifies and CARRIES the text;
// it never prints.
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
// back into the guard where it can be classified — and a MISSING BRIDGE is
// classified as "no backend here", not as a host fault: see
// {@link NODE_GI_BRIDGE}.

import type Manette from '@girs/manette-0.2';

/** The GI namespace this package binds; every wording below is scoped to it. */
const GI_NAMESPACE = 'Manette';

/**
 * What this host has.
 *
 * - `manette` — the Manette-0.2 typelib loaded and exposes `Monitor`.
 * - `absent`  — no backend reachable from here. Expected on a host without
 *   libmanette, on a `--app node` process without `@gjsify/node-gi`, and on the
 *   two targets where `gi://` is stubbed by design.
 * - `failed`  — a backend should have been reachable and was not. A fault.
 */
export type GamepadBackendStatus = 'manette' | 'absent' | 'failed';

/** The resolved backend probe. `module` is non-null iff `status === 'manette'`. */
export interface GamepadBackend {
    status: GamepadBackendStatus;
    module: typeof Manette | null;
    /** The original load error for `absent`/`failed`; `null` otherwise. */
    error: unknown;
    /**
     * The one-time line the USE site emits for this outcome, or `null` when
     * there is nothing to say. Carried rather than printed so the capability
     * query stays silent — see the module header.
     *
     * `status: 'absent'` with a `null` diagnostic is the by-design `gi://` stub
     * (see {@link isEmptiedGiModule}); `status: 'failed'` always prints, with
     * the original error, and needs no text here.
     */
    diagnostic: string | null;
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

/** Absent-vs-fault plus the text the use site should print (`null` = silence). */
interface GiLoadDiagnosis {
    status: 'absent' | 'failed';
    diagnostic: string | null;
}

/**
 * GI's wording for "there is no typelib for this namespace anywhere", scoped to
 * one namespace.
 *
 * MEASURED, not guessed — gjs 1.88.1 on Fedora 44, with `Manette-0.2.typelib`
 * hidden from `girepository-1.0/` (bwrap bind-mount over the directory):
 *
 *     Error: Requiring Manette, version none: Typelib file for namespace
 *     'Manette' (any version) not found
 *
 * Neither loader hands the structured error to JS: the thrown object is a plain
 * `Error` whose own properties are `fileName`/`lineNumber`/`columnNumber`/
 * `message` — no `domain`, no `code` — and `@gjsify/node-gi`'s
 * `requireNamespace()` re-wraps `error->message` into a `Napi::Error` string.
 * The message is the only signal BOTH loaders preserve, and the substring below
 * is GI's own template (`Typelib file for namespace '%s' …`, verified present in
 * `libgirepository-2.0.so.0`), not GJS's `Requiring Manette, version none: …`
 * framing nor node-gi's `Failed to require Manette: …` framing — which is what
 * lets one test serve both targets.
 *
 * It names the namespace on purpose: `… for namespace 'GObject' …` is a missing
 * DEPENDENCY — a broken install, not an absent backend — and must stay loud.
 *
 * The classification defaults to `failed`; only these wordings are quiet. That
 * direction is deliberate (a rewording upstream gives a loud fault on a host
 * that merely has no libmanette — noisy and fixable, where the other direction
 * restores the silent wrong answer this module exists to remove), and it is not
 * left to hope: `backend.spec.ts` asks the LIVE loader for a namespace that
 * cannot exist and asserts the classification, so a rewording FAILS a test
 * instead of silently reclassifying every backend-less host.
 */
function typelibAbsentNeedle(namespace: string): string {
    return `Typelib file for namespace '${namespace}'`;
}

/**
 * The reverse bridge a `--app node` bundle reaches `gi://` through.
 *
 * `@gjsify/node-gi` may NOT be a hard dependency (ADR 0005), and this package's
 * `node` slot is `partial` — a plain-Node consumer is EXPECTED not to have the
 * bridge, which is precisely the case `giNodeShimSource()`'s lazy `require()`
 * exists to keep harmless. So "no bridge in this process" is "no backend here",
 * the same class as "no libmanette on this OS", and reporting it as a host fault
 * would punish the supported configuration. Measured on an emitted `--app node`
 * bundle with the bridge absent:
 *
 *     Error: Cannot find module '@gjsify/node-gi/gi'   (code MODULE_NOT_FOUND)
 *
 * The advice differs from the libmanette one, so the two share `absent` but not
 * their text.
 */
const NODE_GI_BRIDGE = '@gjsify/node-gi';

/** No backend on this host — expected, but never silent. Says what to install. */
function noTypelibText(namespace: string): string {
    return (
        `[@gjsify/gamepad] No gamepad backend on this host — the ${namespace}-0.2 typelib is absent, so ` +
        'getGamepads() reports no controllers no matter what is plugged in. ' +
        'Install libmanette + its typelib (Fedora: libmanette; Debian/Ubuntu: gir1.2-manette-0.2); ' +
        'macOS and Windows have no libmanette at all. Gate on hasGamepadBackend().'
    );
}

/** No bridge in this process — expected on plain Node. Says what to install. */
function noBridgeText(): string {
    return (
        `[@gjsify/gamepad] No gamepad backend in this process — ${NODE_GI_BRIDGE} is not installed, and it is how ` +
        `a --app node bundle reaches gi://${GI_NAMESPACE}. getGamepads() reports no controllers until it is added ` +
        `(npm install ${NODE_GI_BRIDGE}, plus libmanette + its typelib). Gate on hasGamepadBackend().`
    );
}

/**
 * The backend is there in principle but did not come up. A FAULT, not a platform
 * gap — reported at `error` level to keep the two apart, and carrying the
 * original so the actual GI/GLib/loader message is not lost.
 *
 * The wording deliberately does not claim "the typelib is installed": the same
 * path covers a typelib whose shared library will not `dlopen`, a version
 * conflict and an ABI skew. Every one of those is a setup problem whose fix is
 * in the error it carries, and none of them is "this OS has no libmanette".
 */
const LOAD_FAULT_TEXT =
    `[@gjsify/gamepad] The gi://${GI_NAMESPACE} gamepad backend failed to load — a fault on this host, ` +
    'NOT a platform without libmanette. getGamepads() reports no controllers until it is fixed.';

/**
 * The cached probe. One per process; `_resetGamepadBackendCache()` is the only
 * way to run it again, and a test clearing it WANTS to observe the diagnostic
 * again — hence {@link reported} is cleared with it.
 */
let cached: Promise<GamepadBackend> | null = null;

/**
 * Whether the one-time load diagnostic has been emitted.
 *
 * A separate flag is load-bearing now that the message fires from the USE and
 * not from the probe: every `GamepadManager` init — including the re-init after
 * `dispose()`, and a second manager instance — reads the same cached probe and
 * would otherwise repeat the line. This is exactly `warnedInsecure` in
 * `@gjsify/webcrypto/random`.
 */
let reported = false;

/**
 * Whether the resolved `gi://` module is the build's DELIBERATE empty stub.
 *
 * `--app browser` and `--app nativescript` map every `gi://*` specifier to
 * `export {}; export default {};` BY DESIGN (`gjsImportsEmptyPlugin` in
 * `@gjsify/rolldown-plugin-gjsify`) — there is no GI on those targets. An empty
 * namespace there is therefore not a broken host, and calling it a fault is the
 * original defect INVERTED. On both targets this package declares
 * `runtimes.<target>: "native"`: the REAL implementation is the runtime's own
 * `navigator.getGamepads`, the root entry routes to `globals.mjs` (whose
 * `hasGamepadBackend()` answers from that native surface), and
 * `@gjsify/gamepad/register` leaves an existing `navigator.getGamepads` alone.
 * Nothing to install, nothing to fix ⇒ nothing to say.
 *
 * MEASURED (gjs 1.88.1) — the three shapes a `gi://Manette` default export can
 * have are all distinguishable:
 *
 * - the stub: `{}` — 0 own property names, prototype `Object.prototype`.
 * - a real GJS namespace: 16 own property names EAGERLY (`Device`, `Monitor`,
 *   `MAJOR_VERSION`, …), prototype is NOT `Object.prototype`
 *   (`[object GIRepositoryNamespace]`). So a namespace that loaded but lacks
 *   `Monitor` (an ABI skew) still fails this test and stays a fault.
 * - node-gi's shim: a `Proxy` over `Object.create(null)` (prototype `null`),
 *   whose `get` trap throws when the bridge or the typelib is missing — those
 *   are classified from the thrown error, before this check is reached.
 */
function isEmptiedGiModule(module: unknown): boolean {
    return (
        typeof module === 'object' &&
        module !== null &&
        Object.getPrototypeOf(module) === Object.prototype &&
        Object.getOwnPropertyNames(module).length === 0
    );
}

/** Whether the error is "the node-gi bridge is not installed in this process". */
function isMissingNodeGiBridge(error: unknown, message: string): boolean {
    if (!message.includes(NODE_GI_BRIDGE)) return false;
    // A module-RESOLUTION failure, not any failure that happens to name the
    // bridge: node-gi crashing while loading a real typelib is still a fault.
    const code = (error as { code?: unknown } | null | undefined)?.code;
    return code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND' || message.includes('Cannot find module');
}

/**
 * Classify a `gi://` load failure and pick the text for it.
 *
 * Exported (underscored) for `backend.spec.ts`, which pins the absent wording
 * against the LIVE loader — that is why the namespace is a parameter and not
 * hardcoded: the test asks for a namespace that cannot exist and classifies the
 * error the running GJS/girepository actually produced for it.
 */
export function _diagnoseGiLoadError(error: unknown, namespace: string = GI_NAMESPACE): GiLoadDiagnosis {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(typelibAbsentNeedle(namespace))) {
        return { status: 'absent', diagnostic: noTypelibText(namespace) };
    }
    if (isMissingNodeGiBridge(error, message)) {
        return { status: 'absent', diagnostic: noBridgeText() };
    }
    return { status: 'failed', diagnostic: null };
}

async function probeGamepadBackend(options: LoadGamepadBackendOptions): Promise<GamepadBackend> {
    // The specifier is a LITERAL and not built from `GI_NAMESPACE`: every plugin
    // that claims `gi://*` (`gjsGiNodePlugin`, `gjsImportsEmptyPlugin`, the
    // `--app gjs` externals predicate) matches on the resolved specifier at build
    // time, so a template literal would leave the import unclaimed on all four
    // targets. `GI_NAMESPACE` is for the wordings, which are runtime data.
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
            if (isEmptiedGiModule(module)) {
                return { status: 'absent', module: null, error: null, diagnostic: null };
            }
            const error = new Error(
                `gi://${GI_NAMESPACE} resolved without a Monitor class — unexpected ${GI_NAMESPACE} ABI`,
            );
            return { status: 'failed', module: null, error, diagnostic: null };
        }
    } catch (error) {
        // The one operation here that genuinely fails per host: GI resolving a
        // typelib that may not exist (absent), may not load (fault), or may be
        // out of reach because the node-gi bridge is not installed (absent).
        const { status, diagnostic } = _diagnoseGiLoadError(error);
        return { status, module: null, error, diagnostic };
    }

    return { status: 'manette', module, error: null, diagnostic: null };
}

/**
 * Resolve (once) which gamepad backend this host has. Emits NOTHING — see the
 * module header on why the diagnostic belongs to the use site.
 *
 * The probe runs at most once per process. Passing `importer` after it has run
 * is a test-setup bug and THROWS rather than being silently ignored: the old
 * `cached ??= probe(options)` let a suite that forgot `_resetGamepadBackendCache()`
 * assert against the PREVIOUS test's injected module and pass.
 */
export function loadGamepadBackend(options: LoadGamepadBackendOptions = {}): Promise<GamepadBackend> {
    if (cached !== null) {
        if (options.importer) {
            throw new Error(
                'loadGamepadBackend({ importer }) called after the probe already ran — the probe is cached per ' +
                    'process, so the importer would be ignored. Call _resetGamepadBackendCache() first (tests only).',
            );
        }
        return cached;
    }
    cached = probeGamepadBackend(options);
    return cached;
}

/**
 * Emit this backend's one-time diagnostic — called by the USE site
 * (`GamepadManager._init()`), never by the capability query.
 *
 * `absent` warns (a platform gap, expected, but never silent) and `failed`
 * errors with the original attached: two levels for two situations, which is
 * what makes the split visible rather than merely present. Deliberately not a
 * rethrow — `GamepadManager` starts its init without awaiting it, so a rethrow
 * becomes an unhandled rejection: unattributable on GJS and, with Node's default
 * `--unhandled-rejections=throw`, a process kill. A half-installed typelib must
 * not be able to take down the host application.
 */
export function reportGamepadBackendOnce(backend: GamepadBackend): void {
    if (reported) return;
    if (backend.status === 'failed') {
        reported = true;
        console.error(LOAD_FAULT_TEXT, backend.error);
        return;
    }
    // Nothing to say (a healthy backend, or the by-design `gi://` stub). The
    // flag stays down on purpose: it records that a MESSAGE was emitted, and
    // flipping it here would be a suppressor for a message that never existed.
    if (backend.diagnostic === null) return;
    reported = true;
    console.warn(backend.diagnostic);
}

/**
 * The backend loaded and then the monitor did not come up.
 *
 * A DIFFERENT failure from a failed load, and it says so: everything after the
 * probe — `new Manette.Monitor()`, the device walk, `connect()` — needs udev and
 * `/dev/input`, which a sandbox can withhold from a process whose typelib and
 * shared library are both perfectly fine. Routing it through the load-failure
 * text would re-create, one layer up, exactly the conflation this module removed.
 */
export function reportGamepadMonitorFault(error: unknown): void {
    console.error(
        `[@gjsify/gamepad] The gi://${GI_NAMESPACE} backend loaded but the gamepad monitor could not be started — ` +
            'a fault AFTER the backend was available, not a missing backend. Manette.Monitor needs udev and ' +
            '/dev/input access, which a sandbox can withhold (flatpak: --device=input). ' +
            'getGamepads() reports no controllers until it is fixed.',
        error,
    );
}

/**
 * Whether this host has a gamepad backend at all.
 *
 * `false` means `navigator.getGamepads()` can never report a controller here, no
 * matter what is connected — which the W3C surface itself cannot express (it
 * returns the same list either way, and that is correct: see
 * `GamepadManager.getGamepads()`). Answerable without constructing a monitor or
 * plugging anything in, and QUIET: the diagnostic fires from the use, not from
 * this question.
 *
 * It is `false` on every host without libmanette, which today means macOS and
 * Windows: libmanette links libevdev unconditionally, and libevdev is
 * Linux/FreeBSD-only. Like `hasNativeSab()` and `hasOcspSupport()` this reports
 * that the BRIDGE is usable, not that every later call will succeed — a monitor
 * can still fail to start (see {@link reportGamepadMonitorFault}).
 */
export async function hasGamepadBackend(): Promise<boolean> {
    return (await loadGamepadBackend()).status === 'manette';
}

/** Reset the cached probe and its one-time diagnostic — tests only. */
export function _resetGamepadBackendCache(): void {
    cached = null;
    reported = false;
}
