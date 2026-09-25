// Which `process` the detectors believe. `imports.gi` is not proof of GJS: node-gi
// installs it on Node, Bun and Deno, and `platform`/`arch`/`pid`/`ppid` then came
// from the GJS probes (a `uname` spawn, procfs) instead of the runtime that already
// knew. On Windows there is no `uname`, so a node-gi bundle reported `linux`.
//
// Driven by lending a runtime-shaped `process` for the duration: under GJS the
// discriminating half is real, since `imports.gi` exists there exactly as under
// node-gi; on Node it holds the answer the host gives.

import { describe, expect, it } from '@gjsify/unit';

import { detectArch, detectPlatform, detectPpid, getPid } from './internal/detect.js';

type Host = { process?: unknown };

function withRuntimeProcess(fake: object, fn: () => void): void {
    const host = globalThis as unknown as Host;
    const saved = Object.getOwnPropertyDescriptor(host, 'process');
    Object.defineProperty(host, 'process', { value: fake, configurable: true, writable: true });
    try {
        fn();
    } finally {
        if (saved) Object.defineProperty(host, 'process', saved);
        else delete host.process;
    }
}

export default async () => {
    await describe('process detection: the runtime answers first', async () => {
        // A platform, arch and pids no probe on this host could produce.
        const runtime = { release: { name: 'node' }, platform: 'win32', arch: 'arm64', pid: 424242, ppid: 4243 };

        await it("takes a runtime's own process at its word", async () => {
            withRuntimeProcess(runtime, () => {
                expect(detectPlatform()).toBe('win32');
                expect(detectArch()).toBe('arm64');
                expect(getPid()).toBe(424242);
                expect(detectPpid()).toBe(4243);
            });
        });

        await it('does not take our own Process (no `release`) for a runtime', async () => {
            // The GJS banner stub and `Process` define no `release`: they are what
            // the probes exist to fill in, so their values must not be echoed back.
            withRuntimeProcess({ platform: 'win32', arch: 'arm64', pid: 424242 }, () => {
                expect(getPid()).not.toBe(424242);
            });
        });
    });
};
