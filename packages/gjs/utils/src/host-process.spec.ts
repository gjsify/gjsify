// The four readings this module owns were all `0` or a wrong string on macOS
// before it existed, and every one of them was WRONG IN A WAY THAT LOOKS
// ANSWERED — a pid of `0`, an `execPath` that is a real path to a real file.
// So the assertions below are about the property that distinguishes an answer
// from a plausible number, not about a literal value: this suite runs on Linux
// (procfs) and on macOS (`ps`), and a literal would only be pinning one of them.
//
// Nothing here asserts `undefined`/`null` is impossible. On a runtime with no
// GJS host every reader legitimately declines, and that IS the contract — what
// must never happen is a reader that declines by inventing a number.

import { describe, expect, it } from '@gjsify/unit';
import { hasProcfs, hostExecPath, hostPid, hostPpid, readProcessMemory } from './host-process.js';

export default async () => {
    await describe('hostPid', async () => {
        await it('should report a real pid or none at all — never 0', async () => {
            const pid = hostPid();
            expect(pid === undefined || (Number.isInteger(pid) && (pid as number) > 0)).toBe(true);
        });

        await it('should agree with the host process object where there is one', async () => {
            const pid = hostPid();
            const hostReported = globalThis.process?.pid;
            // Under GJS `globalThis.process` is `@gjsify/process`, which reads
            // THIS module — so the comparison is only meaningful once both have
            // a positive answer. Where either declines there is nothing to
            // disagree about.
            if (pid !== undefined && typeof hostReported === 'number' && hostReported > 0) {
                expect(pid).toBe(hostReported);
            }
        });

        await it('should be stable across calls', async () => {
            // Memoized, and the memo must not be the difference between the
            // first and second reading — a subprocess-derived pid that changed
            // would mean the shell's parent was not us.
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
            // The exact defect this module was written for: reporting
            // `imports.system.programInvocationName`, i.e. the entry module.
            // A bundle path ends in a JS extension; an interpreter does not.
            expect(/\.(mjs|cjs|js|ts)$/.test(exe)).toBe(false);
        });

        await it('should be absolute where it answers', async () => {
            const exe = hostExecPath();
            if (exe === undefined) return;
            // POSIX or a Windows drive root — asserted as "rooted", not as "/",
            // so this stays true wherever the suite is run.
            expect(exe.startsWith('/') || /^[A-Za-z]:[\\/]/.test(exe)).toBe(true);
        });
    });

    await describe('readProcessMemory', async () => {
        await it('should report a resident set the process actually has', async () => {
            const mem = readProcessMemory();
            if (mem === null) return;
            // A running JS engine has a non-zero RSS on every host. This is the
            // assertion that caught `process.memoryUsage().rss === 0` on macOS.
            expect(mem.resident > 0).toBe(true);
            expect(mem.virtual > 0).toBe(true);
        });

        await it('should report data/peak only where the reader can see them', async () => {
            const mem = readProcessMemory();
            if (mem === null) return;
            // The documented degraded contract: `ps(1)` has no column for
            // either, so off procfs both are 0 rather than guessed.
            if (!hasProcfs()) {
                expect(mem.data).toBe(0);
                expect(mem.peak).toBe(0);
            }
            expect(Number.isFinite(mem.data)).toBe(true);
            expect(Number.isFinite(mem.peak)).toBe(true);
        });
    });
};
