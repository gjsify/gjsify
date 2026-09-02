// Gamepad backend availability — the ONE place this package decides whether a gamepad
// backend exists on this host, and the ONE place a failed load is CLASSIFIED.
//
// It is separate from `GamepadManager` because the answer must be obtainable WITHOUT
// constructing a monitor: `hasGamepadBackend()` is a platform capability query. Like
// `hasNativeSab()`/`hasOcspSupport()` it says the BRIDGE is usable, not that every later
// call succeeds — `manette_monitor_new()`, the device walk and the signal wiring all run
// AFTER the probe and get their own report, {@link reportGamepadMonitorFault}.
//
// THE DIAGNOSTIC BELONGS TO THE USE, NOT THE QUERY, as in `@gjsify/webcrypto/random`
// (silent `isSecureRandomSource()`, warning from `fillRandomBytes()`): the recommended
// usage is to CALL `hasGamepadBackend()`, and a caller doing the right thing must not be
// punished with an unsuppressable stderr line on every macOS/Windows start. This module
// classifies and CARRIES the text; `GamepadManager._init()` prints it through
// {@link reportGamepadBackendOnce}.
//
// The load failure is split in two because a host with no libmanette (macOS, Windows:
// libmanette hard-requires libevdev, which is Linux/FreeBSD-only) and a host with a
// BROKEN install are different situations. Only the first is expected; the second must be
// loud.
//
// node-gi parity: the package declares `node: "partial"` and the same `gi://Manette`
// import runs under `@gjsify/node-gi`, which cannot be classified by watching the IMPORT
// alone. `--app node` rewrites the specifier to a virtual module whose default export is
// a lazy Proxy (`giNodeShimSource()` in `@gjsify/rolldown-plugin-gjsify`) and the
// `requireGi('Manette')` happens on the first PROPERTY ACCESS, so the import ALWAYS
// resolves and a try/catch around it is a no-op there — the failure lands on
// `new Manette.Monitor()` inside a promise nobody awaits, i.e. an unhandled rejection,
// fatal by default on Node. So the probe RESOLVES A MEMBER (`Monitor`) inside its own
// guard: free on GJS, and on Node the only way to get the fault back where it can be
// classified. A MISSING BRIDGE is "no backend here", not a host fault — see
// {@link NODE_GI_BRIDGE}.

import type Manette from '@girs/manette-0.2';

/** The GI namespace this package binds; every wording below is scoped to it. */
const GI_NAMESPACE = 'Manette';

/**
 * What this host has.
 *
 * - `manette` — the Manette-0.2 typelib loaded and exposes `Monitor`.
 * - `absent`  — no backend reachable from here: no libmanette, a `--app node` process
 *   without `@gjsify/node-gi`, or a target where `gi://` is stubbed by design.
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
     * The one-time line the USE site emits, or `null` when there is nothing to say.
     * Carried rather than printed so the capability query stays silent.
     *
     * `'absent'` with a `null` diagnostic is the by-design `gi://` stub (see
     * {@link isEmptiedGiModule}); `'failed'` always prints, with the original error, and
     * needs no text here.
     */
    diagnostic: string | null;
}

export interface LoadGamepadBackendOptions {
    /**
     * Override the `gi://Manette` import. Tests only — the single seam that exercises the
     * absent and failed paths on a host where libmanette IS installed, which is every CI
     * runner this package is tested on.
     */
    importer?: () => Promise<{ default: typeof Manette }>;
}

/** Absent-vs-fault plus the text the use site should print (`null` = silence). */
interface GiLoadDiagnosis {
    status: 'absent' | 'failed';
    diagnostic: string | null;
}

