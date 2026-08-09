// Unit coverage for the shared runtime-selector tooling — the RUNTIMES map,
// runtime→build-target mapping, and the per-example runtime declaration
// validation used by `gjsify run/showcase --runtime` and the node-gi example.

import { describe, expect, it } from '@gjsify/unit';
import { hostRuntime } from '@gjsify/rolldown-plugin-gjsify/runtime';
import {
    EXAMPLE_RUNTIMES,
    RUNTIMES,
    isExampleRuntime,
    buildAppForRuntime,
    readDeclaredRuntimes,
    checkRuntimeSupported,
    defaultExampleRuntime,
    isRuntimeAvailable,
    requiresGjsSystemDeps,
} from './runtimes.js';

export default async () => {
    await describe('runtimes: RUNTIMES map', async () => {
        await it('covers exactly gjs/node/bun/deno', () => {
            expect(EXAMPLE_RUNTIMES).toStrictEqual(['gjs', 'node', 'bun', 'deno']);
            expect(Object.keys(RUNTIMES).sort()).toStrictEqual(['bun', 'deno', 'gjs', 'node']);
        });

        await it('maps gjs to --app gjs and node/bun/deno to --app node', () => {
            expect(buildAppForRuntime('gjs')).toBe('gjs');
            expect(buildAppForRuntime('node')).toBe('node');
            expect(buildAppForRuntime('bun')).toBe('node');
            expect(buildAppForRuntime('deno')).toBe('node');
        });

        await it('launches gjs with `-m` and node with the bare entry', () => {
            expect(RUNTIMES.gjs.launch('/x/app.gjs.mjs')).toStrictEqual(['gjs', ['-m', '/x/app.gjs.mjs']]);
            expect(RUNTIMES.node.launch('/x/app.node.mjs')).toStrictEqual(['node', ['/x/app.node.mjs']]);
        });

        await it('bun reuses the node bundle; deno pins --node-modules-dir=manual', () => {
            expect(RUNTIMES.bun.launch('/x/app.node.mjs')).toStrictEqual(['bun', ['/x/app.node.mjs']]);
            expect(RUNTIMES.deno.launch('/x/app.node.mjs')).toStrictEqual([
                'deno',
                ['run', '-A', '--node-modules-dir=manual', '/x/app.node.mjs'],
            ]);
        });

        await it('forwards extra args', () => {
            expect(RUNTIMES.node.launch('/x/app.node.mjs', ['--port', '8080'])).toStrictEqual([
                'node',
                ['/x/app.node.mjs', '--port', '8080'],
            ]);
        });
    });

    await describe('runtimes: isExampleRuntime', async () => {
        await it('accepts the four runtimes and rejects others', () => {
            expect(isExampleRuntime('gjs')).toBe(true);
            expect(isExampleRuntime('deno')).toBe(true);
            expect(isExampleRuntime('python')).toBe(false);
            expect(isExampleRuntime('')).toBe(false);
        });
    });

    await describe('runtimes: defaultExampleRuntime', async () => {
        await it('prefers gjs whenever gjs is runnable here', () => {
            // The regression this guards: a plain `hostRuntime()` default made
            // `npx @gjsify/cli showcase <name>` ask for the `--app node` bundle
            // on a Node host that has gjs installed, so the documented
            // first-run command failed on a missing file.
            const expected = isRuntimeAvailable('gjs') ? 'gjs' : hostRuntime();
            expect(defaultExampleRuntime()).toBe(expected);
        });

        await it('returns one of the four known runtimes', () => {
            expect(isExampleRuntime(defaultExampleRuntime())).toBe(true);
        });

        await it('is gjs when the CLI itself runs on gjs', async () => {
            // The host runtime is always "available" without a PATH probe, so
            // under gjs the answer is gjs by construction.
            if (hostRuntime() === 'gjs') expect(defaultExampleRuntime()).toBe('gjs');
        });
    });

    await describe('runtimes: readDeclaredRuntimes', async () => {
        await it('returns null when no declaration is present (permissive)', () => {
            expect(readDeclaredRuntimes(undefined)).toBeNull();
            expect(readDeclaredRuntimes({})).toBeNull();
            expect(readDeclaredRuntimes({ gjsify: {} })).toBeNull();
            expect(readDeclaredRuntimes({ gjsify: { example: {} } })).toBeNull();
        });

        await it('reads and filters the declared list', () => {
            expect(readDeclaredRuntimes({ gjsify: { example: { runtimes: ['gjs', 'node'] } } })).toStrictEqual([
                'gjs',
                'node',
            ]);
            // Unknown entries are dropped (forward-compat with newer runtime names).
            expect(readDeclaredRuntimes({ gjsify: { example: { runtimes: ['gjs', 'wasm', 42] } } })).toStrictEqual([
                'gjs',
            ]);
        });
    });

    await describe('runtimes: checkRuntimeSupported', async () => {
        await it('is permissive with a null declaration', () => {
            expect(checkRuntimeSupported('node', null, 'x').ok).toBe(true);
        });

        await it('accepts a declared runtime', () => {
            expect(checkRuntimeSupported('node', ['gjs', 'node'], 'x').ok).toBe(true);
        });

        // A MADE-UP name on purpose. This asserts the message FORMATTER, not any
        // real showcase — and it used to say `adwaita-storybook`, which stopped
        // being true the moment that showcase declared node/bun/deno. A test
        // that names a real thing quietly claims something about it.
        await it('gives a clear, actionable error for an unsupported runtime', () => {
            const res = checkRuntimeSupported('node', ['gjs'], 'gjs-only-example');
            expect(res.ok).toBe(false);
            expect(res.message).toContain('gjs-only-example');
            expect(res.message).toContain('does not support --runtime node');
            expect(res.message).toContain('Declared runtimes: gjs');
        });
    });

    await describe('runtimes: requiresGjsSystemDeps', async () => {
        await it('demands a gjs binary ONLY for the gjs runtime', () => {
            // The regression this encodes: `gjsify showcase --runtime node`
            // aborted with "Missing system dependencies: ✗ GJS" on every host
            // without gjs, because the check ran before the runtime was known.
            expect(requiresGjsSystemDeps('gjs')).toBe(true);
            expect(requiresGjsSystemDeps('node')).toBe(false);
            expect(requiresGjsSystemDeps('bun')).toBe(false);
            expect(requiresGjsSystemDeps('deno')).toBe(false);
        });

        await it('stays derived from buildAppForRuntime for every runtime', () => {
            // Not a second table: a runtime added to RUNTIMES must be correct
            // here with no matching edit, or the two answers drift apart.
            for (const rt of EXAMPLE_RUNTIMES) {
                expect(requiresGjsSystemDeps(rt)).toBe(buildAppForRuntime(rt) === 'gjs');
            }
        });
    });
};
