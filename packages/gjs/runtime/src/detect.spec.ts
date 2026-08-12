// The detection rule, checked against host shapes CI cannot BE.
//
// `index.spec.ts` asserts the constants agree with the one host running them —
// necessary, and structurally unable to catch a wrong branch for a runtime the leg
// is not on. That is how Bun read as Node while four legs were green. Here the
// globals are an argument, so every branch is exercised on every leg.

import { describe, expect, it } from '@gjsify/unit';
import { detectRuntime, type RuntimeHost } from './detect.js';

/** Host shapes, each with the trait that makes it hard, stated. */
const HOSTS: Array<{ what: string; host: RuntimeHost; target: string | undefined; version?: string }> = [
    {
        what: 'real Node',
        host: { process: { versions: { node: '24.18.0' } } },
        target: 'node',
        version: '24.18.0',
    },
    {
        what: 'Bun — fakes process.versions.node',
        host: { Bun: { version: '1.3.14' }, process: { versions: { node: '24.3.0' } } },
        target: 'bun',
        version: '1.3.14',
    },
    {
        what: 'Deno — fakes process.versions.node',
        host: { Deno: { version: { deno: '2.5.4' } }, process: { versions: { node: '22.9.0' } } },
        target: 'deno',
        version: '2.5.4',
    },
    {
        what: 'GJS with @gjsify/process — fakes process.versions.node too',
        host: { imports: { gi: {} }, process: { versions: { gjs: '1.88.1', node: '24.0.0' } } },
        target: 'gjs',
        version: '1.88.1',
    },
    {
        what: 'bare GJS — no process object at all',
        host: { imports: { gi: {} } },
        target: 'gjs',
        version: undefined,
    },
    {
        what: '@gjsify/node-gi on Node — imports.gi injected into a V8 process',
        host: { imports: { gi: {} }, process: { versions: { node: '24.18.0' } } },
        target: 'node',
        version: '24.18.0',
    },
    {
        what: 'a browser — no process, no imports',
        host: {},
        target: undefined,
    },
];

export default async (): Promise<void> => {
    await describe('detectRuntime', async () => {
        for (const { what, host, target, version } of HOSTS) {
            await it(`names ${target ?? 'nothing'} on ${what}`, async () => {
                const identity = detectRuntime(host);
                expect(identity.target).toBe(target);
                if (target !== undefined) expect(identity.version).toBe(version);
            });
        }

        await it('never reports the emulated Node version for Bun or Deno', async () => {
            for (const { host } of HOSTS) {
                const identity = detectRuntime(host);
                if (identity.target === 'bun' || identity.target === 'deno') {
                    expect(identity.version).not.toBe(host.process?.versions?.node);
                }
            }
        });

        await it('says Unknown rather than guessing', async () => {
            const identity = detectRuntime({});
            expect(identity.name).toBe('Unknown');
            expect(identity.target).toBe(undefined);
            expect(identity.version).toBe(undefined);
        });
    });
};
