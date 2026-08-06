// Portable child-process targets for this package's specs.
//
// WHY THIS FILE EXISTS
//
// `@gjsify/child_process` declares `runtimes.node: "none"`, so `test:node`
// exercises NATIVE Node — which per the testing rules makes a failure there a
// statement about the TEST, not about our implementation. On the win11-gjsify
// VM 86 of 145 specs failed, and 38 of those were a bare `spawn <name> ENOENT`:
// the specs spawn `echo`, `pwd`, `cat`, `sleep`, `sh`, `true` and `false`
// DIRECTLY, with no shell. Those are POSIX utilities. Windows ships none of
// them, so native Node is right to refuse, and the test was never valid there.
//
// The subject of those tests is `spawn`/`stdout`/`exit code`/`cwd` — never the
// utility itself. So each one is replaced by the same behaviour driven through
// `process.execPath`, which is the one executable guaranteed to exist wherever
// this suite runs. That is what Node's own test suite does for the same reason.
//
// WHY A `.spec.ts` NAME FOR A FILE THAT DEFINES NO TESTS
//
// The library build is `gjsify build --library 'src/**/*.{ts,js}' --exclude
// 'src/**/*.spec.{mts,ts}'`. The exclusion is spelled on `.spec.`, so that
// suffix is what keeps test-only scaffolding out of the shipped package. A
// neutral name would compile INTO the library, which is the opposite of what
// this is for.
//
// WHAT IS DELIBERATELY *NOT* HERE
//
// Anything whose subject really is the shell. `execSync('echo hello')` goes
// through a shell by definition — `/bin/sh` on POSIX, `cmd.exe` on Windows —
// and cmd.exe HAS `echo`, so those specs already pass on win32 and must keep
// using the shell path. Only the shell-free spawns are replaced here.

import process, { execPath } from 'node:process';

/** `[file, args]`, ready to spread into `spawn(…)` / `execFile(…)`. */
export type Command = readonly [file: string, args: string[]];

/** The one executable guaranteed to exist wherever this suite runs. */
export const NODE = execPath;

/**
 * Print the child's `argv[0]` — the portable stand-in for `sh -c 'echo "$0"'`.
 *
 * The argv0 specs used the SHELL's `$0` to read back what `options.argv0` set.
 * Node exposes the same value as `process.argv0`, with no shell in the way.
 */
export function printArgv0(): Command {
    return node('process.stdout.write(process.argv0)');
}

/** Run `source` in a fresh Node process. */
function node(source: string, extra: string[] = []): Command {
    return [execPath, ['-e', source, ...extra]];
}

/**
 * Print `text` and a newline to stdout, then exit 0 — `echo <text>`.
 *
 * The text travels as an ARGV entry rather than being interpolated into the
 * `-e` source: the specs echo values containing spaces and quotes, and building
 * a command STRING out of those is the injection-shaped mistake the repo's own
 * rules call out ("pass an argv array, never an interpolated command line").
 */
export function echo(...text: string[]): Command {
    return node('process.stdout.write(process.argv.slice(1).join(" ") + "\\n")', ['--', ...text]);
}

/** Print the same as `echo`, but to stderr. */
export function echoErr(...text: string[]): Command {
    return node('process.stderr.write(process.argv.slice(1).join(" ") + "\\n")', ['--', ...text]);
}

/** Print the process's working directory, no trailing newline — `pwd`. */
export function pwd(): Command {
    return node('process.stdout.write(process.cwd())');
}

/** Copy stdin to stdout until EOF — `cat`. */
export function cat(): Command {
    return node('process.stdin.pipe(process.stdout)');
}

/** Print one environment variable, or the empty string when it is unset. */
export function printEnv(name: string): Command {
    return node('process.stdout.write(process.env[process.argv[1]] ?? "")', ['--', name]);
}

/** Print the integers `from`..`to`, one per line — `seq`. */
export function seq(from: number, to: number): Command {
    return node(
        `for (let i = ${Math.round(from)}; i <= ${Math.round(to)}; i++) process.stdout.write(i + "\\n")`,
    );
}

/** Stay alive for `ms` milliseconds, then exit 0 — `sleep`. */
export function sleep(ms: number): Command {
    return node(`setTimeout(() => {}, ${Math.round(ms)})`);
}

/** Exit 0 immediately — `true`. */
export function exitOk(): Command {
    return node('');
}

