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
// Two backends, one per host family (ADR 0075 + Amendment 1): `gi://GjsifyGamepad`, the
// SDL3 shim in `@gjsify/gamepad-native`, on darwin; `gi://Manette` everywhere else until
// the SDL source is proven on Linux and replaces it there too.
//
// The load failure is split in two because a host WITHOUT the backend (no libmanette; no
// gamepad-native prebuild for this target) and a host with a BROKEN install are different
// situations. Only the first is expected; the second must be loud.
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
import { hostOs, type TargetOs } from '@gjsify/utils/core';

import type { GjsifyGamepadNamespace } from './sdl-namespace.js';
import type { GamepadSource } from './source.js';

/**
 * What this host has.
 *
 * - `manette` — the Manette-0.2 typelib loaded and exposes `Monitor`.
 * - `sdl`     — the GjsifyGamepad-1.0 typelib (`@gjsify/gamepad-native`) loaded and
 *   exposes `Monitor`.
 * - `absent`  — no backend reachable from here: no libmanette, no gamepad-native
 *   prebuild, a `--app node` process without `@gjsify/node-gi`, or a target where
 *   `gi://` is stubbed by design.
 * - `failed`  — a backend should have been reachable and was not. A fault.
 */
export type GamepadBackendStatus = 'manette' | 'sdl' | 'absent' | 'failed';

/** What every probe result carries besides the module. */
interface GamepadBackendReport {
    /** The original load error for `absent`/`failed`; `null` otherwise. */
    error: unknown;
    /**
     * The one-time line the USE site emits, or `null` when there is nothing to say.
     * Carried rather than printed so the capability query stays silent. `'absent'`
     * with a `null` diagnostic is the by-design `gi://` stub (see
     * {@link isEmptiedGiModule}).
     */
    diagnostic: string | null;
}

/** The resolved backend probe: a module exactly for the two usable states. */
export type GamepadBackend = GamepadBackendReport &
    (
        | { status: 'manette'; module: typeof Manette }
        | { status: 'sdl'; module: GjsifyGamepadNamespace }
        | { status: 'absent' | 'failed'; module: null }
    );

export interface LoadGamepadBackendOptions {
    /**
     * Override the `gi://Manette` import. Tests only — the single seam that exercises the
     * absent and failed paths on a host where libmanette IS installed, which is every CI
     * runner this package is tested on.
     */
    importer?: () => Promise<{ default: typeof Manette }>;
    /** Override the darwin branch's `gi://GjsifyGamepad` import. Tests only. */
    sdlImporter?: () => Promise<{ default: GjsifyGamepadNamespace }>;
    /**
     * Override the host OS the probe branches on. Tests only — it is how the darwin
     * branch is exercised on a Linux runner and the Manette branch on a Mac.
     */
    hostOs?: () => TargetOs | undefined;
}

/**
 * One `gi://` backend: its namespace, which every wording is scoped to, and its three
 * texts. Exported (underscored) for `backend.spec.ts`.
 */
