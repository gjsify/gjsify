// `host-os` is what `os-axis` (ADR 0018) keys on, and what every OS branch in
// the tree is supposed to go through. Two properties are worth pinning exactly,
// because both were live defects before this module existed:
//
//   - the target set is CLOSED. `gjsify.os` may name linux/darwin/win32 and
//     nothing else, so `isTargetOs` has to reject a value that is a perfectly
//     valid `process.platform` (`freebsd`) as well as outright junk.
//   - "unknown" is NOT "not Windows". `hostPlatform()` returns `undefined`
//     where nothing answers, and a caller that collapses that into a boolean
//     silently claims a POSIX host on a runtime it never identified.

import { describe, expect, it } from '@gjsify/unit';
import { TARGET_OSES, hostOs, hostPlatform, isDarwin, isLinux, isTargetOs, isWin32 } from './host-os.js';

export default async () => {
    await describe('isTargetOs', async () => {
        await it('should accept exactly the three declared target operating systems', async () => {
            expect(isTargetOs('linux')).toBe(true);
            expect(isTargetOs('darwin')).toBe(true);
            expect(isTargetOs('win32')).toBe(true);
            expect(TARGET_OSES.length).toBe(3);
        });

        await it('should reject a valid process.platform outside the target set', async () => {
            // The distinction the OS axis exists to make: `freebsd` is a real
            // `process.platform` value and NOT something this project claims.
            expect(isTargetOs('freebsd')).toBe(false);
            expect(isTargetOs('android')).toBe(false);
            expect(isTargetOs('cygwin')).toBe(false);
        });

        await it('should reject non-strings without throwing', async () => {
            expect(isTargetOs(undefined)).toBe(false);
            expect(isTargetOs(null)).toBe(false);
            expect(isTargetOs(42)).toBe(false);
            expect(isTargetOs('')).toBe(false);
        });
    });

    await describe('hostPlatform / hostOs', async () => {
        await it('should agree with the host this suite is running on', async () => {
            // Deliberately not asserted against a hard-coded OS: the suite runs
            // on Linux, macOS and win32, and an assertion naming one of them is
            // the POSIX-hardcoding this module was written to retire.
            const platform = hostPlatform();
            expect(typeof platform === 'string' || platform === undefined).toBe(true);
            if (platform !== undefined) {
                expect(platform).toBe(globalThis.process.platform);
            }
        });

        await it('should return undefined rather than guessing on an unknown host', async () => {
            // `hostOs()` narrows to the target set, so a host outside it reads
            // as unknown instead of being rounded to the nearest claim.
            const os = hostOs();
            expect(os === undefined || isTargetOs(os)).toBe(true);
        });
    });

    await describe('isWin32 / isDarwin / isLinux', async () => {
        await it('should be mutually exclusive', async () => {
            const hits = [isWin32(), isDarwin(), isLinux()].filter(Boolean).length;
            // Zero on a host outside the target set — never more than one.
            expect(hits <= 1).toBe(true);
        });

        await it('should agree with hostOs', async () => {
            expect(isWin32()).toBe(hostOs() === 'win32');
            expect(isDarwin()).toBe(hostOs() === 'darwin');
            expect(isLinux()).toBe(hostOs() === 'linux');
        });
    });
};