/**
 * GI's wording for "there is no typelib for this namespace anywhere", scoped to one
 * namespace. MEASURED on gjs 1.88.1 / Fedora 44 with `Manette-0.2.typelib` hidden from
 * `girepository-1.0/`:
 *
 *     Error: Requiring Manette, version none: Typelib file for namespace
 *     'Manette' (any version) not found
 *
 * The MESSAGE is the only signal both loaders preserve — neither hands the structured
 * error to JS (no `domain`, no `code`; node-gi re-wraps `error->message` into a
 * `Napi::Error` string) — and the substring is GI's own template, not GJS's
 * `Requiring …:` nor node-gi's `Failed to require …:` framing, which is what lets one
 * test serve both targets.
 *
 * It names the namespace on purpose: `… for namespace 'GObject' …` is a missing
 * DEPENDENCY, a broken install rather than an absent backend, and must stay loud.
 *
 * The classification defaults to `failed`; only these wordings are quiet, so an upstream
 * rewording yields a noisy-but-fixable fault instead of restoring the silent wrong answer
 * this module exists to remove. `backend.spec.ts` asks the LIVE loader for a namespace
 * that cannot exist, so a rewording FAILS a test.
 */
function typelibAbsentNeedle(namespace: string): string {
    return `Typelib file for namespace '${namespace}'`;
}

/**
 * The reverse bridge a `--app node` bundle reaches `gi://` through.
 *
 * `@gjsify/node-gi` may NOT be a hard dependency (ADR 0005) and this package's `node`
 * slot is `partial`, so a plain-Node consumer is EXPECTED not to have it: "no bridge in
 * this process" is "no backend here", the same class as "no libmanette on this OS", and
 * calling it a host fault would punish the supported configuration. Measured on an
 * emitted `--app node` bundle with the bridge absent:
 *
 *     Error: Cannot find module '@gjsify/node-gi/gi'   (code MODULE_NOT_FOUND)
 *
 * The advice differs from the libmanette one, so the two share `absent` but not the text.
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
 * The backend is there in principle but did not come up. A FAULT, not a platform gap —
 * `error` level, carrying the original so the GI/GLib/loader message is not lost. The
 * wording deliberately does not claim "the typelib is installed": the same path covers a
 * shared library that will not `dlopen`, a version conflict and an ABI skew.
 */
const LOAD_FAULT_TEXT =
    `[@gjsify/gamepad] The gi://${GI_NAMESPACE} gamepad backend failed to load — a fault on this host, ` +
    'NOT a platform without libmanette. getGamepads() reports no controllers until it is fixed.';

/**
 * The cached probe, one per process. `_resetGamepadBackendCache()` is the only way to run
 * it again, and a test clearing it WANTS the diagnostic again — hence {@link reported} is
 * cleared with it.
 */
let cached: Promise<GamepadBackend> | null = null;

/**
 * Whether the one-time load diagnostic has been emitted. A separate flag because the
 * message fires from the USE, not the probe: every `GamepadManager` init — the re-init
 * after `dispose()`, a second instance — reads the same cached probe and would otherwise
 * repeat the line.
 */
let reported = false;

