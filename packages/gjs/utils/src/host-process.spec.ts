// The readings this module owns were `0` or a wrong string on macOS before it
// existed, each WRONG IN A WAY THAT LOOKS ANSWERED — a pid of `0`, an `execPath` that
// is a real path to a real file. So the assertions below are about the property that
// separates an answer from a plausible number, never about a literal value: this
// suite runs on Linux (procfs) and on macOS (`ps`), and a literal would pin one only.
//
// Nothing here asserts that `undefined`/`null` is impossible: off GJS every reader
// legitimately declines, and that IS the contract. What must never happen is a reader
// that declines by inventing a number.

import { describe, expect, it } from '@gjsify/unit';
import {
    __setProcessMemoryCacheTtlMsForTests,
    hasProcfs,
    hostEnv,
    hostExecPath,
    hostPid,
    hostPpid,
    PROCESS_MEMORY_CACHE_TTL_MS,
    readProcessMemory,
} from './host-process.js';

export default async () => {
    await describe('hostEnv', async () => {
        await it('should read a variable every test host sets', async () => {
            // PATH is set for every gjs/node the suite runs under; an unanswered read
            // would be `undefined`, never an empty string.
            const path = hostEnv('PATH');
            expect(typeof path).toBe('string');
            expect((path as string).length > 0).toBe(true);
        });

        await it('should answer undefined for an unset variable, not an empty string', async () => {
            expect(hostEnv('GJSIFY_UTILS_HOST_ENV_NEVER_SET_1f3a')).toBeUndefined();
        });
    });

    await describe('hostPid', async () => {
        await it('should report a real pid or none at all — never 0', async () => {
            const pid = hostPid();
            expect(pid === undefined || (Number.isInteger(pid) && (pid as number) > 0)).toBe(true);
        });

        await it('should agree with the host process object where there is one', async () => {
            const pid = hostPid();
            const hostReported = globalThis.process?.pid;
            // Under GJS `globalThis.process` is `@gjsify/process`, which reads THIS
            // module, so the comparison only means something once both answer.
            if (pid !== undefined && typeof hostReported === 'number' && hostReported > 0) {
                expect(pid).toBe(hostReported);
            }
        });

        await it('should be stable across calls', async () => {
            // A subprocess-derived pid that changed between calls would mean the
            // shell's parent was not us.
            expect(hostPid()).toBe(hostPid());
        });
    });

    await describe('hostPpid', async () => {
        await it('should report an integer or none at all', async () => {
            const ppid = hostPpid();
            expect(ppid === undefined || Number.isInteger(ppid)).toBe(true);
        });

        await it('should not report this process as its own parent', async () => {
            const pid = hostPid();
            const ppid = hostPpid();
            if (pid !== undefined && ppid !== undefined) expect(ppid).not.toBe(pid);
        });
    });

    await describe('hostExecPath', async () => {
        await it('should name an interpreter, never the script being run', async () => {
            const exe = hostExecPath();
            if (exe === undefined) return;
            expect(typeof exe).toBe('string');
            expect(exe.length > 0).toBe(true);
            // The defect this module was written for: reporting
            // `imports.system.programInvocationName`, i.e. the entry module. A bundle
            // path ends in a JS extension; an interpreter does not.
            expect(/\.(mjs|cjs|js|ts)$/.test(exe)).toBe(false);
        });

        await it('should be absolute where it answers', async () => {
            const exe = hostExecPath();
            if (exe === undefined) return;
            // "Rooted", not "/", so the assertion holds on win32 too.
            expect(exe.startsWith('/') || /^[A-Za-z]:[\\/]/.test(exe)).toBe(true);
        });
    });

    await describe('readProcessMemory', async () => {
        await it('should report a resident set the process actually has', async () => {
            const mem = readProcessMemory();
            if (mem === null) return;
            // A running JS engine has a non-zero RSS on every host; this is the
            // assertion that caught `process.memoryUsage().rss === 0` on macOS.
            expect(mem.resident > 0).toBe(true);
            expect(mem.virtual > 0).toBe(true);
        });

        await it('should report data/peak only where the reader can see them', async () => {
            const mem = readProcessMemory();
            if (mem === null) return;
            // `ps(1)` has no column for either, so off procfs both are 0, not guessed.
            if (!hasProcfs()) {
                expect(mem.data).toBe(0);
                expect(mem.peak).toBe(0);
            }
            expect(Number.isFinite(mem.data)).toBe(true);
            expect(Number.isFinite(mem.peak)).toBe(true);
        });

        await it('should not fork a subprocess on every call off procfs', async () => {
            // The regression this guards: 1500 uncached calls forked `ps` 1500
            // times and blocked the main loop for 44s. On procfs this reader
            // never shells out at all, so the property to check is "many calls
            // within the TTL complete fast", which holds on both hosts and
            // actually exercises the cache only where there is one.
            if (readProcessMemory() === null) return;
            const start = Date.now();
            for (let i = 0; i < 200; i++) readProcessMemory();
            const elapsedMs = Date.now() - start;
            // A single uncached `ps` fork+exec alone measured ~29ms on this
            // host; 200 calls finishing inside one such fork's budget is only
            // possible if most of them never spawned.
            expect(elapsedMs < PROCESS_MEMORY_CACHE_TTL_MS * 10).toBe(true);
        });

        await it('should return the SAME object within the TTL — proof of no second spawn', async () => {
            // Reference identity, not timing: a cache hit returns the exact cached
            // object, a fresh read always builds a new one. On procfs this reader
            // never caches, so there is nothing to prove — `mem` is already the
            // "uncached" answer on that host.
            if (readProcessMemory() === null || hasProcfs()) return;
            try {
                __setProcessMemoryCacheTtlMsForTests(60_000);
                const first = readProcessMemory();
                const second = readProcessMemory();
                expect(second).toBe(first);
            } finally {
                __setProcessMemoryCacheTtlMsForTests(null);
            }
        });

        await it('TTL 0 should disable the cache — every call is a fresh spawn', async () => {
            if (readProcessMemory() === null || hasProcfs()) return;
            try {
                __setProcessMemoryCacheTtlMsForTests(0);
                const first = readProcessMemory();
                const second = readProcessMemory();
                // Each call builds its own object; never the same reference even
                // when the values happen to agree.
                expect(second).not.toBe(first);
            } finally {
                __setProcessMemoryCacheTtlMsForTests(null);
            }
        });
    });
};
