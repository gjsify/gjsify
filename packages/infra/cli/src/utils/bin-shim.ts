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

import { libraryPathVar, prebuildDirCandidates } from './detect-native-packages.js';

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
}): { cmd: string; ps1: string } {
    const { interpreter, interpreterArgs = [], target, prependEnv = {} } = opts;
    const winTarget = target.split('/').join('\\');
    const argv = interpreterArgs.length > 0 ? `${interpreterArgs.join(' ')} ` : '';
    const entries = Object.entries(prependEnv);

    let cmd = CMD_HEAD;
    for (const [key, value] of entries) cmd += `@SET "${key}=${value};%${key}%"\r\n`;
    cmd += `${interpreter} ${argv}"${winTarget}" %*\r\n`;

    let ps1 = '#!/usr/bin/env pwsh\n';
    for (const [key, value] of entries) ps1 += `$env:${key} = "${value};" + $env:${key}\n`;
    const ps1Args = interpreterArgs.map((a) => `"${a}" `).join('');
    ps1 +=
        '# Support pipeline input\n' +
        'if ($MyInvocation.ExpectingInput) {\n' +
        `  $input | & "${interpreter}" ${ps1Args}"${winTarget}" $args\n` +
        '} else {\n' +
        `  & "${interpreter}" ${ps1Args}"${winTarget}" $args\n` +
        '}\n' +
        'exit $LASTEXITCODE\n';

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
 * @param scanRoot Directory whose `node_modules` is globbed at launch time.
 * @param bakedDirs Prebuild dirs found at write time; entries outside `scanRoot`
 *   are embedded (entries inside it are dropped — the scan finds them).
 * @returns the preamble, or `''` when there is nothing to export.
 */
export function buildNativeEnvPreamble(
    scanRoot: string,
    bakedDirs: readonly string[] = [],
    target: { platform?: string; arch?: string } = {},
): string {
    const platform = target.platform ?? process.platform;
    const arch = target.arch ?? process.arch;
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
    const candidates = prebuildDirCandidates(platform, arch);
    const patterns: string[] = [];
    for (const candidate of candidates) {
        // Scoped (`@gjsify/x`) and unscoped packages, matching `scanNodeModules`.
        patterns.push(`${shQuote(scanRoot)}/node_modules/@*/*/prebuilds/${candidate}`);
        patterns.push(`${shQuote(scanRoot)}/node_modules/*/prebuilds/${candidate}`);
    }

    const seed = external.length > 0 ? shQuote(external.join(separator)) : `''`;
    return (
        `gjsify_np=${seed}\n` +
        `for gjsify_d in ${patterns.join(' ')}; do\n` +
        `  if [ -d "$gjsify_d" ]; then gjsify_np="\${gjsify_np:+$gjsify_np${separator}}$gjsify_d"; fi\n` +
        `done\n` +
        `if [ -n "$gjsify_np" ]; then\n` +
        `  GI_TYPELIB_PATH="$gjsify_np\${GI_TYPELIB_PATH:+${separator}$GI_TYPELIB_PATH}"\n` +
        `  ${libVar}="$gjsify_np\${${libVar}:+${separator}$${libVar}}"\n` +
        `  export GI_TYPELIB_PATH ${libVar}\n` +
        `fi\n` +
        `unset gjsify_np gjsify_d\n`
    );
}