/** Exit with `code` — `false` is `exitWith(1)`. */
export function exitWith(code: number): Command {
    return node(`process.exit(${Math.round(code)})`);
}

/** Write `text` to stderr, then exit with `code`. */
export function failWith(code: number, text: string): Command {
    return node(`process.stderr.write(process.argv[1] + "\\n"); process.exit(${Math.round(code)})`, ['--', text]);
}

/**
 * Expand a shell-style template against the environment and print the result —
 * the portable stand-in for `sh -c 'echo "VAL=$VAL"'`.
 *
 * The env-coercion specs are the reason this exists. Their SUBJECT is what
 * `spawn` does to an `env` object whose values are not strings (`undefined` is
 * dropped, `null` becomes `"null"`, a number becomes its decimal string, an
 * array is comma-joined, and prototype-chain keys still propagate because Node
 * walks with `for…in`). Reading the result back needed a child that prints an
 * environment variable, and `sh` was simply the shortest way to write one — so
 * ten assertions about ENV ended up depending on a POSIX shell.
 *
 * Supports `$NAME` and POSIX `${NAME:-default}`, which substitutes when the
 * variable is unset OR empty. That is the whole grammar those specs use.
 */
export function printEnvTemplate(template: string): Command {
    return node(
        'const t = process.argv[1];' +
            'process.stdout.write(t.replace(/\\$\\{([A-Za-z_][A-Za-z0-9_]*):-([^}]*)\\}|\\$([A-Za-z_][A-Za-z0-9_]*)/g,' +
            '(_m, named, fallback, plain) => {' +
            'const name = named ?? plain;' +
            'const value = process.env[name];' +
            'if (named !== undefined) return value === undefined || value === "" ? fallback : value;' +
            'return value ?? "";' +
            '}))',
        ['--', template],
    );
}

// ── the SHELL side ──────────────────────────────────────────────────────────
//
// `execSync` / `exec` take a command STRING and run it through a shell by
// definition, so for those the shell is part of the subject and must stay. What
// cannot stay is assuming that shell is `/bin/sh`: on Windows it is `cmd.exe`,
// which has `echo` and `cd` but no `pwd`, `cat`, `tr`, `printf` or `seq`, and
// expands `%VAR%` rather than `$VAR`.

/** Running under a `cmd.exe` shell rather than a POSIX one? */
export const SHELL_IS_CMD = process.platform === 'win32';

/**
 * libuv's `ENOENT`, which is NOT the same number on every OS.
 *
 * libuv gives Windows its own errno space: `UV_ENOENT` is -4058 there against
 * -2 on POSIX. `err.code` (`'ENOENT'`) is the portable half and is what a
 * consumer should branch on; the number is asserted here because Node exposes
 * it and a regression in it would be real.
 */
export const UV_ENOENT = SHELL_IS_CMD ? -4058 : -2;

/** The shell built-in that prints the working directory. */
export const SHELL_PWD = SHELL_IS_CMD ? 'cd' : 'pwd';

/** Shell expansion of an environment variable, in the host shell's grammar. */
export function shellVar(name: string): string {
    return SHELL_IS_CMD ? `%${name}%` : `$${name}`;
}

/**
 * A shell COMMAND LINE that runs `source` in a fresh Node process — for the
 * cases where no built-in exists on both shells (`tr`, `printf`, `seq`, `cat`).
 *
 * `source` must quote with SINGLE quotes: the double quotes below are what make
 * one command line valid under `/bin/sh` and `cmd.exe` alike, and they also
 * cover an executable path containing spaces (`C:\Program Files\nodejs\node.exe`).
 */
export function nodeShellCmd(source: string): string {
    return `"${execPath}" -e "${source}"`;
}

/**
 * Print an environment variable and a newline, then copy stdin to stdout — the
 * stand-in for `sh -c 'echo $VAR; cat'`, whose subject is that BOTH pipes are
 * live when `env` carries an `undefined` value.
 */
export function printEnvThenCat(name: string): Command {
    return node(
        'process.stdout.write((process.env[process.argv[1]] ?? "") + "\\n");' + 'process.stdin.pipe(process.stdout)',
        ['--', name],
    );
}

/** Print an environment variable, then the working directory on the next line. */
export function printEnvThenPwd(name: string): Command {
    return node('process.stdout.write((process.env[process.argv[1]] ?? "") + "\\n" + process.cwd() + "\\n")', [
        '--',
        name,
    ]);
}
