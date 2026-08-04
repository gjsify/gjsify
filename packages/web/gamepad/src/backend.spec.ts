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

import type Manette from '@girs/manette-0.2';
import { describe, expect, it } from '@gjsify/unit';

import {
    _resetGamepadBackendCache,
    hasGamepadBackend,
    loadGamepadBackend,
    type LoadGamepadBackendOptions,
} from './backend.js';
import { GamepadManager } from './gamepad-manager.js';

/** GJS's wording for a namespace whose typelib is not installed anywhere. */
const ABSENT_MESSAGE = "Requiring Manette, version none: Typelib file for namespace 'Manette' (any version) not found";

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

export default async () => {
    await describe('gamepad backend probe', async () => {
        await it('reports a backend and no diagnostic when the namespace loads', async () => {
            _resetGamepadBackendCache();
            const fake = fakeManetteModule();
            const captured = await capturingConsole(async () => {
                const backend = await loadGamepadBackend({ importer: () => Promise.resolve({ default: fake }) });
                expect(backend.status).toBe('manette');
                expect(backend.module).toBe(fake);
                expect(backend.error).toBeNull();
                expect(await hasGamepadBackend()).toBe(true);
            });
            expect(captured.warnings).toStrictEqual([]);
            expect(captured.errors).toStrictEqual([]);
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
            });
            expect(captured.warnings).toHaveLength(1);
            expect(captured.warnings[0]).toContain('No gamepad backend on this host');
            expect(captured.warnings[0]).toContain('libmanette');
            expect(captured.warnings[0]).toContain('hasGamepadBackend()');
            // Absence is expected — it must NOT be reported as a fault.
            expect(captured.errors).toStrictEqual([]);
        });

        await it('classifies a typelib that is PRESENT but fails to load as a fault', async () => {
            _resetGamepadBackendCache();
            // A real one from a broken install: the typelib resolves, the library
            // behind it does not. This is the case the old single catch reported
            // as "no gamepads".
            const broken = new Error("Failed to load shared library 'libmanette-0.2.so.0' referenced by the typelib");
            const captured = await capturingConsole(async () => {
                const backend = await loadGamepadBackend({ importer: importerThrowing(broken) });
                expect(backend.status).toBe('failed');
                expect(backend.error).toBe(broken);
                expect(await hasGamepadBackend()).toBe(false);
            });
            // Loud, at error level, carrying the original — not a quiet warning.
            expect(captured.errors).toHaveLength(1);
            expect(captured.errors[0]).toContain('failed to load');
            expect(captured.errors[0]).toContain('NOT a platform without libmanette');
            expect(captured.errors[0]).toContain('libmanette-0.2.so.0');
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
            }) as unknown as typeof Manette;
            const captured = await capturingConsole(async () => {
                const backend = await loadGamepadBackend({ importer: () => Promise.resolve({ default: lazy }) });
                expect(backend.status).toBe('absent');
                expect(await hasGamepadBackend()).toBe(false);
            });
            expect(captured.warnings).toHaveLength(1);
            expect(captured.errors).toStrictEqual([]);
        });

        await it('faults a namespace that resolves without a Monitor class', async () => {
            _resetGamepadBackendCache();
            const captured = await capturingConsole(async () => {
                const backend = await loadGamepadBackend({
                    importer: () => Promise.resolve({ default: {} as unknown as typeof Manette }),
                });
                expect(backend.status).toBe('failed');
                expect(backend.module).toBeNull();
            });
            expect(captured.errors).toHaveLength(1);
            expect(captured.errors[0]).toContain('without a Monitor class');
        });

        await it('probes once — a second caller gets the cached answer, silently', async () => {
            _resetGamepadBackendCache();
            let calls = 0;
            const captured = await capturingConsole(async () => {
                const importer = () => {
                    calls++;
                    return Promise.reject(new Error(ABSENT_MESSAGE));
                };
                await loadGamepadBackend({ importer });
                await loadGamepadBackend({ importer });
                await hasGamepadBackend();
            });
            expect(calls).toBe(1);
            // One probe ⇒ one message. This is what makes the warning
            // warn-ONCE without a separate flag.
            expect(captured.warnings).toHaveLength(1);
        });
    });

    await describe('GamepadManager without a backend', async () => {
        await it('keeps the W3C shape and adds no second diagnostic', async () => {
            _resetGamepadBackendCache();
            const captured = await capturingConsole(async () => {
                // Prime the shared probe as "absent", then let the manager pick
                // it up — the manager and the capability export cannot disagree.
                await loadGamepadBackend({ importer: importerThrowing(new Error(ABSENT_MESSAGE)) });
                const manager = new GamepadManager();
                const pads = manager.getGamepads();
                // Conformant W3C answer, NOT a throw: a page doing
                // `navigator.getGamepads().length` must keep working on a host
                // with no gamepad backend, exactly as it does in a browser whose
                // port compiles WebKit's EmptyGamepadProvider.
                expect(pads).toHaveLength(4);
                for (const pad of pads) expect(pad).toBeNull();
                // Let the deferred init settle before the console is restored.
                await flushMicrotasks();
                manager.dispose();
                // dispose() clears the manager's own init state; the backend
                // probe stays cached, so a re-init must not re-warn.
                manager.getGamepads();
                await flushMicrotasks();
            });
            expect(captured.warnings).toHaveLength(1);
            expect(captured.errors).toStrictEqual([]);
        });
    });

    // Hand the shared probe back to the host so any later suite sees the real
    // machine, not a fake injected here.
    _resetGamepadBackendCache();
};
