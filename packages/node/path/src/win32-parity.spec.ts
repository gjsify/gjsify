// `path.win32` against the answers native Node gives, including the ones that depend on the
// current directory.
//
// Every expectation below was read off real `require('path').win32` (Node 24) with the same
// cwd stubbed in, not derived from the code: the Node leg of this suite runs the NATIVE module,
// so it proves the vector, and the GJS leg proves ours against it. A fuzz of ~480k random calls
// across every win32 function found no remaining divergence; before this change it found ~34k,
// in the four functions pinned here.
//
// The cwd is stubbed rather than read because it is the input that differs per host: a
// drive-relative `Q:foo` means something only once there IS a current drive, and the Linux
// runner has none. Node reads `process.cwd()` at call time, and so do we, so one stub drives
// both. The per-drive cwd Windows keeps in `=Q:` is not covered: on POSIX Node silently drops
// an environment name containing `=`, so no runner here can set it the way cmd.exe does.

import { describe, expect, it } from '@gjsify/unit';

import { win32 } from 'node:path';

type CwdHost = { process?: { cwd: () => string } };

function withCwd(cwd: string, fn: () => void): void {
    // A browser bundle may have no `process` global at all; the implementation then falls
    // back to `/`, so one is lent for the duration rather than letting the vector go untested.
    const host = globalThis as unknown as CwdHost;
    const lent = host.process === undefined;
    if (lent) host.process = { cwd: () => cwd };
    const proc = host.process!;
    const original = proc.cwd;
    proc.cwd = () => cwd;
    try {
        fn();
    } finally {
        if (lent) delete host.process;
        else proc.cwd = original;
    }
}

export default async () => {
    await describe('path.win32 against a drive cwd', async () => {
        await it('resolves a drive-relative path on ANOTHER drive to that drive, not to a relative path', () => {
            // `Q:foo` with the cwd on `C:` answered `Q:foo` — still relative, so a caller that
            // resolved it to get an absolute path (`pathToFileURL`) glued it onto the cwd.
            withCwd('C:\\work\\dir', () => {
                expect(win32.resolve('Q:foo')).toBe('Q:\\foo');
                expect(win32.resolve('q:foo')).toBe('q:\\foo');
                expect(win32.resolve('Q:')).toBe('Q:\\');
                expect(win32.resolve('C:\\x', 'Q:y')).toBe('Q:\\y');
            });
        });

        await it('resolves a relative path against the cwd, drive included', () => {
            withCwd('C:\\work\\dir', () => {
                expect(win32.resolve('C:foo')).toBe('C:\\work\\dir\\foo');
                expect(win32.resolve('app\\dist')).toBe('C:\\work\\dir\\app\\dist');
                expect(win32.resolve('..\\x')).toBe('C:\\work\\x');
                expect(win32.resolve('\\foo')).toBe('C:\\foo');
            });
        });

        await it('reads a POSIX-shaped cwd as a rooted path with no drive', () => {
            // What a Linux host running `path.win32` produces — Node's own answer there.
            withCwd('/tmp/x', () => {
                expect(win32.resolve('C:foo')).toBe('C:\\tmp\\x\\foo');
                expect(win32.resolve('app\\dist')).toBe('\\tmp\\x\\app\\dist');
            });
        });

        await it('returns the resolved path from toNamespacedPath, not the input', () => {
            withCwd('C:\\work\\dir', () => {
                expect(win32.toNamespacedPath('app\\dist')).toBe('\\\\?\\C:\\work\\dir\\app\\dist');
                expect(win32.toNamespacedPath('.')).toBe('\\\\?\\C:\\work\\dir');
                expect(win32.toNamespacedPath('\\foo')).toBe('\\\\?\\C:\\foo');
                expect(win32.toNamespacedPath('C:\\x')).toBe('\\\\?\\C:\\x');
                expect(win32.toNamespacedPath('\\\\srv\\share\\f')).toBe('\\\\?\\UNC\\srv\\share\\f');
            });
            withCwd('/tmp/x', () => {
                expect(win32.toNamespacedPath('rel')).toBe('\\tmp\\x\\rel');
            });
        });
    });

    await describe('path.win32 device namespaces', async () => {
        await it('treats \\\\.\\ and \\\\?\\ as a device root, not a server and share', () => {
            expect(win32.normalize('\\\\.\\PHYSICALDRIVE0')).toBe('\\\\.\\PHYSICALDRIVE0');
            expect(win32.normalize('\\\\?\\C:')).toBe('\\\\?\\C:');
            expect(win32.join('\\\\?\\C:', '.')).toBe('\\\\?\\C:');
            expect(win32.join('\\\\.\\PHYSICALDRIVE0', '..\\x')).toBe('\\\\.\\x');
            withCwd('C:\\work\\dir', () => {
                expect(win32.resolve('\\\\.\\PHYSICALDRIVE0')).toBe('\\\\.\\PHYSICALDRIVE0');
                expect(win32.resolve('\\\\?\\C:\\x')).toBe('\\\\?\\C:\\x');
            });
        });
    });

    await describe('path.win32 never normalises a relative path into a drive path', async () => {
        await it('prefixes .\\ where the result would read as drive-qualified (CVE-2024-36139)', () => {
            expect(win32.normalize('foo\\..\\C:bar')).toBe('.\\C:bar');
            expect(win32.join('.', 'C:foo')).toBe('.\\C:foo');
            expect(win32.join('app', 'C:\\x')).toBe('.\\app\\C:\\x');
            // A colon that is not a drive colon is an ordinary character.
            expect(win32.normalize('a:b')).toBe('a:b');
            expect(win32.normalize('C:foo\\..\\..\\x')).toBe('C:..\\x');
        });

        await it('leaves a reserved device name un-normalised', () => {
            expect(win32.join('dir', 'COM1:', 'x')).toBe('dir\\COM1:\\x');
            expect(win32.normalize('\\\\?\\COM1:\\x')).toBe('\\\\?\\COM1:\\x');
        });
    });
};
