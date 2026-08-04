// Coverage for the gamepad backend probe.
//
// The regression it pins: `import('gi://Manette')` sat in a try/catch whose catch
// reported EVERY failure as "no gamepads", so a host with no libmanette and a
// host with a broken libmanette produced the identical silent empty answer — and
// the README called that graceful degradation. The tests below fail on that code:
// there was nothing to ask (no capability export) and nothing to distinguish
// (one catch, no classification, no diagnostic).
//
// The injected `importer` is the seam that makes the absent/failed paths testable
// on a host where libmanette IS installed, which is every runner this package is
// tested on. Same role as `fillRandomBytes({ webcrypto })` in
// `@gjsify/webcrypto/random`.
//
// EVERY wording asserted here was MEASURED, not written to match the code:
// `ABSENT_MESSAGE` and `BROKEN_LIBRARY_MESSAGE` are copied from real gjs 1.88.1
// runs (see each constant), and `classifies the LIVE loader's own absent wording`
// below does not use a fixture at all — it asks the running loader.

import type Manette from '@girs/manette-0.2';
import { describe, expect, it } from '@gjsify/unit';

import {
    _diagnoseGiLoadError,
    _resetGamepadBackendCache,
    hasGamepadBackend,
    loadGamepadBackend,
    reportGamepadBackendOnce,
    type GamepadBackend,
    type LoadGamepadBackendOptions,
} from './backend.js';
import { GamepadManager } from './gamepad-manager.js';

/**
 * GJS's wording for a namespace whose typelib is not installed anywhere.
 *
 * MEASURED on gjs 1.88.1 / Fedora 44 by hiding `Manette-0.2.typelib` from
 * `/usr/lib64/girepository-1.0` (bwrap bind-mount over the directory) and
 * running `await import('gi://Manette')` — verbatim `error.message`. The thrown
 * object's own properties were `["fileName","lineNumber","columnNumber","message"]`:
 * no `domain`, no `code`, which is why the message is the signal.
 */
const ABSENT_MESSAGE = "Requiring Manette, version none: Typelib file for namespace 'Manette' (any version) not found";

/**
 * What GJS ACTUALLY throws when the typelib is present but its shared library
 * cannot be loaded.
 *
 * MEASURED on gjs 1.88.1: a byte-patched copy of the real `Manette-0.2.typelib`
 * (shared-library string rewritten to an equal-length name that does not exist)
 * put first on `GI_TYPELIB_PATH`, then `await import('gi://Manette')`. Two
 * findings, both load-bearing:
 *
 *   1. the `dlopen` detail never reaches JS. It is printed by girepository as a
 *      `GLib-GIRepository-WARNING` on stderr ("Failed to load shared library
 *      'libmanette-9.9.so.9' referenced by the typelib: …"), in the process
 *      LOCALE, and is not attached to any error.
 *   2. what JS gets is the message below — the ESM `gi://` loader materialises the
 *      whole namespace eagerly, so the first GType whose `get_type` symbol is
 *      unreachable is what throws. It names neither libmanette nor the library.
 *
 * The string the PR originally tested with ("Failed to load shared library
 * 'libmanette-0.2.so.0' referenced by the typelib") is the C template, and GJS
 * never hands it to JS — a fixture nothing produces. Default-to-fault is what
 * covers this case, and this is the measurement that proves it has to.
 */
const BROKEN_LIBRARY_MESSAGE = 'Unsupported type void, deriving from fundamental void';

/**
 * A namespace no host can have. Built at runtime so neither `tsc` nor the bundler
 * tries to resolve it — the point is to reach the LIVE loader.
 */
const ABSENT_NAMESPACE = 'GjsifyGamepadNoSuchNamespace';
const ABSENT_SPECIFIER = `gi://${ABSENT_NAMESPACE}`;

/** A Manette stand-in: only `Monitor` is touched by the probe. */
function fakeManetteModule(): typeof Manette {
    class Monitor {
        iterate() {
            return [false, null];
        }
        connect() {
            return 0;
        }
        disconnect() {}
    }
    return { Monitor } as unknown as typeof Manette;
}

function importerThrowing(error: unknown): LoadGamepadBackendOptions['importer'] {
    return () => Promise.reject(error);
}

function importerResolving(module: unknown): LoadGamepadBackendOptions['importer'] {
    return () => Promise.resolve({ default: module as typeof Manette });
}