export interface _GiBackend {
    status: 'manette' | 'sdl';
    namespace: string;
    /** No typelib for {@link namespace} on this host: what to install. */
    noTypelibText: string;
    /** No `@gjsify/node-gi` in a `--app node` process: what to install. */
    noBridgeText: string;
    /** The load is a fault: said at `error` level, next to the original error. */
    loadFaultText: string;
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

/**
 * A FAULT, not a platform gap — `error` level, carrying the original so the GI/GLib/loader
 * message is not lost. The wording deliberately does not claim "the typelib is
 * installed": the same path covers a shared library that will not `dlopen`, a version
 * conflict and an ABI skew.
 */
function loadFaultText(namespace: string, absentCause: string): string {
    return (
        `[@gjsify/gamepad] The gi://${namespace} gamepad backend failed to load — a fault on this host, ` +
        `NOT ${absentCause}. getGamepads() reports no controllers until it is fixed.`
    );
}

/** libmanette 0.2 — every host except darwin, until Amendment 1's Linux comparison. */
const MANETTE_BACKEND: _GiBackend = {
    status: 'manette',
    namespace: 'Manette',
    noTypelibText:
        '[@gjsify/gamepad] No gamepad backend on this host — the Manette-0.2 typelib is absent, so ' +
        'getGamepads() reports no controllers no matter what is plugged in. ' +
        'Install libmanette + its typelib (Fedora: libmanette; Debian/Ubuntu: gir1.2-manette-0.2); ' +
        'Windows has no libmanette at all. Gate on hasGamepadBackend().',
    noBridgeText:
        `[@gjsify/gamepad] No gamepad backend in this process — ${NODE_GI_BRIDGE} is not installed, and it is how ` +
        'a --app node bundle reaches gi://Manette. getGamepads() reports no controllers until it is added ' +
        `(npm install ${NODE_GI_BRIDGE}, plus libmanette + its typelib). Gate on hasGamepadBackend().`,
    loadFaultText: loadFaultText('Manette', 'a platform without libmanette'),
};

/**
 * The SDL3 shim — darwin (ADR 0075). Its typelib and library arrive as the per-target
 * `@gjsify/gamepad-native-<os>-<arch>` optional dependency, and a GJS process finds them
 * through the launcher's `GI_TYPELIB_PATH` (`gjsify run`), so "absent" means one of those
 * two did not happen and the text names both. Never the libmanette advice: there is no
 * libmanette for macOS, and a search for one finds nothing.
 */
const SDL_BACKEND: _GiBackend = {
    status: 'sdl',
    namespace: 'GjsifyGamepad',
    noTypelibText:
        '[@gjsify/gamepad] No gamepad backend on this host — the GjsifyGamepad-1.0 typelib of ' +
        '@gjsify/gamepad-native is not on the typelib path, so getGamepads() reports no controllers no matter ' +
        'what is plugged in. It ships as the optional dependency @gjsify/gamepad-native-<os>-<arch>: check that ' +
        'it installed, and start the program through `gjsify run` (or put its prebuilds/<os>-<arch> directory ' +
        'on GI_TYPELIB_PATH). Gate on hasGamepadBackend().',
    noBridgeText:
        `[@gjsify/gamepad] No gamepad backend in this process — ${NODE_GI_BRIDGE} is not installed, and it is how ` +
        'a --app node bundle reaches gi://GjsifyGamepad. getGamepads() reports no controllers until it is added ' +
        `(npm install ${NODE_GI_BRIDGE}). Gate on hasGamepadBackend().`,
    loadFaultText: loadFaultText('GjsifyGamepad', 'a host without @gjsify/gamepad-native'),
};

/** Both backends, for `backend.spec.ts`; the probe itself picks one by host OS. */
export const _GI_BACKENDS = { manette: MANETTE_BACKEND, sdl: SDL_BACKEND } as const;

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
 * backend parameter: the test asks for a namespace that cannot exist and classifies the
 * error the running GJS/girepository produced for it.
 */
export function _diagnoseGiLoadError(error: unknown, backend: _GiBackend = MANETTE_BACKEND): GiLoadDiagnosis {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(typelibAbsentNeedle(backend.namespace))) {
        return { status: 'absent', diagnostic: backend.noTypelibText };
    }
    if (isMissingNodeGiBridge(error, message)) {
        return { status: 'absent', diagnostic: backend.noBridgeText };
    }
    return { status: 'failed', diagnostic: backend.loadFaultText };
}

/** What a `gi://` backend import resolves to; both namespaces expose `Monitor`. */
type GiBackendModule = typeof Manette | GjsifyGamepadNamespace;

/**
 * Load one `gi://` backend and classify the outcome. One path for both namespaces: the
 * absent/fault split, the node-gi member-access guard and the build-time stub are
 * properties of `gi://`, not of either library.
 */
