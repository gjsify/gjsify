// SPDX-License-Identifier: MIT
// "Which binary does PATH actually pick?"
//
// The WINDOWS branch is exercised HERE, on Linux, by injecting the platform:
// nothing in CI resolves a bin on a Windows host, so an injected `'win32'` is the
// ONLY way the PATHEXT branch EXECUTES — and an unexecutable Windows branch is how
// the `'dir'` bug in `dir-link.ts` shipped.
//
// The `verifyPathResolution` rows are injected for the mirror-image reason: a
// developer's own machine only ever produces the HAPPY one, since a working
// install resolves to its own binDir by definition. The two failing shapes —
// shadowed, and absent — are what #1064 was reported from.

import { describe, it, expect } from '@gjsify/unit';
import { posix, win32 } from 'node:path';

import { globalLayoutIsDefault, resolveBinOnPath } from './install-global.js';
import { verifyPathResolution } from '../commands/self-update.js';

export default async () => {
    await describe('resolveBinOnPath', async () => {
        await it('returns the FIRST hit in PATH order, not merely any hit', async () => {
            // The bug guarded: `~/.local/bin` is on PATH but loses to an npm-global dir
            // earlier in it, so "is our dir on PATH" answers yes and is the wrong
            // question.
            const present = new Set([posix.resolve('/opt/npm/bin/gjsify'), posix.resolve('/home/u/.local/bin/gjsify')]);
            const found = resolveBinOnPath('gjsify', {
                platform: 'linux',
                pathValue: '/opt/npm/bin:/home/u/.local/bin',
                exists: (f) => present.has(f),
            });
            expect(found).toBe(posix.resolve('/opt/npm/bin/gjsify'));
        });

        await it('returns null when PATH holds no candidate', async () => {
            const found = resolveBinOnPath('gjsify', {
                platform: 'linux',
                pathValue: '/usr/bin:/bin',
                exists: () => false,
            });
            expect(found).toBe(null);
        });

        await it('skips PATH entries that do not carry the bin', async () => {
            const present = new Set([posix.resolve('/second/gjsify')]);
            const found = resolveBinOnPath('gjsify', {
                platform: 'linux',
                pathValue: '/first:/second',
                exists: (f) => present.has(f),
            });
            expect(found).toBe(posix.resolve('/second/gjsify'));
        });

        await it('ignores empty PATH segments', async () => {
            const present = new Set([posix.resolve('/only/gjsify')]);
            const found = resolveBinOnPath('gjsify', {
                platform: 'linux',
                pathValue: ':/only:',
                exists: (f) => present.has(f),
            });
            expect(found).toBe(posix.resolve('/only/gjsify'));
        });

        // --- win32: the branch that cannot run on this host ------------------

        // Windows' filesystem is CASE-INSENSITIVE, and the two sides disagree on
        // case by convention: `PATHEXT` is spelled `.CMD` while `bin-shim.ts`
        // writes `gjsify.cmd`. A case-sensitive stub would therefore report a
        // correct install as missing — the stub, not the resolver, is what has to
        // model the host here.
        const winExists = (present: string[]) => {
            const set = new Set(present.map((f) => f.toLowerCase()));
            return (f: string) => set.has(f.toLowerCase());
        };

        // For the same reason, the resolver returns the candidate it BUILT, whose
        // extension carries PATHEXT's casing (`gjsify.CMD`) rather than the file's
        // (`gjsify.cmd`). On Windows both name one file, so the assertion compares
        // up to the case the platform does not distinguish.
        const sameWinPath = (a: string | null, b: string) => (a ?? '').toLowerCase() === b.toLowerCase();

        await it('finds the .cmd shim on win32, which is what cmd.exe launches', async () => {
            // `bin-shim.ts` writes the sh/.cmd/.ps1 triple. An extension-less
            // name is not executable on Windows, so a resolver that only probed
            // the bare name would report "not installed" for a correct install.
            const exists = winExists([win32.resolve('C:\\tools\\gjsify.cmd')]);
            const found = resolveBinOnPath('gjsify', {
                platform: 'win32',
                pathValue: 'C:\\tools',
                pathExt: '.COM;.EXE;.BAT;.CMD',
                exists,
            });
            expect(sameWinPath(found, win32.resolve('C:\\tools\\gjsify.cmd'))).toBe(true);
        });

        await it('prefers an earlier PATHEXT entry over a later one', async () => {
            const exists = winExists([win32.resolve('C:\\tools\\gjsify.exe'), win32.resolve('C:\\tools\\gjsify.cmd')]);
            const found = resolveBinOnPath('gjsify', {
                platform: 'win32',
                pathValue: 'C:\\tools',
                pathExt: '.EXE;.CMD',
                exists,
            });
            expect(sameWinPath(found, win32.resolve('C:\\tools\\gjsify.exe'))).toBe(true);
        });

        await it('still reports a bare sh shim on win32 (git-bash), as the last resort', async () => {
            const exists = winExists([win32.resolve('C:\\tools\\gjsify')]);
            const found = resolveBinOnPath('gjsify', {
                platform: 'win32',
                pathValue: 'C:\\tools',
                pathExt: '.CMD',
                exists,
            });
            expect(sameWinPath(found, win32.resolve('C:\\tools\\gjsify'))).toBe(true);
        });

        await it('splits win32 PATH on `;`, not `:` — a drive letter is not a separator', async () => {
            const exists = winExists([win32.resolve('C:\\second\\gjsify.cmd')]);
            const found = resolveBinOnPath('gjsify', {
                platform: 'win32',
                pathValue: 'C:\\first;C:\\second',
                pathExt: '.CMD',
                exists,
            });
            expect(sameWinPath(found, win32.resolve('C:\\second\\gjsify.cmd'))).toBe(true);
        });

        await it('normalises a PATHEXT entry given without its leading dot', async () => {
            const exists = winExists([win32.resolve('C:\\tools\\gjsify.cmd')]);
            const found = resolveBinOnPath('gjsify', {
                platform: 'win32',
                pathValue: 'C:\\tools',
                pathExt: 'CMD',
                exists,
            });
            expect(sameWinPath(found, win32.resolve('C:\\tools\\gjsify.cmd'))).toBe(true);
        });
    });

    await describe('verifyPathResolution', async () => {
        const binDir = posix.join('/home/u/.local/bin');

        await it('is ok when PATH resolves into the dir we linked', async () => {
            const verdict = verifyPathResolution({
                binName: 'gjsify',
                binDir,
                resolvedBin: posix.join(binDir, 'gjsify'),
                runningVersion: '0.31.0',
                targetVersion: '0.31.0',
                platform: 'linux',
            });
            expect(verdict.ok).toBe(true);
        });

        await it('FAILS when another install shadows the name — the #1064 report', async () => {
            const verdict = verifyPathResolution({
                binName: 'gjsify',
                binDir,
                resolvedBin: '/opt/npm/bin/gjsify',
                runningVersion: '0.26.0',
                targetVersion: '0.31.0',
                platform: 'linux',
            });
            expect(verdict.ok).toBe(false);
            // The message must name BOTH sides: the version the user believes
            // they got, and the path that will actually run instead.
            const message = verdict.ok ? '' : verdict.message;
            expect(message.includes('/opt/npm/bin/gjsify')).toBe(true);
            expect(message.includes('0.26.0')).toBe(true);
            expect(message.includes('0.31.0')).toBe(true);
            expect(message.includes(binDir)).toBe(true);
        });

        await it('FAILS when nothing named gjsify is on PATH at all', async () => {
            const verdict = verifyPathResolution({
                binName: 'gjsify',
                binDir,
                resolvedBin: null,
                runningVersion: undefined,
                targetVersion: '0.31.0',
                platform: 'linux',
            });
            expect(verdict.ok).toBe(false);
            const message = verdict.ok ? '' : verdict.message;
            expect(message.includes(binDir)).toBe(true);
        });

        await it('treats win32 paths case-insensitively, so a correct install is not called shadowed', async () => {
            // `C:\Users\X\.local\bin` and `c:\users\x\.local\bin` are ONE
            // directory on Windows. A case-sensitive compare fails a good install.
            const verdict = verifyPathResolution({
                binName: 'gjsify',
                binDir: 'C:\\Users\\X\\.local\\bin',
                resolvedBin: 'c:\\users\\x\\.local\\bin\\gjsify.cmd',
                runningVersion: '0.31.0',
                targetVersion: '0.31.0',
                platform: 'win32',
            });
            expect(verdict.ok).toBe(true);
        });

        await it('keeps the same paths DISTINCT on linux, where case matters', async () => {
            const verdict = verifyPathResolution({
                binName: 'gjsify',
                binDir: '/home/U/.local/bin',
                resolvedBin: '/home/u/.local/bin/gjsify',
                runningVersion: '0.26.0',
                targetVersion: '0.31.0',
                platform: 'linux',
            });
            expect(verdict.ok).toBe(false);
        });
    });
    await describe('globalLayoutIsDefault', async () => {
        // The gate that keeps the PATH verdict from firing where it is useless.
        // `tests/e2e/global-install-engine` installs into a temp prefix it never
        // puts on PATH, and the first version of this change failed it — the
        // verdict was TRUE ("PATH does not point here") and worthless, because
        // the caller chose that location. CI caught it; this pins the rule.
        await it('is true for the untouched user layout', async () => {
            expect(globalLayoutIsDefault({})).toBe(true);
        });

        await it('is false once the prefix is redirected', async () => {
            expect(globalLayoutIsDefault({ GJSIFY_GLOBAL_PREFIX: '/tmp/harness' })).toBe(false);
        });

        await it('is false once the bin dir is redirected', async () => {
            expect(globalLayoutIsDefault({ GJSIFY_GLOBAL_BIN_DIR: '/tmp/harness/bin' })).toBe(false);
        });

        await it('ignores unrelated environment', async () => {
            expect(globalLayoutIsDefault({ PATH: '/usr/bin', XDG_DATA_HOME: '/x' })).toBe(true);
        });
    });
};
