// Unit coverage for the runtime ↔ package-manager model behind `gjsify create`.
//
// Two of these are DRIFT GUARDS rather than behaviour tests, and they are why the
// file exists: `RUNTIME_PACKAGE_MANAGERS` is checked against `EXAMPLE_RUNTIMES`
// from `@gjsify/cli` so a runtime added there fails HERE instead of quietly never
// being offered, and the local `hostRuntime()` is checked against the canonical
// one in `@gjsify/rolldown-plugin-gjsify/runtime` — probe ORDER included, the
// part that actually breaks, since Bun, Deno and GJS all fake
// `process.versions.node`. Both imports are devDependencies and never reach the
// published `lib/`.

import { describe, expect, it } from '@gjsify/unit';
import { EXAMPLE_RUNTIMES } from '@gjsify/cli/lib/utils/runtimes.js';
import { hostRuntime as canonicalHostRuntime } from '@gjsify/rolldown-plugin-gjsify/runtime';
import {
    INSTALL_ARGV,
    PACKAGE_MANAGERS,
    RUNTIME_DESCRIPTIONS,
    RUNTIME_PACKAGE_MANAGERS,
    defaultRuntimeFor,
    hostRuntime,
    isKnownRuntime,
    packageManagersForRuntime,
    runScriptCommand,
    startScriptFor,
} from './runtimes.js';

/**
 * Run `body` with `globalThis[name]` set to `value`, then restore the property
 * descriptor exactly — an absent global must end up absent, not
 * present-and-undefined, which every later `typeof … !== 'undefined'` probe would
 * read as a positive.
 *
 * A global the RUNTIME owns is left alone: Bun defines `globalThis.Bun`
 * non-configurable (measured — `defineProperty` throws "Attempting to change
 * configurable attribute of unconfigurable property"), GJS owns `imports` the same
 * way. Not worth forcing: the fake we were about to install is the marker that
 * runtime already carries, so `body` asserts the same thing about a stronger
 * witness.
 */
function withGlobal(name: string, value: unknown, body: () => void): void {
    const target = globalThis as unknown as Record<string, unknown>;
    const previous = Object.getOwnPropertyDescriptor(target, name);
    if (previous && !previous.configurable) {
        body();
        return;
    }
    Object.defineProperty(target, name, { value, configurable: true, writable: true, enumerable: false });
    try {
        body();
    } finally {
        if (previous) Object.defineProperty(target, name, previous);
        else delete target[name];
    }
}

