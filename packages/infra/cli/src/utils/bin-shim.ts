// SPDX-License-Identifier: ISC
// Adapted from npm's `cmd-shim`
// (refs/npm-cli/node_modules/bin-links/node_modules/cmd-shim/lib/index.js and
// .../to-batch-syntax.js). Copyright (c) npm, Inc. and Contributors. ISC.
// Modifications: rewritten as pure TypeScript string builders (no fs, no
// `process.platform` read) so the Windows branch is unit-testable from a Linux
// host, and split into two entry points — one for linking a package bin that
// carries its own shebang (`buildCmdShim`, the faithful npm port) and one for
// the *generated* launchers gjsify writes itself (`buildLauncherShims`).
//
// WHY THIS EXISTS
//
// A bin is made runnable on POSIX with a symlink into `node_modules/.bin/`;
// the kernel reads the target's `#!` line and runs the interpreter. Windows has
// neither of those mechanisms: `.bin/<name>` with no extension is not on
// PATHEXT, and there is no shebang handling. npm's answer — the de-facto
// standard every Windows Node toolchain follows — is to write three sibling
// files:
//
//   `<name>`       a POSIX `sh` script (used by git-bash / MSYS / WSL / Cygwin)
//   `<name>.cmd`   a batch file (used by cmd.exe and by `npx`/`npm run`)
//   `<name>.ps1`   a PowerShell script (used by pwsh)
//
// All three re-derive the interpreter from the target's shebang, so a bin
// declaring `#!/usr/bin/env node` and one declaring `#!/usr/bin/env -S gjs -m`
// both work without the caller knowing which it is.

import { detectHostLibc, type HostLibc, libraryPathVar, prebuildDirCandidates } from './detect-native-packages.js';
import { dyldDefaultFallbackDirs } from './system-gi.js';

/** The three sibling files a Windows bin entry consists of. */
export interface WindowsShimFiles {
    /** POSIX `sh` script — the extension-less `<name>` file. */
    sh: string;
    /** Batch file — `<name>.cmd`. */
    cmd: string;
    /** PowerShell script — `<name>.ps1`. */
    ps1: string;
}

/** A parsed `#!` line. */
export interface Shebang {
    /** Leading `KEY=VALUE ` assignments from `env -S KEY=VALUE prog` (may be ''). */
    variables: string;
    /** The interpreter, e.g. `node` or `gjs`. */
    prog: string;
    /** Everything after the interpreter, e.g. ` -m` (may be ''). */
    args: string;
}

// Matches `#!<prog> <args>` and `#!/usr/bin/env [-S] [K=V ...] <prog> <args>`.
// Verbatim from cmd-shim's `shebangExpr`.
const SHEBANG_RE = /^#!\s*(?:\/usr\/bin\/env\s+(?:-S\s+)?((?:[^ \t=]+=[^ \t=]+\s+)*))?([^ \t]+)(.*)$/;

/**
 * Parse the first line of a bin file. Returns `null` when it is not a shebang
 * — cmd-shim then treats the target as directly executable.
 */
export function parseShebang(firstLine: string): Shebang | null {
    const m = SHEBANG_RE.exec(firstLine.trim());
    if (!m) return null;
    return { variables: m[1] ?? '', prog: m[2] ?? '', args: m[3] ?? '' };
}