async function probeGi(
    backend: _GiBackend,
    importer: () => Promise<{ default: GiBackendModule }>,
): Promise<GamepadBackend> {
    let module: GiBackendModule;
    try {
        module = (await importer()).default;
        // Resolve a member INSIDE the guard — see the node-gi parity note in the module
        // header. It also turns "typelib loaded but carries no Monitor" (an ABI skew)
        // into a classified fault instead of a TypeError at the first getGamepads().
        if (typeof module?.Monitor !== 'function') {
            if (isEmptiedGiModule(module)) {
                return { status: 'absent', module: null, error: null, diagnostic: null };
            }
            const error = new Error(
                `gi://${backend.namespace} resolved without a Monitor class — unexpected ${backend.namespace} ABI`,
            );
            return { status: 'failed', module: null, error, diagnostic: backend.loadFaultText };
        }
    } catch (error) {
        // The one operation that genuinely fails per host: GI resolving a typelib that may
        // not exist (absent), may not load (fault), or is out of reach because the node-gi
        // bridge is not installed (absent).
        const { status, diagnostic } = _diagnoseGiLoadError(error, backend);
        return { status, module: null, error, diagnostic };
    }

    return backend.status === 'sdl'
        ? { status: 'sdl', module: module as GjsifyGamepadNamespace, error: null, diagnostic: null }
        : { status: 'manette', module: module as typeof Manette, error: null, diagnostic: null };
}

async function probeGamepadBackend(options: LoadGamepadBackendOptions): Promise<GamepadBackend> {
    // THE PLATFORM BRANCH (ADR 0075). darwin never probes `gi://Manette`: that typelib
    // cannot exist there, so the import could only fail, and its text would send the
    // reader to a Linux package manager. It probes the SDL3 shim instead, and a host
    // without the shim's prebuild answers an honest `absent` — never a stand-in that
    // reports success with zero devices: `hasGamepadBackend()` must stay `false` where
    // nothing can read a controller.
    //
    // An UNKNOWN host (`undefined`: no `process` global to ask) keeps the Manette probe,
    // which classifies itself from the loader's own error — never assume "not darwin".
    //
    // The specifiers are LITERALS: every plugin that claims `gi://*` (`gjsGiNodePlugin`,
    // `gjsImportsEmptyPlugin`, the `--app gjs` externals predicate) matches the resolved
    // specifier at BUILD time, so a template literal would leave the import unclaimed on
    // all four targets.
    const os = (options.hostOs ?? hostOs)();
    if (os === 'darwin') {
        return probeGi(
            SDL_BACKEND,
            options.sdlImporter ??
                (() => import('gi://GjsifyGamepad?version=1.0') as Promise<{ default: GjsifyGamepadNamespace }>),
        );
    }
    return probeGi(
        MANETTE_BACKEND,
        options.importer ?? (() => import('gi://Manette?version=0.2') as Promise<{ default: typeof Manette }>),
    );
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
        if (options.importer || options.sdlImporter || options.hostOs) {
            throw new Error(
                'loadGamepadBackend({ importer, sdlImporter, hostOs }) called after the probe already ran — the probe is cached per ' +
                    'process, so the override would be ignored. Call _resetGamepadBackendCache() first (tests only).',
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
        console.error(backend.diagnostic, backend.error);
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
 * The backend loaded and then its device source did not come up — a DIFFERENT failure
 * from a failed load: everything after the probe (`new Manette.Monitor()`, the device
 * walk, `connect()`) needs udev and `/dev/input`, which a sandbox can withhold from a
 * process whose typelib and shared library are both fine. Routing it through the
 * load-failure text would re-create the same conflation one layer up.
 *
 * The advice comes from the SOURCE (`startRequirements`), because it is per backend:
 * udev is the right hint for Manette and the wrong one for anything else.
 */
export function reportGamepadMonitorFault(error: unknown, source: GamepadSource | null = null): void {
    const name = source?.name ?? 'gamepad';
    const requirements = source?.startRequirements ? `${source.startRequirements} ` : '';
    console.error(
        `[@gjsify/gamepad] The ${name} backend loaded but the gamepad monitor could not be started — ` +
            'a fault AFTER the backend was available, not a missing backend. ' +
            requirements +
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
 * `false` on Windows (libmanette links libevdev, which is Linux/FreeBSD-only, and the
 * SDL3 shim has no win32 leg yet), on Linux without libmanette, and on macOS without the
 * `@gjsify/gamepad-native` prebuild. Reports that the BRIDGE is usable, not that every
 * later call succeeds — a monitor can still fail to start (see
 * {@link reportGamepadMonitorFault}).
 */
export async function hasGamepadBackend(): Promise<boolean> {
    const { status } = await loadGamepadBackend();
    return status === 'manette' || status === 'sdl';
}

/** Reset the cached probe and its one-time diagnostic — tests only. */
export function _resetGamepadBackendCache(): void {
    cached = null;
    reported = false;
}
