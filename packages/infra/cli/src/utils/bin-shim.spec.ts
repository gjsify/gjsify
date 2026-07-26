// SPDX-License-Identifier: MIT
// Unit tests for the Windows bin-shim builders + the platform-injectable
// `.bin` writer.
//
// These assert the Windows branch from a Linux host by passing
// `platform: 'win32'` explicitly. What that covers: which files are written,
// and that their contents name the right interpreter, the right target and the
// right search-path syntax. What it CANNOT cover (CI-only, on a real Windows
// runner): that cmd.exe/pwsh actually execute the emitted scripts, and that
// `CreateSymbolicLink` really fails unprivileged — the failure mode this
// replaces.

import { describe, it, expect } from '@gjsify/unit';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCmdShim, buildLauncherShims, parseShebang } from './bin-shim.js';
import { writeBinEntry } from './install-backend-native.js';

export default async () => {
    await describe('parseShebang', async () => {
        await it('reads the plain `#!<prog>` form', async () => {
            expect(parseShebang('#!/bin/sh')?.prog).toBe('/bin/sh');
        });

        await it('reads `#!/usr/bin/env node` — what every npm bin declares', async () => {
            const s = parseShebang('#!/usr/bin/env node');
            expect(s?.prog).toBe('node');
            expect(s?.args).toBe('');
            expect(s?.variables).toBe('');
        });

        await it('reads `#!/usr/bin/env -S gjs -m` — what gjsify’s own bundles declare', async () => {
            const s = parseShebang('#!/usr/bin/env -S gjs -m');
            expect(s?.prog).toBe('gjs');
            expect(s?.args.trim()).toBe('-m');
        });

        await it('captures env assignments from `env -S K=V prog`', async () => {
            const s = parseShebang('#!/usr/bin/env -S FOO=bar node');
            expect(s?.variables.trim()).toBe('FOO=bar');
            expect(s?.prog).toBe('node');
        });

        await it('returns null for a non-shebang first line', async () => {
            expect(parseShebang('import x from "y";')).toBe(null);
            expect(parseShebang('')).toBe(null);
        });
    });

    await describe('buildCmdShim', async () => {
        await it('produces the three files npm writes, driven by the shebang', async () => {
            const { sh, cmd, ps1 } = buildCmdShim('../@scope/pkg/bin/tool.js', parseShebang('#!/usr/bin/env node'));
            // Batch: interpreter resolved with the local-`node.exe`-first
            // fallback, target as a backslash path relative to %dp0%.
            expect(cmd).toContain('IF EXIST "%dp0%\\node.exe"');
            expect(cmd).toContain('"%dp0%\\..\\@scope\\pkg\\bin\\tool.js"');
            // The PATHEXT scrub + `endLocal` trick suppress cmd.exe's
            // "Terminate Batch Job?" prompt (npm/cli#969).
            expect(cmd).toContain('set PATHEXT=%PATHEXT:;.JS;=;%');
            // sh: used from git-bash/MSYS/WSL, so it needs the Windows-shaped
            // $basedir_win for the interpreter's script argument.
            expect(sh.startsWith('#!/bin/sh\n')).toBe(true);
            expect(sh).toContain('basedir_win=');
            expect(sh).toContain('"$basedir_win/../@scope/pkg/bin/tool.js"');
            // pwsh
            expect(ps1).toContain('$exe=".exe"');
            expect(ps1).toContain('"$basedir/node$exe"');
        });

        await it('threads a `gjs -m` shebang’s args through all three files', async () => {
            const { sh, cmd, ps1 } = buildCmdShim('../pkg/dist/cli.gjs.mjs', parseShebang('#!/usr/bin/env -S gjs -m'));
            expect(cmd).toContain('"%_prog%" -m ');
            expect(sh).toContain('PROG_EXE="$basedir/gjs.exe"');
            expect(sh).toContain(' -m "$basedir_win/../pkg/dist/cli.gjs.mjs"');
            expect(ps1).toContain('"$basedir/gjs$exe"');
        });

        await it('emits `@SET` lines for shebang env assignments', async () => {
            const { cmd } = buildCmdShim('../pkg/bin/x.js', parseShebang('#!/usr/bin/env -S FOO=bar node'));
            expect(cmd).toContain('@SET FOO=bar');
        });

        await it('invokes the target directly when it has no shebang', async () => {
            const { sh, cmd, ps1 } = buildCmdShim('../pkg/bin/native.exe', null);
            expect(cmd).toContain('"%dp0%\\..\\pkg\\bin\\native.exe"');
            expect(sh).toContain('exec "$basedir/../pkg/bin/native.exe"');
            expect(ps1).toContain('"$basedir/../pkg/bin/native.exe"');
        });

        await it('normalises a backslash-shaped relative target to `/` for the sh script', async () => {
            const { sh } = buildCmdShim('..\\pkg\\bin\\tool.js', parseShebang('#!/usr/bin/env node'));
            expect(sh).toContain('"$basedir_win/../pkg/bin/tool.js"');
        });
    });

    await describe('buildLauncherShims', async () => {
        await it('calls the interpreter by name with an absolute target', async () => {
            const { cmd, ps1 } = buildLauncherShims({ interpreter: 'node', target: 'C:\\g\\lib\\index.js' });
            expect(cmd).toContain('node "C:\\g\\lib\\index.js" %*');
            expect(ps1).toContain('& "node" "C:\\g\\lib\\index.js" $args');
        });

        await it('passes interpreter args (gjs -m)', async () => {
            const { cmd, ps1 } = buildLauncherShims({
                interpreter: 'gjs',
                interpreterArgs: ['-m'],
                target: 'C:\\g\\dist\\cli.gjs.mjs',
            });
            expect(cmd).toContain('gjs -m "C:\\g\\dist\\cli.gjs.mjs" %*');
            expect(ps1).toContain('& "gjs" "-m" "C:\\g\\dist\\cli.gjs.mjs" $args');
        });

        await it('PREPENDS to search-path variables instead of clobbering them', async () => {
            // Clobbering PATH on Windows would nuke the process's entire
            // command + DLL search path — and PATH is exactly where the
            // prebuild dirs have to go, since Windows has no DYLD/LD analogue.
            const { cmd, ps1 } = buildLauncherShims({
                interpreter: 'gjs',
                interpreterArgs: ['-m'],
                target: 'C:\\g\\dist\\cli.gjs.mjs',
                prependEnv: { GI_TYPELIB_PATH: 'C:\\p\\a;C:\\p\\b', PATH: 'C:\\p\\a;C:\\p\\b' },
            });
            expect(cmd).toContain('@SET "PATH=C:\\p\\a;C:\\p\\b;%PATH%"');
            expect(cmd).toContain('@SET "GI_TYPELIB_PATH=C:\\p\\a;C:\\p\\b;%GI_TYPELIB_PATH%"');
            expect(ps1).toContain('$env:PATH = "C:\\p\\a;C:\\p\\b;" + $env:PATH');
        });

        await it('emits no assignments when there is nothing to prepend', async () => {
            const { cmd, ps1 } = buildLauncherShims({ interpreter: 'node', target: '/x/y.js' });
            expect(cmd.includes('@SET')).toBe(false);
            expect(ps1.includes('$env:')).toBe(false);
        });
    });

    await describe('writeBinEntry (platform injected)', async () => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-bin-entry-'));
        try {
            const binDir = join(root, 'node_modules', '.bin');
            const pkgBin = join(root, 'node_modules', 'tool', 'bin', 'tool.js');
            mkdirSync(binDir, { recursive: true });
            mkdirSync(join(root, 'node_modules', 'tool', 'bin'), { recursive: true });
            writeFileSync(pkgBin, '#!/usr/bin/env node\nconsole.log("hi");\n');

            await it('writes the sh + .cmd + .ps1 trio on win32', async () => {
                writeBinEntry({ binDir, binName: 'tool-win', targetAbs: pkgBin, platform: 'win32' });
                const base = join(binDir, 'tool-win');
                expect(existsSync(base)).toBe(true);
                expect(existsSync(`${base}.cmd`)).toBe(true);
                expect(existsSync(`${base}.ps1`)).toBe(true);
                // Not a symlink — the old code path produced one (or an
                // unrunnable copy), and Windows can execute neither.
                expect(lstatSync(base).isSymbolicLink()).toBe(false);
                // The shebang was read off the real file, so the shims know to
                // run it with node.
                expect(readFileSync(`${base}.cmd`, 'utf8')).toContain('node.exe');
                expect(readFileSync(`${base}.cmd`, 'utf8')).toContain('tool\\bin\\tool.js');
            });

            await it('still writes a relative symlink on POSIX', async () => {
                writeBinEntry({ binDir, binName: 'tool-posix', targetAbs: pkgBin, platform: 'linux' });
                const base = join(binDir, 'tool-posix');
                expect(lstatSync(base).isSymbolicLink()).toBe(true);
                // No stray Windows companions on a POSIX install.
                expect(existsSync(`${base}.cmd`)).toBe(false);
                expect(existsSync(`${base}.ps1`)).toBe(false);
            });

            await it('is idempotent — a re-install overwrites every companion', async () => {
                writeBinEntry({ binDir, binName: 'tool-again', targetAbs: pkgBin, platform: 'win32' });
                writeBinEntry({ binDir, binName: 'tool-again', targetAbs: pkgBin, platform: 'win32' });
                expect(existsSync(join(binDir, 'tool-again.cmd'))).toBe(true);
            });

            await it('falls back to a direct invocation for a shebang-less target', async () => {
                const raw = join(root, 'node_modules', 'tool', 'bin', 'raw.bin');
                writeFileSync(raw, 'not a script\n');
                writeBinEntry({ binDir, binName: 'raw', targetAbs: raw, platform: 'win32' });
                const cmd = readFileSync(join(binDir, 'raw.cmd'), 'utf8');
                expect(cmd).toContain('"%dp0%\\..\\tool\\bin\\raw.bin"');
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
};