export default async () => {
    await describe('create-app: runtime → package-manager matrix', async () => {
        await it('covers exactly the runtimes @gjsify/cli declares', () => {
            expect(Object.keys(RUNTIME_PACKAGE_MANAGERS).sort()).toStrictEqual([...EXAMPLE_RUNTIMES].sort());
        });

        await it('describes every runtime it offers', () => {
            expect(Object.keys(RUNTIME_DESCRIPTIONS).sort()).toStrictEqual(
                Object.keys(RUNTIME_PACKAGE_MANAGERS).sort(),
            );
        });

        await it('is the documented choice matrix', () => {
            expect(packageManagersForRuntime('gjs')).toStrictEqual(['gjsify']);
            expect(packageManagersForRuntime('node')).toStrictEqual(['npm', 'yarn', 'pnpm', 'gjsify']);
            expect(packageManagersForRuntime('bun')).toStrictEqual(['bun']);
            expect(packageManagersForRuntime('deno')).toStrictEqual(['deno']);
        });

        await it('offers at least one manager per runtime, all of them known', () => {
            for (const runtime of Object.keys(RUNTIME_PACKAGE_MANAGERS)) {
                const managers = packageManagersForRuntime(runtime);
                expect(managers?.length).toBeGreaterThan(0);
                for (const manager of managers ?? []) expect(PACKAGE_MANAGERS).toContain(manager);
            }
        });

        await it('leaves no package manager unreachable', () => {
            // A manager nothing selects is a dead `--package-manager` choice.
            const reachable = new Set(Object.values(RUNTIME_PACKAGE_MANAGERS).flatMap((m) => [...m]));
            for (const manager of PACKAGE_MANAGERS) expect(reachable.has(manager)).toBe(true);
        });

        await it('rejects a runtime it has no installer for', () => {
            expect(packageManagersForRuntime('python')).toBeUndefined();
            expect(isKnownRuntime('python')).toBe(false);
            expect(isKnownRuntime('deno')).toBe(true);
        });
    });

    await describe('create-app: manager invocation', async () => {
        await it('installs from package.json with every manager', () => {
            // Read off each tool's `--help`: a bare `bun install` / `deno install`
            // means "install what package.json lists" — NOT deno's `--global` mode.
            for (const manager of PACKAGE_MANAGERS) expect(INSTALL_ARGV[manager][0]).toBe('install');
        });

        await it('spells `run a script` with the manager binary first', () => {
            for (const manager of PACKAGE_MANAGERS) {
                expect(runScriptCommand(manager).split(' ')[0]).toBe(manager);
            }
            expect(runScriptCommand('npm')).toBe('npm run');
            expect(runScriptCommand('yarn')).toBe('yarn');
            expect(runScriptCommand('pnpm')).toBe('pnpm');
            expect(runScriptCommand('gjsify')).toBe('gjsify run');
            expect(runScriptCommand('bun')).toBe('bun run');
            expect(runScriptCommand('deno')).toBe('deno task');
        });

        await it('names the template start script per runtime', () => {
            expect(startScriptFor('gjs')).toBe('start');
            expect(startScriptFor('node')).toBe('start:node');
            expect(startScriptFor('bun')).toBe('start:bun');
            expect(startScriptFor('deno')).toBe('start:deno');
        });
    });

    await describe('create-app: hostRuntime', async () => {
        const real = canonicalHostRuntime();

        await it('agrees with @gjsify/rolldown-plugin-gjsify/runtime on this host', () => {
            // Built for every runtime it claims (`test:cross-runtime`), so this one
            // assertion pins a different branch on each leg.
            expect(hostRuntime()).toBe(real);
            expect(PACKAGE_MANAGERS.length > 0 && isKnownRuntime(real)).toBe(true);
        });

        await it('probes Bun before Node', () => {
            withGlobal('Bun', {}, () => {
                expect(hostRuntime()).toBe(canonicalHostRuntime());
                // Bun is probed first, so a faked `Bun` wins on every host.
                expect(hostRuntime()).toBe('bun');
            });
            expect(hostRuntime()).toBe(real);
        });

        await it('probes Deno before Node', () => {
            withGlobal('Deno', {}, () => {
                expect(hostRuntime()).toBe(canonicalHostRuntime());
                // …unless we are actually ON Bun, which is probed ahead of Deno.
                expect(hostRuntime()).toBe(real === 'bun' ? 'bun' : 'deno');
            });
            expect(hostRuntime()).toBe(real);
        });

        await it('detects GJS through imports.gi', () => {
            if (real === 'gjs') {
                // On gjs the real probe is the strongest evidence there is, and
                // faking the live `imports` object would take the suite down with it.
                expect(hostRuntime()).toBe('gjs');
                return;
            }
            withGlobal('imports', { gi: {} }, () => {
                expect(hostRuntime()).toBe(canonicalHostRuntime());
                expect(hostRuntime()).toBe(real === 'node' ? 'gjs' : real);
            });
        });
    });

    await describe('create-app: defaultRuntimeFor', async () => {
        const host = hostRuntime();

        await it('prefers the host runtime when the template declares it', () => {
            expect(defaultRuntimeFor(['gjs', 'node', 'bun', 'deno'])).toBe(host);
        });

        await it('falls back to the first declared runtime otherwise', () => {
            const without = ['gjs', 'node', 'bun', 'deno'].filter((rt) => rt !== host);
            expect(defaultRuntimeFor(without)).toBe(without[0]);
            expect(defaultRuntimeFor([])).toBeUndefined();
        });

        await it('lets a pinned manager name the runtime', () => {
            const all = ['gjs', 'node', 'bun', 'deno'];
            expect(defaultRuntimeFor(all, 'bun')).toBe('bun');
            expect(defaultRuntimeFor(all, 'deno')).toBe('deno');
            expect(defaultRuntimeFor(all, 'npm')).toBe('node');
            expect(defaultRuntimeFor(all, 'pnpm')).toBe('node');
            // `gjsify` installs for both gjs and node; the first DECLARED wins.
            expect(defaultRuntimeFor(all, 'gjsify')).toBe('gjs');
            expect(defaultRuntimeFor(['node', 'gjs'], 'gjsify')).toBe('node');
        });

        await it('has no answer when nothing declared installs with the manager', () => {
            expect(defaultRuntimeFor(['gjs'], 'npm')).toBeUndefined();
            expect(defaultRuntimeFor(['node', 'bun'], 'deno')).toBeUndefined();
        });
    });
};
