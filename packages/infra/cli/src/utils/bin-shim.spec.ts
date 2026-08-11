// SPDX-License-Identifier: MIT
//
// The Windows branch is asserted from a Linux host by passing `platform:
// 'win32'` explicitly: which files get written, and whether their contents name
// the right interpreter, target and search-path syntax. NOT coverable off-host
// (CI-only, real Windows runner): that cmd.exe/pwsh actually execute the emitted
// scripts, and that `CreateSymbolicLink` really fails unprivileged — the failure
// mode this replaces.

import { describe, it, expect } from '@gjsify/unit';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    buildCmdShim,
    buildLauncherShims,
    buildNativeEnvPreamble,
    buildShLauncher,
    isGjsBundlePath,
    normalizeBinMap,
    parseShebang,
    pickBinMap,
} from './bin-shim.js';
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
            // Batch: interpreter resolved local-`node.exe`-first, target as a
            // backslash path relative to %dp0%.
            expect(cmd).toContain('IF EXIST "%dp0%\\node.exe"');
            expect(cmd).toContain('"%dp0%\\..\\@scope\\pkg\\bin\\tool.js"');
            // The PATHEXT scrub + `endLocal` trick suppress cmd.exe's
            // "Terminate Batch Job?" prompt (npm/cli#969).
            expect(cmd).toContain('set PATHEXT=%PATHEXT:;.JS;=;%');
            // The `sh` member runs from git-bash/MSYS/WSL, so it needs the
            // Windows-shaped $basedir_win for the interpreter's script argument.
            expect(sh.startsWith('#!/bin/sh\n')).toBe(true);
            expect(sh).toContain('basedir_win=');
            expect(sh).toContain('"$basedir_win/../@scope/pkg/bin/tool.js"');
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
            // Clobbering PATH on Windows nukes the process's entire command + DLL
            // search path, and PATH is exactly where the prebuild dirs have to go
            // — Windows has no DYLD/LD analogue.
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

        // Windows is the majority no-`gjs` host, and .cmd/.ps1 are the members
        // cmd.exe and pwsh actually reach.
        await it('falls back to a second interpreter when the first is absent', async () => {
            const { cmd, ps1 } = buildLauncherShims({
                interpreter: 'gjs',
                interpreterArgs: ['-m'],
                target: 'C:\\g\\dist\\cli.gjs.mjs',
                fallback: { interpreter: 'node', target: 'C:\\g\\lib\\index.js' },
            });
            expect(cmd).toContain('@where gjs >NUL 2>NUL');
            expect(cmd).toContain('gjs -m "C:\\g\\dist\\cli.gjs.mjs" %*');
            expect(cmd).toContain('node "C:\\g\\lib\\index.js" %*');
            // IF/ELSE on ERRORLEVEL, not `&&`/`||` chaining — the latter swallows
            // the child's own exit code, which callers key on.
            expect(cmd).toContain('@IF %ERRORLEVEL% EQU 0 (');
            expect(ps1).toContain('Get-Command "gjs" -ErrorAction SilentlyContinue');
            expect(ps1).toContain('$exe = "gjs"; $exeArgs = @("-m"); $script = "C:\\g\\dist\\cli.gjs.mjs"');
            expect(ps1).toContain('$exe = "node"; $exeArgs = @(); $script = "C:\\g\\lib\\index.js"');
            expect(ps1).toContain('exit $LASTEXITCODE');
        });

        await it('keeps the single-interpreter shape when no fallback is given', async () => {
            const { cmd, ps1 } = buildLauncherShims({
                interpreter: 'gjs',
                interpreterArgs: ['-m'],
                target: 'C:\\g\\dist\\cli.gjs.mjs',
            });
            expect(cmd.includes('@where')).toBe(false);
            expect(ps1.includes('Get-Command')).toBe(false);
        });

        await it('still prepends the search paths in the fallback shape', async () => {
            const { cmd, ps1 } = buildLauncherShims({
                interpreter: 'gjs',
                interpreterArgs: ['-m'],
                target: 'C:\\g\\dist\\cli.gjs.mjs',
                prependEnv: { PATH: 'C:\\p\\a' },
                fallback: { interpreter: 'node', target: 'C:\\g\\lib\\index.js' },
            });
            expect(cmd).toContain('@SET "PATH=C:\\p\\a;%PATH%"');
            expect(ps1).toContain('$env:PATH = "C:\\p\\a;" + $env:PATH');
        });
    });

    // The `sh` preamble every GJS launcher carries so `imports.gi.X` resolves
    // against the installed `@gjsify/*` prebuilds.
    //
    // The regression these pin down: the preamble used to EMBED the directories
    // found at install time, so a scan that came back empty at that one moment
    // produced a launcher with no preamble and nothing said so — `gjsify build`
    // then died with "no usable bundler engine under GJS", which reads as a broken
    // install rather than a stale launcher. Hence assertions about SHAPE: the
    // launcher must name WHERE to look, not WHAT was there once.
    await describe('buildNativeEnvPreamble', async () => {
        await it('derives the env from disk at launch time, not from a baked list', async () => {
            const sh = buildNativeEnvPreamble('/opt/prefix', [], { platform: 'linux', arch: 'x64' });

            // Scoped + unscoped is what makes a package installed LATER visible
            // without re-linking the launcher.
            expect(sh).toContain(`'/opt/prefix'/node_modules/@*/*/prebuilds/linux-x64`);
            expect(sh).toContain(`'/opt/prefix'/node_modules/*/prebuilds/linux-x64`);
            expect(sh).toContain('for gjsify_d in');
            expect(sh).toContain('[ -d "$gjsify_d" ] || continue');
            expect(sh).toContain('export GI_TYPELIB_PATH LD_LIBRARY_PATH');
            // Nothing found at write time must NOT collapse to "no preamble".
            expect(sh.length > 0).toBe(true);
        });

        await it('probes the legacy uname spelling too, for pre-rename tarballs', async () => {
            const sh = buildNativeEnvPreamble('/opt/prefix', [], { platform: 'linux', arch: 'x64' });
            expect(sh).toContain('/prebuilds/linux-x86_64');
        });

        await it('takes a directory only when it holds a typelib', async () => {
            // `prebuilds/<os>-<arch>/` is ALSO the prebuildify convention, so a
            // plain directory match sweeps in `bare-fs` & co: no typelib, and
            // foreign shared objects ahead of the system ones on the loader path.
            // `detectNativePackages` excluded those by keying on `gjsify.prebuilds`;
            // the typelib probe restores that from disk alone.
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
            // dyld never reads LD_LIBRARY_PATH — exporting it on a Mac left every
            // darwin-arm64 prebuild unloadable.
            expect(mac).toContain('export GI_TYPELIB_PATH DYLD_LIBRARY_PATH');
            expect(mac).toContain('/prebuilds/darwin-arm64');
            // `DYLD_LIBRARY_PATH` CONTAINS `LD_LIBRARY_PATH` as a substring, so the
            // ELF variable must be searched for with the darwin one stripped out.
            expect(mac.split('DYLD_LIBRARY_PATH').join('').includes('LD_LIBRARY_PATH')).toBe(false);
        });

        await it('embeds only the hits a single-root scan cannot see', async () => {
            const sh = buildNativeEnvPreamble(
                '/opt/prefix',
                [
                    // Inside the scan root — the loop finds it, and embedding it
                    // would reintroduce the snapshot this replaces.
                    '/opt/prefix/node_modules/@gjsify/rolldown-native/prebuilds/linux-x64',
                    // In an ANCESTOR's node_modules (hoisted): `detectNativePackages`
                    // walks up to it, a one-root scan cannot.
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
            // The real Windows launchers are the .cmd/.ps1 companions built from the
            // same list; this `sh` file is only reachable from git-bash, where
            // `PATH` (`;`-separated) is the loader variable.
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
                // Not a symlink: Windows can execute neither a symlink nor a copy.
                expect(lstatSync(base).isSymbolicLink()).toBe(false);
                // The shebang is read off the real file, so the shims know to run
                // it with node.
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

    // ADR 0017 moved each prebuild into a per-target package, so on a musl host the
    // directory to find is `prebuilds/linux-arm64-musl/`. The preamble used to drop
    // `libc` on the way to `prebuildDirCandidates` while `detectNativePackages` kept
    // it — one question, two answers.
    await describe('buildNativeEnvPreamble — libc', async () => {
        /** The prebuild-dir names the `for` line globs, in order. */
        const globbedDirs = (sh: string): string[] => {
            const forLine = sh.split('\n').find((l) => l.startsWith('for gjsify_d in')) ?? '';
            return forLine
                .split(' ')
                .filter((t) => t.includes('/prebuilds/'))
                .map((t) => t.slice(t.lastIndexOf('/') + 1));
        };

        await it('globs the musl directory FIRST on a musl host', async () => {
            const dirs = globbedDirs(
                buildNativeEnvPreamble('/opt/p', [], { platform: 'linux', arch: 'arm64', libc: 'musl' }),
            );
            // Most-specific first; the plain token stays as the fallback.
            expect(dirs[0]).toBe('linux-arm64-musl');
            expect(dirs.includes('linux-arm64')).toBe(true);
            expect(dirs.indexOf('linux-arm64-musl')).toBeLessThan(dirs.indexOf('linux-arm64'));
        });

        await it('does not invent a musl directory on a glibc host', async () => {
            const sh = buildNativeEnvPreamble('/opt/p', [], { platform: 'linux', arch: 'arm64', libc: 'glibc' });
            expect(sh).not.toContain('linux-arm64-musl');
        });

        await it('ignores a musl claim off linux — the grammar has no such target', async () => {
            const sh = buildNativeEnvPreamble('/opt/p', [], { platform: 'darwin', arch: 'arm64', libc: 'musl' });
            expect(sh).not.toContain('musl');
        });
    });

    await describe('pickBinMap', async () => {
        await it('prefers `gjsify.bin` over the npm `bin` field', async () => {
            const picked = pickBinMap('@gjsify/cli', {
                bin: { gjsify: 'lib/index.js' },
                gjsify: { bin: { gjsify: 'dist/cli.gjs.mjs' } },
            });
            expect(picked?.map.get('gjsify')).toBe('dist/cli.gjs.mjs');
            expect(picked?.isGjsBin).toBe(true);
        });

        await it('falls back to npm `bin`, flagged as NOT a gjs bin', async () => {
            const picked = pickBinMap('lodash', { bin: { lodash: 'bin/lodash.js' } });
            expect(picked?.map.get('lodash')).toBe('bin/lodash.js');
            expect(picked?.isGjsBin).toBe(false);
        });

        await it('returns null when a package declares no bin at all', async () => {
            expect(pickBinMap('plain', {})).toBeNull();
        });

        // The regression: `@gjsify/cli` declares BOTH, and the npm map used to be
        // discarded — so a host without `gjs` got `exec gjs -m …` = exit 127 while a
        // working Node entry sat in the same package.
        await it('carries the npm map alongside when a package declares both', async () => {
            const picked = pickBinMap('@gjsify/cli', {
                bin: { gjsify: 'lib/index.js' },
                gjsify: { bin: { gjsify: 'dist/cli.gjs.mjs' } },
            });
            expect(picked?.map.get('gjsify')).toBe('dist/cli.gjs.mjs');
            expect(picked?.nodeFallback?.get('gjsify')).toBe('lib/index.js');
        });

        await it('has no fallback when only `gjsify.bin` is declared', async () => {
            const picked = pickBinMap('@gjsify/only-gjs', { gjsify: { bin: { tool: 'dist/t.gjs.mjs' } } });
            expect(picked?.isGjsBin).toBe(true);
            expect(picked?.nodeFallback).toBeNull();
        });

        await it('has no fallback when only the npm `bin` is declared', async () => {
            expect(pickBinMap('lodash', { bin: { lodash: 'bin/lodash.js' } })?.nodeFallback).toBeNull();
        });

        await it('expands the string shorthand against the unscoped name', async () => {
            expect(normalizeBinMap('@scope/tool', 'bin/run.js').get('tool')).toBe('bin/run.js');
        });
    });

    await describe('buildShLauncher', async () => {
        await it('wraps a GJS bundle in `gjs -m` and carries the env preamble', async () => {
            const sh = buildShLauncher('/opt/p/dist/cli.gjs.mjs', {
                envPreamble: 'export FOO=1\n',
                isGjsBundle: true,
            });
            expect(sh).toContain('export FOO=1');
            expect(sh).toContain(`exec gjs -m '/opt/p/dist/cli.gjs.mjs' "$@"`);
        });

        await it('exec s a non-bundle target directly and omits the preamble', async () => {
            const sh = buildShLauncher('/opt/p/bin/tool', { envPreamble: 'export FOO=1\n', isGjsBundle: false });
            expect(sh).not.toContain('FOO');
            expect(sh).toContain(`exec '/opt/p/bin/tool' "$@"`);
        });

        await it('quotes a path containing a single quote', async () => {
            expect(buildShLauncher("/o'brien/x.mjs", { isGjsBundle: true })).toContain(`'/o'\\''brien/x.mjs'`);
        });

        await it('dispatches at run time when a Node fallback is given', async () => {
            const sh = buildShLauncher('/opt/p/dist/cli.gjs.mjs', {
                envPreamble: 'export GI_TYPELIB_PATH=/x\n',
                isGjsBundle: true,
                nodeFallbackAbs: '/opt/p/lib/index.js',
            });
            expect(sh).toContain('command -v gjs');
            expect(sh).toContain(`exec gjs -m '/opt/p/dist/cli.gjs.mjs' "$@"`);
            expect(sh).toContain(`exec node '/opt/p/lib/index.js' "$@"`);
            // gjs stays FIRST: which runtime wins on a host carrying both is a
            // separate decision from making the shim runnable at all.
            expect(sh.indexOf('exec gjs')).toBeLessThan(sh.indexOf('exec node'));
            // The preamble configures the GI search path only, so it belongs in the
            // gjs branch; around a Node exec it would be inert and misleading.
            expect(sh.indexOf('GI_TYPELIB_PATH')).toBeGreaterThan(sh.indexOf('command -v gjs'));
        });

        await it('emits no fallback branch when none is given', async () => {
            const sh = buildShLauncher('/opt/p/dist/cli.gjs.mjs', { isGjsBundle: true });
            expect(sh).not.toContain('command -v gjs');
            expect(sh).not.toContain('exec node');
        });

        await it('quotes the fallback path too', async () => {
            const sh = buildShLauncher('/a/x.gjs.mjs', { isGjsBundle: true, nodeFallbackAbs: "/o'brien/i.js" });
            expect(sh).toContain(`'/o'\\''brien/i.js'`);
        });

        await it('classifies bundle paths by extension', async () => {
            expect(isGjsBundlePath('/a/cli.gjs.mjs')).toBe(true);
            expect(isGjsBundlePath('/a/x.mjs')).toBe(true);
            expect(isGjsBundlePath('/a/lib/index.js')).toBe(false);
        });
    });

    // Regression: a Node-LESS GJS host (postmarketOS/aarch64, gjs 1.88, no node)
    // got `env: can't execute 'node'` from `.bin/gjsify`, because `linkBins` linked
    // the npm `bin` (a `#!/usr/bin/env node` script) and ignored `gjsify.bin` — and
    // the dead shim took `gjsify build` down with it. A Node-less host still needs a
    // runnable bin; the launcher is no longer the only GI_TYPELIB_PATH exporter
    // (ADR 0021 moved in-process resolution into `activateNativePrebuilds`).
    await describe('writeBinEntry — gjs bins', async () => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-binentry-gjs-'));
        try {
            const binDir = join(root, 'node_modules', '.bin');
            const pkgDir = join(root, 'node_modules', '@gjsify', 'cli');
            mkdirSync(binDir, { recursive: true });
            mkdirSync(join(pkgDir, 'dist'), { recursive: true });
            const bundle = join(pkgDir, 'dist', 'cli.gjs.mjs');
            writeFileSync(bundle, '// bundle\n');

            await it('writes a gjs launcher instead of linking the node shebang', async () => {
                writeBinEntry({
                    binDir,
                    binName: 'gjsify',
                    targetAbs: bundle,
                    platform: 'linux',
                    gjs: { envPreamble: 'export GI_TYPELIB_PATH=/p\n', prebuildDirs: ['/p'] },
                });
                const written = readFileSync(join(binDir, 'gjsify'), 'utf8');
                expect(written).toContain('#!/bin/sh');
                expect(written).not.toContain('/usr/bin/env node');
                expect(written).toContain('export GI_TYPELIB_PATH=/p');
                expect(written).toContain('exec gjs -m');
            });

            await it('replaces a stale plain link left by an earlier install', async () => {
                writeBinEntry({ binDir, binName: 'stale', targetAbs: bundle, platform: 'linux' });
                writeBinEntry({
                    binDir,
                    binName: 'stale',
                    targetAbs: bundle,
                    platform: 'linux',
                    gjs: { envPreamble: '', prebuildDirs: [] },
                });
                expect(lstatSync(join(binDir, 'stale')).isSymbolicLink()).toBe(false);
                expect(readFileSync(join(binDir, 'stale'), 'utf8')).toContain('exec gjs -m');
            });

            await it('writes cmd/ps1 companions for a gjs bin on win32', async () => {
                writeBinEntry({
                    binDir,
                    binName: 'wintool',
                    targetAbs: bundle,
                    platform: 'win32',
                    gjs: { envPreamble: '', prebuildDirs: ['C:/p/prebuilds/win32-x64'] },
                });
                const cmd = readFileSync(join(binDir, 'wintool.cmd'), 'utf8');
                expect(cmd).toContain('gjs -m');
                expect(cmd).toContain('GI_TYPELIB_PATH');
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
};