/** Captured console output for one probe. */
interface Captured {
    warnings: string[];
    errors: string[];
}

/**
 * Run `body` with `console.warn`/`console.error` captured.
 *
 * Both are captured together on purpose: the two situations are supposed to use
 * DIFFERENT levels, so a test that watched only one could not tell them apart.
 */
async function capturingConsole(body: () => Promise<void>): Promise<Captured> {
    const captured: Captured = { warnings: [], errors: [] };
    const origWarn = console.warn;
    const origError = console.error;
    console.warn = (...args: unknown[]) => captured.warnings.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => captured.errors.push(args.map(String).join(' '));
    try {
        await body();
    } finally {
        console.warn = origWarn;
        console.error = origError;
    }
    return captured;
}

/**
 * Let `GamepadManager`'s deliberately un-awaited init settle.
 *
 * `_ensureInit()` starts `_init()` without awaiting it (`getGamepads()` is
 * synchronous per the W3C polling contract), so the manager's use of the backend
 * probe lands a few microtask turns later.
 */
async function flushMicrotasks(turns = 8): Promise<void> {
    for (let i = 0; i < turns; i++) await Promise.resolve();
}

export default async () => {
    await describe('gamepad backend probe', async () => {
        await it('reports a backend and no diagnostic when the namespace loads', async () => {
            _resetGamepadBackendCache();
            const fake = fakeManetteModule();
            let backend: GamepadBackend | null = null;
            const captured = await capturingConsole(async () => {
                backend = await loadGamepadBackend({ importer: importerResolving(fake) });
                expect(backend.status).toBe('manette');
                expect(backend.module).toBe(fake);
                expect(backend.error).toBeNull();
                expect(backend.diagnostic).toBeNull();
                expect(await hasGamepadBackend()).toBe(true);
                // Even the use-site reporter has nothing to say on a healthy host.
                reportGamepadBackendOnce(backend);
            });
            expect(captured.warnings).toStrictEqual([]);
            expect(captured.errors).toStrictEqual([]);
        });

        await it('keeps the capability QUERY silent — the use site is what speaks', async () => {
            _resetGamepadBackendCache();
            // The README's recommended usage is to CALL hasGamepadBackend(). It
            // must not emit an unsuppressable stderr line on every macOS/Windows
            // start — the exemplar (`isSecureRandomSource()` vs.
            // `fillRandomBytes()` in @gjsify/webcrypto/random) puts the message on
            // the OPERATION. This is the assertion that keeps it there.
            let backend: GamepadBackend | null = null;
            const quiet = await capturingConsole(async () => {
                backend = await loadGamepadBackend({ importer: importerThrowing(new Error(ABSENT_MESSAGE)) });
                expect(await hasGamepadBackend()).toBe(false);
            });
            expect(quiet.warnings).toStrictEqual([]);
            expect(quiet.errors).toStrictEqual([]);
            // …and the text exists, it is just emitted by whoever wanted a monitor.
            const spoken = await capturingConsole(async () => {
                reportGamepadBackendOnce(backend as unknown as GamepadBackend);
            });
            expect(spoken.warnings).toHaveLength(1);
            expect(spoken.warnings[0]).toContain('No gamepad backend on this host');
        });

        await it('classifies a MISSING typelib as absent and warns what to install', async () => {
            _resetGamepadBackendCache();
            const captured = await capturingConsole(async () => {
                const backend = await loadGamepadBackend({
                    importer: importerThrowing(new Error(ABSENT_MESSAGE)),
                });
                expect(backend.status).toBe('absent');
                expect(backend.module).toBeNull();
                // The original error is kept, not discarded into a boolean.
                expect((backend.error as Error).message).toBe(ABSENT_MESSAGE);
                // The capability export is the machine-readable form of the same
                // fact — this is what a caller reads instead of guessing from an
                // empty getGamepads().
                expect(await hasGamepadBackend()).toBe(false);
                reportGamepadBackendOnce(backend);
            });
            expect(captured.warnings).toHaveLength(1);
            expect(captured.warnings[0]).toContain('No gamepad backend on this host');
            expect(captured.warnings[0]).toContain('libmanette');
            expect(captured.warnings[0]).toContain('hasGamepadBackend()');
            // Absence is expected — it must NOT be reported as a fault.
            expect(captured.errors).toStrictEqual([]);
        });

        await it("classifies the LIVE loader's own absent wording, not a fixture", async () => {
            // The discriminator is a substring of GI's message. Comparing it to a
            // hand-typed copy of itself proves nothing: an upstream rewording
            // would silently reclassify every backend-less host as a FAULT and no
            // test would notice. So this case asks the RUNNING loader for a
            // namespace that cannot exist and classifies whatever it threw.
            // A rewording now fails HERE.
            let liveError: unknown = null;
            try {
                await import(ABSENT_SPECIFIER);
            } catch (error) {
                liveError = error;
            }
            expect(liveError instanceof Error).toBe(true);
            const scoped = _diagnoseGiLoadError(liveError, ABSENT_NAMESPACE);
            expect(scoped.status).toBe('absent');
            expect(scoped.diagnostic).toContain('No gamepad backend on this host');
            // And the namespace scoping is real, not decoration: the SAME live
            // error is a fault when the missing namespace is not the one this
            // package needs (that is a broken install, e.g. a missing GObject).
            expect(_diagnoseGiLoadError(liveError).status).toBe('failed');
        });

        await it('classifies a typelib that is PRESENT but fails to load as a fault', async () => {
            _resetGamepadBackendCache();
            // The measured message from a real broken install — see
            // BROKEN_LIBRARY_MESSAGE. This is the case the old single catch
            // reported as "no gamepads", and note what it does NOT contain: the
            // words libmanette, dlopen or "shared library". Only default-to-fault
            // gets this right, which is why the default is fault.
            const broken = new Error(BROKEN_LIBRARY_MESSAGE);
            const captured = await capturingConsole(async () => {
                const backend = await loadGamepadBackend({ importer: importerThrowing(broken) });
                expect(backend.status).toBe('failed');
                expect(backend.error).toBe(broken);
                expect(await hasGamepadBackend()).toBe(false);
                reportGamepadBackendOnce(backend);
            });
            // Loud, at error level, carrying the original — not a quiet warning.
            expect(captured.errors).toHaveLength(1);
            expect(captured.errors[0]).toContain('failed to load');
            expect(captured.errors[0]).toContain('NOT a platform without libmanette');
            expect(captured.errors[0]).toContain(BROKEN_LIBRARY_MESSAGE);
            expect(captured.warnings).toStrictEqual([]);
        });

        await it('treats a missing DEPENDENCY typelib as a fault, not as absence', async () => {
            _resetGamepadBackendCache();
            // The absence test names the namespace, so a dependency that is
            // missing while Manette itself is installed stays loud.
            const captured = await capturingConsole(async () => {
                const backend = await loadGamepadBackend({
                    importer: importerThrowing(
                        new Error("Typelib file for namespace 'GObject' (any version) not found"),
                    ),
                });
                expect(backend.status).toBe('failed');
                reportGamepadBackendOnce(backend);
            });
            expect(captured.errors).toHaveLength(1);
            expect(captured.warnings).toStrictEqual([]);
        });

        await it('classifies a version conflict as a fault', async () => {
            _resetGamepadBackendCache();
            const captured = await capturingConsole(async () => {
                const backend = await loadGamepadBackend({
                    importer: importerThrowing(
                        new Error('Version 0.2 of GI module Manette already loaded, cannot load version 9.9'),
                    ),
                });
                expect(backend.status).toBe('failed');
                reportGamepadBackendOnce(backend);
            });
            expect(captured.errors).toHaveLength(1);
            expect(captured.warnings).toStrictEqual([]);
        });

        await it('catches a node-gi lazy namespace that throws on first member access', async () => {
            _resetGamepadBackendCache();
            // node-gi parity. Under `--app node` the bundler rewrites
            // `gi://Manette` to a virtual module whose default export is a lazy
            // Proxy: the import ALWAYS resolves and `requireGi('Manette')` runs
            // on the first property read. A guard around the import alone is a
            // no-op there, and the failure landed on `new Monitor()` inside a
            // promise nobody awaits — an unhandled rejection, fatal on Node by
            // default. The probe must resolve a member inside its own guard.
            const lazy = new Proxy(Object.create(null) as object, {
                get() {
                    throw new Error(`Failed to require Manette: ${ABSENT_MESSAGE}`);
                },
            });
            const captured = await capturingConsole(async () => {
                const backend = await loadGamepadBackend({ importer: importerResolving(lazy) });
                expect(backend.status).toBe('absent');
                expect(await hasGamepadBackend()).toBe(false);
                reportGamepadBackendOnce(backend);
            });
            expect(captured.warnings).toHaveLength(1);
            expect(captured.errors).toStrictEqual([]);
        });

        await it('treats a MISSING @gjsify/node-gi bridge as no-backend, not as a fault', async () => {
            _resetGamepadBackendCache();
            // `--app node` reaches gi:// only through @gjsify/node-gi, which may
            // not be a hard dependency (ADR 0005) and which this `partial` slot
            // is explicitly expected to work without. So the supported plain-Node
            // configuration must not be told its host is broken — it must be told
            // what to install. Measured shape of the real failure: a Node
            // MODULE_NOT_FOUND naming '@gjsify/node-gi/gi'.
            const missingBridge = Object.assign(new Error("Cannot find module '@gjsify/node-gi/gi'"), {
                code: 'MODULE_NOT_FOUND',
            });
            const captured = await capturingConsole(async () => {
                const backend = await loadGamepadBackend({
                    importer: importerResolving(
                        new Proxy(Object.create(null) as object, {
                            get() {
                                throw missingBridge;
                            },
                        }),
                    ),
                });
                expect(backend.status).toBe('absent');
                expect(backend.error).toBe(missingBridge);
                expect(await hasGamepadBackend()).toBe(false);
                reportGamepadBackendOnce(backend);
            });
            expect(captured.errors).toStrictEqual([]);
            expect(captured.warnings).toHaveLength(1);
            expect(captured.warnings[0]).toContain('@gjsify/node-gi');
            expect(captured.warnings[0]).toContain('hasGamepadBackend()');
            // The libmanette advice would be the WRONG fix for this host.
            expect(captured.warnings[0]).toContain('No gamepad backend in this process');
        });

        await it('is SILENT where the build stubs gi:// on purpose', async () => {
            _resetGamepadBackendCache();
            // `--app browser` and `--app nativescript` map every `gi://*` to
            // `export {}; export default {};` BY DESIGN, and on both targets the
            // runtime's own navigator.getGamepads is the real implementation. A
            // page there must not be told its host has a fault — that is the
            // original defect inverted. Exactly the module the bundler emits:
            const stub = {};
            const captured = await capturingConsole(async () => {
                const backend = await loadGamepadBackend({ importer: importerResolving(stub) });
                expect(backend.status).toBe('absent');
                expect(backend.module).toBeNull();
                expect(backend.diagnostic).toBeNull();
                expect(await hasGamepadBackend()).toBe(false);
                reportGamepadBackendOnce(backend);
            });
            expect(captured.errors).toStrictEqual([]);
            expect(captured.warnings).toStrictEqual([]);
        });

        await it('faults a namespace that resolves without a Monitor class', async () => {
            _resetGamepadBackendCache();
            // An ABI skew: the namespace loaded and carries other entries, so it
            // is NOT the empty stub above and must stay a fault. (A real GJS
            // namespace object exposes all 16 Manette entries eagerly.)
            const captured = await capturingConsole(async () => {
                const backend = await loadGamepadBackend({
                    importer: importerResolving({ Device: class {}, MAJOR_VERSION: 0 }),
                });
                expect(backend.status).toBe('failed');
                expect(backend.module).toBeNull();
                reportGamepadBackendOnce(backend);
            });
            expect(captured.errors).toHaveLength(1);
            expect(captured.errors[0]).toContain('without a Monitor class');
        });

        await it('probes once, and refuses a late importer instead of ignoring it', async () => {
            _resetGamepadBackendCache();
            let calls = 0;
            const captured = await capturingConsole(async () => {
                const importer = () => {
                    calls++;
                    return Promise.reject(new Error(ABSENT_MESSAGE));
                };
                const first = await loadGamepadBackend({ importer });
                expect(await loadGamepadBackend()).toBe(first);
                await hasGamepadBackend();
                reportGamepadBackendOnce(first);
                reportGamepadBackendOnce(first);
            });
            expect(calls).toBe(1);
            // One probe ⇒ one message, and the second report is suppressed by the
            // warn-once flag, not by luck.
            expect(captured.warnings).toHaveLength(1);
            // A LATE importer used to be silently discarded, which let a suite
            // that forgot the reset assert against the previous test's module.
            let threw = false;
            try {
                await loadGamepadBackend({ importer: importerResolving(fakeManetteModule()) });
            } catch {
                threw = true;
            }
            expect(threw).toBe(true);
            expect(calls).toBe(1);
        });
    });

    await describe('GamepadManager and the shared probe', async () => {
        await it('answers the conformant EMPTY list with no backend, and says why once', async () => {
            _resetGamepadBackendCache();
            const captured = await capturingConsole(async () => {
                // Prime the shared probe as "absent" — the manager and the
                // capability export cannot disagree about it.
                await loadGamepadBackend({ importer: importerThrowing(new Error(ABSENT_MESSAGE)) });
                const manager = new GamepadManager();
                const pads = manager.getGamepads();
                // Conformant W3C answer, NOT a throw and NOT four fabricated
                // ports: `[[gamepads]]` "is initially the empty list" and grows
                // only when an index is selected for a connected device. A page
                // doing `navigator.getGamepads().length` must keep working on a
                // host with no gamepad backend, exactly as it does in a browser
                // whose port compiles WebKit's EmptyGamepadProvider.
                expect(pads).toStrictEqual([]);
                // Let the deferred init settle before the console is restored.
                await flushMicrotasks();
                manager.dispose();
                // dispose() clears the manager's own init state; the backend
                // probe stays cached, so a re-init must not re-warn.
                manager.getGamepads();
                await flushMicrotasks();
            });
            // The probe itself is silent, so this line can ONLY have come from the
            // manager's init: delete the report call from `_init()` and this fails.
            expect(captured.warnings).toHaveLength(1);
            expect(captured.warnings[0]).toContain('No gamepad backend on this host');
            expect(captured.errors).toStrictEqual([]);
        });

        await it('USES the probed module — one connected device, one slot', async () => {
            _resetGamepadBackendCache();
            // Wiring proof. The previous version of this test asserted a 4-null
            // array, which `_slots` produced whether or not the manager ever
            // consulted the probe. Here the device comes from the INJECTED
            // namespace, so if the manager stops using the probe the list stays
            // empty and this fails.
            const device = {
                get_name: () => 'Injected Pad',
                get_guid: () => 'guid-0',
                has_rumble: () => false,
                connect: () => 0,
                disconnect: () => {},
            };
            const captured = await capturingConsole(async () => {
                await loadGamepadBackend({
                    importer: importerResolving({
                        Monitor: class {
                            iterate() {
                                let handed = false;
                                return {
                                    next: () => (handed ? [false, null] : ((handed = true), [true, device])),
                                };
                            }
                            connect() {
                                return 0;
                            }
                            disconnect() {}
                        },
                    }),
                });
                const manager = new GamepadManager();
                manager.getGamepads();
                await flushMicrotasks();
                const pads = manager.getGamepads();
                expect(pads).toHaveLength(1);
                expect(pads[0]?.id).toBe('Injected Pad');
                expect(pads[0]?.index).toBe(0);
                manager.dispose();
                expect(manager.getGamepads()).toStrictEqual([]);
            });
            expect(captured.warnings).toStrictEqual([]);
            expect(captured.errors).toStrictEqual([]);
        });

        await it('reports a monitor that fails to START as its own fault', async () => {
            _resetGamepadBackendCache();
            // Everything past the probe — `new Monitor()`, the device walk,
            // `connect()` — can fail on a host whose typelib and library are both
            // fine (no udev/`/dev/input` in a sandbox). Saying "the backend failed
            // to load" there is the same conflation this module removed, one layer
            // up.
            const boom = new Error('GDBus.Error:org.freedesktop.DBus.Error.AccessDenied: no udev');
            const captured = await capturingConsole(async () => {
                await loadGamepadBackend({
                    importer: importerResolving({
                        Monitor: class {
                            constructor() {
                                throw boom;
                            }
                        },
                    }),
                });
                const manager = new GamepadManager();
                expect(manager.getGamepads()).toStrictEqual([]);
                await flushMicrotasks();
            });
            expect(captured.errors).toHaveLength(1);
            expect(captured.errors[0]).toContain('could not be started');
            expect(captured.errors[0]).toContain('no udev');
            expect(captured.errors[0]).not.toContain('failed to load');
            expect(captured.warnings).toStrictEqual([]);
        });
    });

    // Hand the shared probe back to the host so any later suite sees the real
    // machine, not a fake injected here.
    _resetGamepadBackendCache();
};
