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

import { buildCmdShim, buildLauncherShims, buildNativeEnvPreamble, parseShebang } from './bin-shim.js';
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

    // The `sh` preamble every GJS launcher carries so `imports.gi.X` resolves
    // against the installed `@gjsify/*` prebuilds.
    //
    // The regression these pin down (v0.24.1): the preamble used to EMBED the
    // directories found at install time, so a scan that came back empty — for
    // any reason, at that one moment — produced a launcher with no preamble at
    // all and nothing said so. `gjsify build` then died with "no usable bundler
    // engine under GJS" in an unrelated project, which reads as a broken
    // install rather than a stale launcher. So the assertions are about SHAPE:
    // the launcher must name WHERE to look, not WHAT was there once.
    await describe('buildNativeEnvPreamble', async () => {
        await it('derives the env from disk at launch time, not from a baked list', async () => {
            const sh = buildNativeEnvPreamble('/opt/prefix', [], { platform: 'linux', arch: 'x64' });

            // Scoped + unscoped, which is what makes a package installed LATER
            // visible without re-linking the launcher.
            expect(sh).toContain(`'/opt/prefix'/node_modules/@*/*/prebuilds/linux-x64`);
            expect(sh).toContain(`'/opt/prefix'/node_modules/*/prebuilds/linux-x64`);
            expect(sh).toContain('for gjsify_d in');
            expect(sh).toContain('[ -d "$gjsify_d" ] || continue');
            expect(sh).toContain('export GI_TYPELIB_PATH LD_LIBRARY_PATH');
            // Nothing found at write time must NOT collapse to "no preamble" —
            // that is exactly the failure mode being removed.
            expect(sh.length > 0).toBe(true);
        });

        await it('probes the legacy uname spelling too, for pre-rename tarballs', async () => {
            const sh = buildNativeEnvPreamble('/opt/prefix', [], { platform: 'linux', arch: 'x64' });
            expect(sh).toContain('/prebuilds/linux-x86_64');
        });

        await it('takes a directory only when it holds a typelib', async () => {
            // `prebuilds/<os>-<arch>/` is ALSO the prebuildify convention, so a
            // plain directory match sweeps in `bare-fs` & co — no typelib, and
            // a directory of foreign shared objects ahead of the system ones on
            // the loader path. `detectNativePackages` never returned those (it
            // keys on `gjsify.prebuilds`); this restores that from disk alone.
            const sh = buildNativeEnvPreamble('/opt/prefix', [], { platform: 'linux', arch: 'x64' });
            expect(sh).toContain('"$gjsify_d"/*.typelib');
            expect(sh).toContain('if [ -f "$gjsify_t" ]');
        });

        await it('preserves an inherited value as a suffix', async () => {
            const sh = buildNativeEnvPreamble('/opt/prefix', [], { platform: 'linux', arch: 'x64' });
            expect(sh).toContain('${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}');
            expect(sh).toContain('${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}');
        });

        await it('exports the loader variable the HOST consults', async () => {
            const mac = buildNativeEnvPreamble('/opt/prefix', [], { platform: 'darwin', arch: 'arm64' });
            // dyld never reads LD_LIBRARY_PATH — exporting it on a Mac left
            // every darwin-arm64 prebuild unloadable.
            expect(mac).toContain('export GI_TYPELIB_PATH DYLD_LIBRARY_PATH');
            expect(mac).toContain('/prebuilds/darwin-arm64');
            // `DYLD_LIBRARY_PATH` CONTAINS `LD_LIBRARY_PATH`, so the ELF
            // variable has to be looked for with its own name freed of it.
            expect(mac.split('DYLD_LIBRARY_PATH').join('').includes('LD_LIBRARY_PATH')).toBe(false);
        });

        await it('embeds only the hits a single-root scan cannot see', async () => {
            const sh = buildNativeEnvPreamble(
                '/opt/prefix',
                [
                    // Inside the scan root — the loop finds it; embedding it
                    // would reintroduce the snapshot it replaces.
                    '/opt/prefix/node_modules/@gjsify/rolldown-native/prebuilds/linux-x64',
                    // In an ANCESTOR's node_modules (hoisted layout): the walk
                    // in `detectNativePackages` finds it, a one-root scan cannot.
                    '/opt/node_modules/@gjsify/webgl/prebuilds/linux-x64',
                ],
                { platform: 'linux', arch: 'x64' },
            );
            expect(sh).toContain(`gjsify_np='/opt/node_modules/@gjsify/webgl/prebuilds/linux-x64'`);
            expect(sh.includes(`gjsify_np='/opt/prefix/node_modules/@gjsify/rolldown-native`)).toBe(false);
        });

        await it('keeps the baked form on win32, where PATH is the DLL search path', async () => {
            const win = buildNativeEnvPreamble('C:/prefix', ['C:/prefix/node_modules/@gjsify/x/prebuilds/win32-x64'], {
                platform: 'win32',
                arch: 'x64',
            });
            // The real Windows launchers are the .cmd/.ps1 companions built
            // from the same list; this `sh` file is only reachable from
            // git-bash, and `PATH` (`;`-separated) is the loader variable there.
            expect(win).toContain('export GI_TYPELIB_PATH PATH');
            expect(win).toContain(';');
            expect(win.includes('for gjsify_d in')).toBe(false);
        });

        await it('single-quotes a prefix containing a quote', async () => {
            const sh = buildNativeEnvPreamble("/opt/o'brien", [], { platform: 'linux', arch: 'x64' });
            expect(sh).toContain(`'/opt/o'\\''brien'/node_modules/`);
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
