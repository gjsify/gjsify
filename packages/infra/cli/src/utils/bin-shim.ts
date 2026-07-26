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