/**
 * Whether the resolved `gi://` module is the build's DELIBERATE empty stub.
 *
 * `--app browser` and `--app nativescript` map every `gi://*` specifier to
 * `export {}; export default {};` BY DESIGN (`gjsImportsEmptyPlugin` in
 * `@gjsify/rolldown-plugin-gjsify`), so an empty namespace there is not a broken host. On
 * both targets this package declares `runtimes.<target>: "native"`: the real
 * implementation is the runtime's own `navigator.getGamepads`, the root entry routes to
 * `globals.mjs`, and `@gjsify/gamepad/register` leaves an existing
 * `navigator.getGamepads` alone. Nothing to install ⇒ nothing to say.
 *
 * MEASURED (gjs 1.88.1) — the three shapes a `gi://Manette` default export can have are
 * all distinguishable:
 *
 * - the stub: `{}` — 0 own property names, prototype `Object.prototype`.
 * - a real GJS namespace: 16 own property names EAGERLY, prototype NOT
 *   `Object.prototype` (`[object GIRepositoryNamespace]`), so a namespace that loaded
 *   but lacks `Monitor` (an ABI skew) fails this test and stays a fault.
 * - node-gi's shim: a `Proxy` over `Object.create(null)` (prototype `null`) whose `get`
 *   trap throws when the bridge or typelib is missing — classified from the thrown
 *   error, before this check is reached.
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
 * Classify a `gi://` load failure and pick the text for it. Exported (underscored) for
 * `backend.spec.ts`, which pins the absent wording against the LIVE loader — hence the
 * namespace parameter: the test asks for a namespace that cannot exist and classifies the
 * error the running GJS/girepository produced for it.
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
    // The specifier is a LITERAL, not built from `GI_NAMESPACE`: every plugin that claims
    // `gi://*` (`gjsGiNodePlugin`, `gjsImportsEmptyPlugin`, the `--app gjs` externals
    // predicate) matches the resolved specifier at BUILD time, so a template literal
    // would leave the import unclaimed on all four targets.
    const importer =
        options.importer ?? (() => import('gi://Manette?version=0.2') as Promise<{ default: typeof Manette }>);

    let module: typeof Manette;
    try {
        const mod = await importer();
        module = mod.default;
        // Resolve a member INSIDE the guard — see the node-gi parity note in the module
        // header. It also turns "typelib loaded but carries no Monitor" (an ABI skew)
        // into a classified fault instead of a TypeError at the first getGamepads().
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
        // The one operation that genuinely fails per host: GI resolving a typelib that may
        // not exist (absent), may not load (fault), or is out of reach because the node-gi
        // bridge is not installed (absent).
        const { status, diagnostic } = _diagnoseGiLoadError(error);
        return { status, module: null, error, diagnostic };
    }

    return { status: 'manette', module, error: null, diagnostic: null };
}

/**
 * Resolve (once) which gamepad backend this host has. Emits NOTHING.
 *
 * Passing `importer` after the probe has run is a test-setup bug and THROWS rather than
 * being silently ignored: a `cached ??= probe(options)` let a suite that forgot
 * `_resetGamepadBackendCache()` assert against the PREVIOUS test's injected module and
 * pass.
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
 * `absent` warns (a platform gap: expected, but never silent) and `failed` errors with
 * the original attached — two levels for two situations. Deliberately NOT a rethrow:
 * `GamepadManager` starts its init without awaiting it, so a rethrow becomes an unhandled
 * rejection, unattributable on GJS and a process kill under Node's default
 * `--unhandled-rejections=throw`. A half-installed typelib must not take down the host
 * application.
 */
export function reportGamepadBackendOnce(backend: GamepadBackend): void {
    if (reported) return;
    if (backend.status === 'failed') {
        reported = true;
        console.error(LOAD_FAULT_TEXT, backend.error);
        return;
    }
    // Nothing to say (a healthy backend, or the by-design `gi://` stub). The flag stays
    // down on purpose: it records that a MESSAGE was emitted, and flipping it here would
    // suppress a message that never existed.
    if (backend.diagnostic === null) return;
    reported = true;
    console.warn(backend.diagnostic);
}

/**
 * The backend loaded and then the monitor did not come up — a DIFFERENT failure from a
 * failed load: everything after the probe (`new Manette.Monitor()`, the device walk,
 * `connect()`) needs udev and `/dev/input`, which a sandbox can withhold from a process
 * whose typelib and shared library are both fine. Routing it through the load-failure text
 * would re-create the same conflation one layer up.
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
 * `false` means `navigator.getGamepads()` can never report a controller here, no matter
 * what is connected — something the W3C surface itself cannot express, since it returns
 * the same list either way. Answerable without constructing a monitor, and QUIET.
 *
 * `false` on every host without libmanette, which today means macOS and Windows:
 * libmanette links libevdev unconditionally and libevdev is Linux/FreeBSD-only. Reports
 * that the BRIDGE is usable, not that every later call succeeds — a monitor can still fail
 * to start (see {@link reportGamepadMonitorFault}).
 */
export async function hasGamepadBackend(): Promise<boolean> {
    return (await loadGamepadBackend()).status === 'manette';
}

/** Reset the cached probe and its one-time diagnostic — tests only. */
export function _resetGamepadBackendCache(): void {
    cached = null;
    reported = false;
}