/** `$VAR` / `${VAR}` → `%VAR%`. Port of cmd-shim's `replaceDollarWithPercentPair`. */
function replaceDollarWithPercentPair(value: string): string {
    return value.replace(/\$\{?([^$@#?\- \t{}:]+)\}?/g, (_all, name: string) => `%${name}%`);
}

/** `K=V K2=V2 ` → `@SET K=V\r\n@SET K2=V2\r\n`. Port of `convertToSetCommands`. */
function convertToSetCommands(variableString: string): string {
    let out = '';
    for (const declaration of variableString.split(' ')) {
        const eq = declaration.indexOf('=');
        if (eq <= 0) continue;
        const key = declaration.slice(0, eq).trim();
        const value = declaration.slice(eq + 1).trim();
        if (key && value) out += `@SET ${key}=${replaceDollarWithPercentPair(value)}\r\n`;
    }
    return out;
}

// The `:find_dp0` subroutine trick — see npm/cmd-shim#10 and npm/cli#969.
const CMD_HEAD =
    '@ECHO off\r\n' +
    'GOTO start\r\n' +
    ':find_dp0\r\n' +
    'SET dp0=%~dp0\r\n' +
    'EXIT /b\r\n' +
    ':start\r\n' +
    'SETLOCAL\r\n' +
    'CALL :find_dp0\r\n';

// Resolves `$basedir` and, under git-bash/MSYS/WSL, the Windows-shaped
// `$basedir_win` the interpreter needs for its script argument.
const SH_BASEDIR =
    `basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")\n` +
    'basedir_win="$basedir"\n' +
    '\n' +
    'case `uname -a` in\n' +
    '  *CYGWIN*|*MINGW*|*MSYS*)\n' +
    '    if command -v cygpath > /dev/null 2>&1; then\n' +
    '      basedir_win=`cygpath -w "$basedir"`\n' +
    '    fi\n' +
    '  ;;\n' +
    '  *WSL2*)\n' +
    '    if command -v wslpath > /dev/null 2>&1; then\n' +
    '      basedir_win="$(wslpath -w "$basedir" 2> /dev/null)"\n' +
    '      if [ $? -ne 0 ] || [ -z "$basedir_win" ]; then\n' +
    '        echo "Error: wslpath failed to convert path. WSL environment may be misconfigured." >&2\n' +
    '        exit 1\n' +
    '      fi\n' +
    '    fi\n' +
    '  ;;\n' +
    'esac\n' +
    '\n';

const PS1_HEAD =
    '#!/usr/bin/env pwsh\n' +
    '$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n' +
    '\n' +
    '$exe=""\n' +
    'if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {\n' +
    '  # Fix case when both the Windows and Linux builds of Node\n' +
    '  # are installed in the same directory\n' +
    '  $exe=".exe"\n' +
    '}\n';

/**
 * Build the three Windows shim files for a package bin.
 *
 * @param relTargetPosix POSIX-style path from the `.bin` directory to the real
 * bin file (i.e. `path.relative(binDir, target)` with `\` normalised to `/`).
 * @param shebang the target's parsed `#!` line, or `null` when it has none —
 * in which case the shims invoke the target directly, matching cmd-shim.
 */
export function buildCmdShim(relTargetPosix: string, shebang: Shebang | null): WindowsShimFiles {
    let shTarget = relTargetPosix.split('\\').join('/');
    let target = shTarget.split('/').join('\\');
    let pwshTarget = shTarget;

    let prog = shebang?.prog ?? '';
    let args = shebang?.args ?? '';
    const variables = shebang?.variables ?? '';

    let shProg = prog ? prog.split('\\').join('/') : '';
    let pwshProg = shProg ? `"${shProg}$exe"` : '';
    let longProg = '';
    let shLongProg = '';
    let pwshLongProg = '';

    if (!prog) {
        prog = `"%dp0%\\${target}"`;
        shProg = `"$basedir/${shTarget}"`;
        pwshProg = shProg;
        args = '';
        target = '';
        shTarget = '';
        pwshTarget = '';
    } else {
        longProg = `"%dp0%\\${prog}.exe"`;
        shLongProg = `"$basedir/${prog}"`;
        pwshLongProg = `"$basedir/${prog}$exe"`;
        target = `"%dp0%\\${target}"`;
        shTarget = `"$basedir_win/${shTarget}"`;
        pwshTarget = `"$basedir/${pwshTarget}"`;
    }

    let cmd: string;
    if (longProg) {
        const trimmedArgs = args.trim();
        cmd =
            CMD_HEAD +
            convertToSetCommands(variables) +
            '\r\n' +
            `IF EXIST ${longProg} (\r\n` +
            `  SET "_prog=${longProg.replace(/(^")|("$)/g, '')}"\r\n` +
            ') ELSE (\r\n' +
            `  SET "_prog=${prog.replace(/(^")|("$)/g, '')}"\r\n` +
            ')\r\n' +
            '\r\n' +
            // Suppresses the "Terminate Batch Job? (Y/n)" prompt — npm/cli#969.
            'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & ' +
            `set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%" ${trimmedArgs} ${target} %*\r\n`;
    } else {
        cmd = `${CMD_HEAD}${prog} ${args} ${target} %*\r\n`;
    }

    let sh = `#!/bin/sh\n${SH_BASEDIR}`;
    if (shLongProg) {
        sh +=
            `PROG_EXE=${shLongProg.replace(/"$/, '.exe"')}\n` +
            'if ! [ -x "$PROG_EXE" ]; then\n' +
            `  PROG_EXE=${shLongProg}\n` +
            '  if ! [ -x "$PROG_EXE" ]; then\n' +
            `    PROG_EXE=${shProg}\n` +
            '    if ! [ -x "$PROG_EXE" ]; then\n' +
            `      PROG_EXE=${shProg}.exe\n` +
            '    fi\n' +
            '  fi\n' +
            'fi\n' +
            '\n' +
            `exec ${variables}"$PROG_EXE" ${args} ${shTarget} "$@"\n`;
    } else {
        sh += `exec ${shProg} ${args} ${shTarget} "$@"\n`;
    }

    let ps1 = PS1_HEAD;
    if (pwshLongProg) {
        ps1 +=
            '$ret=0\n' +
            `if (Test-Path ${pwshLongProg}) {\n` +
            '  # Support pipeline input\n' +
            '  if ($MyInvocation.ExpectingInput) {\n' +
            `    $input | & ${pwshLongProg} ${args} ${pwshTarget} $args\n` +
            '  } else {\n' +
            `    & ${pwshLongProg} ${args} ${pwshTarget} $args\n` +
            '  }\n' +
            '  $ret=$LASTEXITCODE\n' +
            '} else {\n' +
            '  # Support pipeline input\n' +
            '  if ($MyInvocation.ExpectingInput) {\n' +
            `    $input | & ${pwshProg} ${args} ${pwshTarget} $args\n` +
            '  } else {\n' +
            `    & ${pwshProg} ${args} ${pwshTarget} $args\n` +
            '  }\n' +
            '  $ret=$LASTEXITCODE\n' +
            '}\n' +
            'exit $ret\n';
    } else {
        ps1 +=
            '# Support pipeline input\n' +
            'if ($MyInvocation.ExpectingInput) {\n' +
            `  $input | & ${pwshProg} ${pwshTarget} $args\n` +
            '} else {\n' +
            `  & ${pwshProg} ${pwshTarget} $args\n` +
            '}\n' +
            'exit $LASTEXITCODE\n';
    }

    return { sh, cmd, ps1 };
}

/**
 * `.cmd` / `.ps1` companions for a launcher gjsify *generates* itself
 * (`linkGlobalBins`, `writeWorkspaceBinShims`) rather than links.
 *
 * Those launchers are not a symlink to a bin with a shebang — they are a
 * hand-written `sh` script that picks an interpreter and passes an ABSOLUTE
 * script path. `buildCmdShim` cannot express them (it derives everything from
 * a relative target plus a shebang), so this builds the equivalent batch /
 * PowerShell form: optional `SET` / `$env:` assignments, then
 * `<interpreter> [args] "<absolute target>" <argv>`.
 *
 * Note the interpreter is invoked by NAME (resolved through `PATH`), matching
 * the `sh` launcher's `exec gjs`/`exec node`. A missing interpreter therefore
 * fails the same way on every OS.
 */
export function buildLauncherShims(opts: {
    /** Interpreter binary name, e.g. `node` or `gjs`. */
    interpreter: string;
    /** Arguments before the script path, e.g. `['-m']` for `gjs -m`. */
    interpreterArgs?: readonly string[];
    /** Absolute path of the script to run. */
    target: string;
    /**
     * Search-path variables to PREPEND to before the call, preserving whatever
     * the caller's environment already had. Rendered with each shell's own
     * expansion syntax (`%K%` in batch, `$env:K` in PowerShell) — a plain
     * assignment would clobber `PATH`, which on Windows is also the DLL search
     * path the prebuilds have to be reachable through.
     */
    prependEnv?: Readonly<Record<string, string>>;
    /**
     * Second interpreter + script to run when the primary interpreter is not on
     * `PATH`. The batch/PowerShell counterpart of {@link buildShLauncher}'s
     * `nodeFallbackAbs` — a Windows host with no `gjs` is the majority case, and
     * the `.cmd`/`.ps1` members are the ones cmd.exe and pwsh actually reach.
     */
    fallback?: { interpreter: string; interpreterArgs?: readonly string[]; target: string };
}): { cmd: string; ps1: string } {
    const { interpreter, interpreterArgs = [], target, prependEnv = {}, fallback } = opts;
    const winTarget = target.split('/').join('\\');
    const argv = interpreterArgs.length > 0 ? `${interpreterArgs.join(' ')} ` : '';
    const entries = Object.entries(prependEnv);
    const fbTarget = fallback === undefined ? '' : fallback.target.split('/').join('\\');
    const fbArgv =
        fallback?.interpreterArgs !== undefined && fallback.interpreterArgs.length > 0
            ? `${fallback.interpreterArgs.join(' ')} `
            : '';

    let cmd = CMD_HEAD;
    for (const [key, value] of entries) cmd += `@SET "${key}=${value};%${key}%"\r\n`;
    if (fallback === undefined) {
        cmd += `${interpreter} ${argv}"${winTarget}" %*\r\n`;
    } else {
        // `where` is the batch equivalent of `command -v`; it writes to stdout,
        // so both streams are silenced. ERRORLEVEL is read via IF/ELSE rather
        // than `&&`/`||` chaining, which would swallow the child's own exit code.
        cmd +=
            `@where ${interpreter} >NUL 2>NUL\r\n` +
            `@IF %ERRORLEVEL% EQU 0 (\r\n` +
            `  ${interpreter} ${argv}"${winTarget}" %*\r\n` +
            `) ELSE (\r\n` +
            `  ${fallback.interpreter} ${fbArgv}"${fbTarget}" %*\r\n` +
            `)\r\n`;
    }

    let ps1 = '#!/usr/bin/env pwsh\n';
    for (const [key, value] of entries) ps1 += `$env:${key} = "${value};" + $env:${key}\n`;
    const ps1Args = interpreterArgs.map((a) => `"${a}" `).join('');
    if (fallback === undefined) {
        ps1 +=
            '# Support pipeline input\n' +
            'if ($MyInvocation.ExpectingInput) {\n' +
            `  $input | & "${interpreter}" ${ps1Args}"${winTarget}" $args\n` +
            '} else {\n' +
            `  & "${interpreter}" ${ps1Args}"${winTarget}" $args\n` +
            '}\n';
    } else {
        // Bind the three parts once, then call once — the alternative (a full
        // if/else around two near-identical invocation blocks, each of which
        // already branches on pipeline input) is four copies of the same call.
        const psList = (a: readonly string[]): string =>
            a.length === 0 ? '@()' : `@(${a.map((x) => `"${x}"`).join(', ')})`;
        ps1 +=
            `$exe = "${interpreter}"; $exeArgs = ${psList(interpreterArgs)}; $script = "${winTarget}"\n` +
            `if (-not (Get-Command "${interpreter}" -ErrorAction SilentlyContinue)) {\n` +
            `  $exe = "${fallback.interpreter}"; $exeArgs = ${psList(fallback.interpreterArgs ?? [])}; $script = "${fbTarget}"\n` +
            '}\n' +
            '# Support pipeline input\n' +
            'if ($MyInvocation.ExpectingInput) {\n' +
            '  $input | & $exe @exeArgs $script $args\n' +
            '} else {\n' +
            '  & $exe @exeArgs $script $args\n' +
            '}\n';
    }
    ps1 += 'exit $LASTEXITCODE\n';

    return { cmd, ps1 };
}

/** POSIX `sh` single-quoting — the one place the escape lives. */
function shQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The `sh` preamble a GJS launcher needs so `imports.gi.X` resolves against the
 * `@gjsify/*` native prebuilds installed next to it.
 *
 * WHY IT SCANS AT RUN TIME INSTEAD OF BAKING A LIST
 *
 * The typelib/library lookup happens inside the GJS runtime, before a single
 * line of the CLI bundle runs, so the env MUST be set by the launcher — the CLI
 * cannot repair it from the inside. The launcher used to bake the directories
 * `detectNativePackages()` found at INSTALL time, which makes the env a SNAPSHOT
 * of one moment:
 *
 *   - a native package installed into the same prefix LATER (`gjsify install -g
 *     @gjsify/<x>-native`, a project `gjsify install` that adds one) is invisible
 *     until something happens to rewrite the launcher;
 *   - and if the scan comes back empty for any reason, the launcher is written
 *     with NO preamble at all and nothing says so. The failure then surfaces
 *     much later and somewhere else entirely — `gjsify build` dying with "no
 *     usable bundler engine under GJS" in an unrelated project, which reads as a
 *     broken install rather than a stale launcher. That is what shipped in
 *     v0.24.1: a `~/.local/bin/gjsify` with a bare `exec gjs -m …` line while
 *     `@gjsify/rolldown-native` sat correctly installed in the prefix.
 *
 * Deriving the env from disk on every launch removes both: the launcher states
 * WHERE to look rather than WHAT was there, so it cannot go stale, and an empty
 * result is a fact about the current prefix instead of a silently frozen one.
 * The cost is a handful of shell globs per launch (they are builtins, and a
 * pattern that matches nothing stays literal and is rejected by `[ -d ]`).
 *
 * `bakedDirs` covers what a run-time scan of `scanRoot` structurally cannot see:
 * `detectNativePackages()` walks UP the directory chain, so in a hoisted layout
 * a prebuild may live in an ancestor's `node_modules`. Those are still embedded
 * verbatim; only the primary root is dynamic. Duplicates are harmless (both
 * variables are search paths).
 *
 * Windows is deliberately excluded: there the `sh` file is only reachable from
 * git-bash/MSYS, the real launchers are the `.cmd`/`.ps1` companions built by
 * {@link buildLauncherShims} from the same baked list, and `PATH` doubles as the
 * DLL search path with `;` separators. It keeps the snapshot behaviour.
 *
 * MACOS CAVEAT — the `${DYLD_LIBRARY_PATH:+…}` half of the export can never
 * fire, and the export itself does not survive a script boundary. System
 * Integrity Protection strips every `DYLD_*` variable from the environment
 * whenever a PROTECTED binary is exec'd, and `/bin/sh` is protected — so by the
 * time this preamble runs, an inherited `DYLD_LIBRARY_PATH` is already gone
 * (measured: `DYLD_LIBRARY_PATH=x /bin/sh -c 'echo $DYLD_LIBRARY_PATH'` prints
 * nothing, while the same through Homebrew's unprotected `node` prints `x`).
 * The value this preamble exports is likewise dropped again at the next
 * `/bin/sh -c` hop, which is how every package script runs. Do NOT "simplify"
 * the preservation away as dead code — it is load-bearing on Linux. And do not
 * rely on `DYLD_LIBRARY_PATH` alone to make a darwin prebuild loadable across a
 * script chain: the self-relative `@loader_path` rpath that
 * `check-prebuild-loader-path.mjs` enforces is what actually has to carry it.
 *
 * IT DOES export dyld's own default fallback list on darwin — see
 * {@link dyldFallbackPreamble}. That is a CONSTANT, so it carries none of the
 * staleness that rules out the alternatives: BAKING `systemGiLibraryDirs()` in
 * at write time reintroduces the snapshot this function exists to remove (a
 * launcher is routinely written BEFORE `brew install gtk4`), and RE-DERIVING it
 * in shell would be a knowingly partial THIRD copy of a two-copy rule, in the
 * one language nothing here type-checks. The REMAINING gap — a host GI stack
 * under a prefix dyld never defaulted to, `/opt/homebrew/lib` on Apple silicon —
 * stays in `status/open-todos.md`, to be closed by teaching such a launcher to
 * defer to the CLI rather than to re-derive.
 *
 * @param scanRoot Directory whose `node_modules` is globbed at launch time.
 * @param bakedDirs Prebuild dirs found at write time; entries outside `scanRoot`
 *   are embedded (entries inside it are dropped — the scan finds them).
 * @returns the preamble, or `''` when there is nothing to export.
 */
export function buildNativeEnvPreamble(
    scanRoot: string,
    bakedDirs: readonly string[] = [],
    target: { platform?: string; arch?: string; libc?: HostLibc | null } = {},
): string {
    const platform = target.platform ?? process.platform;
    const arch = target.arch ?? process.arch;
    // The libc is a HOST fact, so it belongs in the glob just as much as the
    // arch does. Omitting it made the launcher probe only `linux-<arch>` on a
    // musl host — survivable while every prebuild sat in the depending
    // package's own tree, but ADR 0017 moved each binary into a per-target
    // package (`<name>-linux-arm64-musl`, shipping `prebuilds/linux-arm64-musl/`),
    // so the directory the launcher must find is now the one it did not name.
    // `detectNativePackages` has always been libc-aware; this is the same
    // question asked in the shell, and the two must not answer it differently.
    const libc = target.libc !== undefined ? target.libc : detectHostLibc(platform);
    const { name: libVar, separator } = libraryPathVar(platform);

    if (platform === 'win32') {
        if (bakedDirs.length === 0) return '';
        const joined = shQuote(bakedDirs.join(separator));
        return (
            `GI_TYPELIB_PATH=${joined}\${GI_TYPELIB_PATH:+"${separator}$GI_TYPELIB_PATH"}\n` +
            `${libVar}=${joined}\${${libVar}:+"${separator}$${libVar}"}\n` +
            `export GI_TYPELIB_PATH ${libVar}\n`
        );
    }

    // Only the ancestors' hits need embedding — anything under `scanRoot` is
    // what the loop below finds, and re-embedding it would reintroduce the
    // snapshot for exactly the packages the scan exists to keep current.
    const nmRoot = `${scanRoot.replace(/\/+$/, '')}/node_modules/`;
    const external = bakedDirs.filter((d) => !d.startsWith(nmRoot));

    // The same `<os>-<arch>` spellings `resolvePrebuildDirName()` probes, in the
    // same order: the canonical `${platform}-${arch}` plus the legacy uname one
    // a tarball published before the rename still ships. Passing no declared
    // platforms is correct here — the shell cannot read a package.json, and a
    // package declaring ONLY a non-canonical spelling of this host has not
    // existed since the audit made that state impossible.
    const candidates = prebuildDirCandidates(platform, arch, undefined, libc);
    const patterns: string[] = [];
    for (const candidate of candidates) {
        // Scoped (`@gjsify/x`) and unscoped packages, matching `scanNodeModules`.
        patterns.push(`${shQuote(scanRoot)}/node_modules/@*/*/prebuilds/${candidate}`);
        patterns.push(`${shQuote(scanRoot)}/node_modules/*/prebuilds/${candidate}`);
    }

    const seed = external.length > 0 ? shQuote(external.join(separator)) : `''`;
    // A directory match is not enough: `prebuilds/<os>-<arch>/` is ALSO the
    // prebuildify convention, so a plain glob sweeps in `bare-fs`, `bare-os`
    // and friends — packages with no typelib at all, which `detectNativePackages`
    // never returned because it keyed on `gjsify.prebuilds`. Onto
    // GI_TYPELIB_PATH that is merely noise; onto the LOADER path it is a
    // directory of foreign shared objects ahead of the system ones. The
    // `.typelib` probe restores the old precision from the filesystem alone —
    // and it is exactly what the artifact invariant already guarantees every
    // gjsify GI bridge ships (a library AND the typelib without which
    // GI_TYPELIB_PATH resolves nothing).
    return (
        `gjsify_np=${seed}\n` +
        `for gjsify_d in ${patterns.join(' ')}; do\n` +
        `  [ -d "$gjsify_d" ] || continue\n` +
        `  for gjsify_t in "$gjsify_d"/*.typelib; do\n` +
        `    if [ -f "$gjsify_t" ]; then gjsify_np="\${gjsify_np:+$gjsify_np${separator}}$gjsify_d"; break; fi\n` +
        `  done\n` +
        `done\n` +
        `if [ -n "$gjsify_np" ]; then\n` +
        `  GI_TYPELIB_PATH="$gjsify_np\${GI_TYPELIB_PATH:+${separator}$GI_TYPELIB_PATH}"\n` +
        `  ${libVar}="$gjsify_np\${${libVar}:+${separator}$${libVar}}"\n` +
        `  export GI_TYPELIB_PATH ${libVar}\n` +
        `fi\n` +
        `unset gjsify_np gjsify_d gjsify_t\n` +
        dyldFallbackPreamble(platform)
    );
}

/**
 * The darwin half of {@link buildNativeEnvPreamble}: put dyld's OWN default
 * fallback list back, from inside the launcher.
 *
 * MEASURED on the macOS 15.7.9 x86_64 VM against the published 0.37.0: every
 * `gjsify` command died in `dlopen(libsoup-3.0.0.dylib)` — before downloading
 * anything, the CLI's own npm fetcher going through Soup — with a dyld search
 * list that ended at `/usr/lib` and never held `/usr/local/lib`, where Homebrew
 * puts every GTK library on Intel macOS. Exporting these four directories here
 * makes the same command resolve, download and render (`OpenGL 4.1`).
 *
 * WHY HERE, and not the caller's job: SIP strips every `DYLD_*` variable when a
 * PROTECTED binary is exec'd, and `/bin/sh` — this script — is protected. A
 * value the USER exports is already gone by the time the preamble runs
 * (measured: exporting the identical value around `gjsify showcase` changes
 * nothing), while one the preamble exports ITSELF survives the following
 * `exec gjs`, Homebrew's gjs being unprotected. This is the last hop that can.
 *
 * A CONSTANT is safe here only because it is dyld's DOCUMENTED DEFAULT: it
 * cannot go stale the way baking `systemGiLibraryDirs()` in would (a launcher is
 * routinely written before `brew install gtk4`), and it re-derives nothing —
 * four literals from `dyld(1)`, shared with {@link dyldDefaultFallbackDirs}.
 * An inherited value stays AHEAD of it; the export only ADDS BACK what dyld
 * would have searched on its own.
 *
 * NOT the host's GI libdirs: `/opt/homebrew/lib` was never in dyld's default
 * either, so an ARM Mac has that gap with or without gjsify —
 * `status/open-todos.md`.
 */
export function dyldFallbackPreamble(platform: string): string {
    if (platform !== 'darwin') return '';
    // `HOME: '$HOME'` on purpose — the shim must expand it at LAUNCH, not bake
    // the writing machine's home directory into every launcher.
    const dirs = dyldDefaultFallbackDirs({ HOME: '$HOME' }).join(':');
    return (
        `DYLD_FALLBACK_LIBRARY_PATH="\${DYLD_FALLBACK_LIBRARY_PATH:+$DYLD_FALLBACK_LIBRARY_PATH:}${dirs}"\n` +
        `export DYLD_FALLBACK_LIBRARY_PATH\n`
    );
}

/** POSIX `sh` single-quoting for a launcher's target path. */
export function shQuoteArg(s: string): string {
    return shQuote(s);
}

/**
 * Expand a `bin` / `gjsify.bin` declaration into `binName → relative target`.
 *
 * The string form is npm's shorthand for `{ <package-name-without-scope>: <path> }`.
 */
export function normalizeBinMap(pkgName: string, bin: string | Record<string, string>): Map<string, string> {
    const out = new Map<string, string>();
    if (typeof bin === 'string') {
        const baseName = pkgName.startsWith('@') ? pkgName.slice(pkgName.indexOf('/') + 1) : pkgName;
        out.set(baseName, bin);
        return out;
    }
    for (const [k, v] of Object.entries(bin)) out.set(k, v);
    return out;
}

/**
 * Which bin map a package wants installed, and whether it is the GJS-runnable one.
 *
 * `gjsify.bin` WINS over npm `bin` when declared. The npm field can only ever
 * name the Node entry — npm has no way to express "and this other file is the
 * one to run when the host has `gjs` but no `node`" — so a package that ships
 * both declares the GJS bundle here. Honouring it is what makes a Node-LESS GJS
 * host work at all: on such a host the npm bin's `#!/usr/bin/env node` shebang
 * fails with `env: can't execute 'node'`, and because the launcher is also the
 * only thing that can export `GI_TYPELIB_PATH` before the GJS runtime starts,
 * that failure takes `gjsify build` down with it (the typelib lookup happens
 * before the bundle's first line — the CLI cannot repair it from the inside).
 *
 * Measured on a postmarketOS/aarch64 phone with gjs 1.88 and no node: install
 * and prebuild loading both worked, and only the `#!/usr/bin/env node` shim in
 * `node_modules/.bin/` stood between that host and a working `gjsify build`.
 *
 * `isGjsBin` lets the caller keep plain-Node packages on the plain symlink path
 * — this must not change how `lodash`'s bin is linked.
 *
 * WHY THE npm MAP COMES BACK TOO
 *
 * The reasoning above is sound and INCOMPLETE: it was written from the Node-less
 * GJS host and is blind to the mirror case. `@gjsify/cli` declares BOTH fields,
 * so a host with no `gjs` — macOS and Windows, the two active port targets —
 * got `exec gjs -m <bundle>`, which is exit 127, while a working Node entry sat
 * beside it in the same package. `cli-cross-platform.yml` recorded that on both
 * OSes for three consecutive releases (v0.27.1, v0.28.0, v0.29.0); it is
 * advisory, so it stayed red. The install even KNEW: its own post-install check
 * printed `Missing required system dependencies: ✗ GJS` and then wrote a
 * gjs-only launcher anyway.
 *
 * So `nodeFallback` carries the npm map alongside, and the LAUNCHER decides per
 * invocation. Deliberately not an install-time host probe: an install-time
 * decision is a SNAPSHOT, and this repo has already paid for that exact mistake
 * once — `buildNativeEnvPreamble` used to bake the install-time prebuild scan,
 * so a package installed later was invisible and v0.24.1 shipped a launcher with
 * no preamble at all. A host probe here fails the same way in reverse: install
 * without gjs, install gjs afterwards, shim still points at Node forever.
 */
export function pickBinMap(
    pkgName: string,
    pkgJson: { bin?: string | Record<string, string>; gjsify?: { bin?: string | Record<string, string> } },
): { map: Map<string, string>; isGjsBin: boolean; nodeFallback: Map<string, string> | null } | null {
    const gjsifyBin = pkgJson.gjsify?.bin;
    const npmBin = pkgJson.bin;
    if (gjsifyBin !== undefined) {
        return {
            map: normalizeBinMap(pkgName, gjsifyBin),
            isGjsBin: true,
            nodeFallback: npmBin === undefined ? null : normalizeBinMap(pkgName, npmBin),
        };
    }
    if (npmBin !== undefined) return { map: normalizeBinMap(pkgName, npmBin), isGjsBin: false, nodeFallback: null };
    return null;
}

/**
 * The POSIX `sh` launcher gjsify writes for a bin it owns.
 *
 * Why a launcher and not a symlink: when a GJS bundle is reached through a
 * symlink, the kernel resolves it to find the executable but hands the ORIGINAL
 * path to it, so `gjs -m <symlink>` makes `import.meta.url` point at the link's
 * directory and every asset read relative to it looks in the wrong place. An
 * explicit `exec` with the real path avoids that.
 *
 * `.gjs.mjs`/`.mjs` targets are wrapped in `gjs -m` rather than exec'd directly
 * because not every published bundle carries a `#!/usr/bin/env -S gjs -m` line,
 * and direct-exec'ing a shebang-less `.mjs` falls through to `/bin/sh`, which
 * then parses JavaScript as shell.
 *
 * `nodeFallbackAbs` makes the runtime choice per INVOCATION rather than per
 * install — see {@link pickBinMap} for why a host probe at install time is the
 * wrong shape. `gjs` stays first: that is today's behaviour on a host carrying
 * both, and which runtime wins is a separate decision from making the shim
 * runnable at all.
 */
export function buildShLauncher(
    targetAbs: string,
    opts: { envPreamble?: string; isGjsBundle: boolean; nodeFallbackAbs?: string },
): string {
    const preamble = opts.isGjsBundle ? (opts.envPreamble ?? '') : '';
    if (opts.isGjsBundle && opts.nodeFallbackAbs !== undefined) {
        // The preamble only ever configures the GI search path, so it stays
        // inside the gjs branch — exporting it around a Node exec would be
        // inert at best and misleading to anyone reading the shim.
        return (
            `#!/bin/sh\nif command -v gjs >/dev/null 2>&1; then\n${preamble}` +
            `exec gjs -m ${shQuote(targetAbs)} "$@"\nfi\n` +
            `exec node ${shQuote(opts.nodeFallbackAbs)} "$@"\n`
        );
    }
    const exec = opts.isGjsBundle ? `exec gjs -m ${shQuote(targetAbs)} "$@"` : `exec ${shQuote(targetAbs)} "$@"`;
    return `#!/bin/sh\n${preamble}${exec}\n`;
}

/** True when a bin target is a GJS-runnable bundle rather than a Node script. */
export function isGjsBundlePath(target: string): boolean {
    return target.endsWith('.gjs.mjs') || target.endsWith('.mjs');
}
