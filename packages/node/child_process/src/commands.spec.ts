// Portable child-process targets for this package's specs.
//
// WHY THIS FILE EXISTS
//
// `@gjsify/child_process` declares `runtimes.node: "none"`, so `test:node`
// exercises NATIVE Node — which per the testing rules makes a failure there a
// statement about the TEST, not about our implementation. On the win11-gjsify
// VM 86 of 145 specs failed, and 38 of those were a bare `spawn <name> ENOENT`:
// the specs spawned `echo`, `pwd`, `cat`, `sleep`, `sh`, `true` and `false`
// DIRECTLY, with no shell. Those are POSIX utilities. Windows ships none of
// them, so native Node was right to refuse, and the test was never valid there.
//
// The subject of those tests is `spawn`/`stdout`/`exit code`/`cwd` — never the
// utility itself. So each one is driven through the INTERPRETER RUNNING THIS
// SUITE, the one executable guaranteed to exist wherever it runs. That is what
// Node's own test suite does for the same reason.
//
// WHY TWO DIALECTS AND NOT ONE
//
// "The interpreter running this suite" is `node` under `test:node` and `gjs`
// under `test:gjs`, and they do not speak the same language — `gjs` has no
// `-e`, no `process.stdout` and no `process.exit`. A vocabulary written in Node
// source only is therefore not portable ACROSS RUNTIMES even though it is
// portable across operating systems, and the failure is total rather than
// partial: measured on darwin-x64 / gjs 1.88.1, `spawnSync` came back
// `status: null`, `pid: 0` and empty stdout for every spec here, because the
// file being spawned was the test bundle itself.
//
// (`process.execPath` reporting the SCRIPT rather than the interpreter was the
// other half of that, and is fixed in `@gjsify/process` — see its
// `getExecPath()`. Both halves had to be wrong for the failure to look like a
// `child_process` bug.)
//
// So each command names the same tiny program twice, once per dialect, and
// {@link evalSource} is the ONE place that decides which one runs and how the
// interpreter is asked to evaluate it. Reading a pair side by side is how you
// check they agree.
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
// A second hand-written source dialect for the SHELL cases. `execSync('…')`
// goes through a shell by definition, but its child is still one of the
// programs below — so {@link shellCmd} DERIVES the command line from a
// {@link Command} rather than restating the program as a third string. That is
// what retired five copies of `setTimeout(()=>{},10000)`.

import process, { execPath } from 'node:process';

/** `[file, args]`, ready to spread into `spawn(…)` / `execFile(…)`. */
export type Command = readonly [file: string, args: string[]];

/**
 * The interpreter this suite is running on — `process.execPath`, whatever that
 * is here. Exported because the argv0 specs assert the child's default `argv[0]`
 * against it.
 */
export const INTERPRETER = execPath;

/**
 * Is that interpreter GJS?
 *
 * `process.versions.gjs` is the marker `@gjsify/unit`'s own `on('Gjs', …)`
 * uses, so the vocabulary and the harness cannot disagree about which runtime
 * they are on. Deliberately NOT `process.platform`: this is a RUNTIME question
 * and the OS axis must not be made to answer it.
 */
const ON_GJS = typeof process.versions?.gjs === 'string';

/**
 * The same tiny program in each interpreter's dialect.
 *
 * Both must be written with SINGLE quotes inside, so {@link shellCmd} can wrap
 * either in double quotes and stay valid under `/bin/sh` and `cmd.exe` alike.
 */
interface Source {
    /** Node / Bun / Deno — `process.*` is available. */
    node: string;
    /** GJS — `imports.*`, `ARGV`, and fd writes through a GioUnix stream. */
    gjs: string;
}

/**
 * GJS has no `process.stdout`. `W(fd, text)` writes EXACTLY `text` to a file
 * descriptor — `print()` would append a newline, and several specs assert the
 * absence of one.
 */
const GJS_WRITE = 'const W=(f,s)=>imports.gi.GioUnix.OutputStream.new(f,false).write(s,null);';

/** GJS's `process.env[name] ?? ''`. `g_getenv()` returns null when unset. */
const GJS_ENV = 'const E=n=>imports.gi.GLib.getenv(n)??String();';

/**
 * Run `source` in a fresh copy of THIS interpreter, with `extra` as the child's
 * arguments.
 *
 * The two argument shapes differ by exactly one token and that is deliberate:
 * `node -e src -- a b` CONSUMES the `--` (the child sees `process.argv[1] ===
 * 'a'`), while `gjs -c src a b` needs no separator and would pass a literal
 * `--` straight into `ARGV`. So each dialect reads its first extra argument as
 * `process.argv[1]` / `ARGV[0]` respectively.
 *
 * `;void 0` is not decoration. **`gjs -c` exits with its script's COMPLETION
 * VALUE**, so a source whose last expression is a number exits with that
 * number: `W(1, 'hello world\n')` returns the 12 bytes written and the child
 * exits 12. Every `status === 0` assertion in this package failed that way
 * before the terminator was added, and it is applied HERE rather than per
 * command so a new entry cannot forget it.
 */
function evalSource(source: Source, extra: string[] = []): Command {
    if (ON_GJS) return [INTERPRETER, ['-c', `${source.gjs};void 0`, ...extra]];
    return [INTERPRETER, extra.length > 0 ? ['-e', source.node, '--', ...extra] : ['-e', source.node]];
}

/**
 * Print the child's `argv[0]` — the portable stand-in for `sh -c 'echo "$0"'`.
 *
 * The argv0 specs used the SHELL's `$0` to read back what `options.argv0` set.
 * Node exposes the same value as `process.argv0`; GJS exposes it as
 * `imports.system.programInvocationName`, which under `-c` (no script to name)
 * is argv[0] itself. `GLib.get_prgname()` is NOT usable here — it is the
 * BASENAME, so it would silently pass the overridden-argv0 assertion and fail
 * the default one.
 */
export function printArgv0(): Command {
    return evalSource({
        node: 'process.stdout.write(process.argv0)',
        gjs: `${GJS_WRITE}W(1,imports.system.programInvocationName)`,
    });
}

/**
 * Print `text` and a newline to stdout, then exit 0 — `echo <text>`.
 *
 * The text travels as an ARGV entry rather than being interpolated into the
 * source: the specs echo values containing spaces and quotes, and building a
 * command STRING out of those is the injection-shaped mistake the repo's own
 * rules call out ("pass an argv array, never an interpolated command line").
 */
export function echo(...text: string[]): Command {
    return evalSource(
        {
            node: "process.stdout.write(process.argv.slice(1).join(' ') + '\\n')",
            gjs: `${GJS_WRITE}W(1,ARGV.join(' ') + '\\n')`,
        },
        text,
    );
}

/** Print the same as `echo`, but to stderr. */
export function echoErr(...text: string[]): Command {
    return evalSource(
        {
            node: "process.stderr.write(process.argv.slice(1).join(' ') + '\\n')",
            gjs: `${GJS_WRITE}W(2,ARGV.join(' ') + '\\n')`,
        },
        text,
    );
}

/** Print the process's working directory, no trailing newline — `pwd`. */
export function pwd(): Command {
    return evalSource({
        node: 'process.stdout.write(process.cwd())',
        gjs: `${GJS_WRITE}W(1,imports.gi.GLib.get_current_dir())`,
    });
}

/** Copy stdin to stdout until EOF — `cat`. */
export function cat(): Command {
    return evalSource({
        node: 'process.stdin.pipe(process.stdout)',
        gjs:
            'const I=imports.gi.GioUnix.InputStream.new(0,false),' +
            'O=imports.gi.GioUnix.OutputStream.new(1,false);' +
            'let b;while((b=I.read_bytes(65536,null)).get_size()>0)O.write_bytes(b,null)',
    });
}

/** Print one environment variable, or the empty string when it is unset. */
export function printEnv(name: string): Command {
    return evalSource(
        {
            node: "process.stdout.write(process.env[process.argv[1]] ?? '')",
            gjs: `${GJS_WRITE}${GJS_ENV}W(1,E(ARGV[0]))`,
        },
        [name],
    );
}

/** Print the integers `from`..`to`, one per line — `seq`. */
export function seq(from: number, to: number): Command {
    const lo = Math.round(from);
    const hi = Math.round(to);
    return evalSource({
        node: `for (let i = ${lo}; i <= ${hi}; i++) process.stdout.write(i + '\\n')`,
        gjs: `${GJS_WRITE}for (let i = ${lo}; i <= ${hi}; i++) W(1,i + '\\n')`,
    });
}

/**
 * Stay alive for `ms` milliseconds, then exit 0 — `sleep`.
 *
 * GJS blocks in `g_usleep()` rather than arming a main loop: the sleeping child
 * is a KILL TARGET in these specs (timeouts, `AbortSignal`, `SIGKILL`), and a
 * blocked process is killed exactly like an idle one while needing no loop to
 * be running for the signal to land.
 */
export function sleep(ms: number): Command {
    const millis = Math.round(ms);
    return evalSource({
        node: `setTimeout(() => {}, ${millis})`,
        gjs: `imports.gi.GLib.usleep(${millis} * 1000)`,
    });
}

/** Exit 0 immediately — `true`. */
export function exitOk(): Command {
    return evalSource({ node: '', gjs: '' });
}

/** Exit with `code` — `false` is `exitWith(1)`. */
export function exitWith(code: number): Command {
    const status = Math.round(code);
    return evalSource({
        node: `process.exit(${status})`,
        gjs: `imports.system.exit(${status})`,
    });
}

/** Write `text` to stderr, then exit with `code`. */
export function failWith(code: number, text: string): Command {
    const status = Math.round(code);
    return evalSource(
        {
            node: `process.stderr.write(process.argv[1] + '\\n'); process.exit(${status})`,
            gjs: `${GJS_WRITE}W(2,ARGV[0] + '\\n');imports.system.exit(${status})`,
        },
        [text],
    );
}

/** Write `count` bytes to stdout — the `maxBuffer` specs' subject. */
export function emitBytes(count: number): Command {
    const n = Math.round(count);
    return evalSource({
        node: `process.stdout.write('.'.repeat(${n}))`,
        gjs: `${GJS_WRITE}W(1,'.'.repeat(${n}))`,
    });
}

/** Read all of stdin and print it upper-cased, trimmed — the pipeline specs' sink. */
export function upperFromStdin(): Command {
    return evalSource({
        node:
            "let s='';process.stdin.on('data',c=>s+=c)" + ".on('end',()=>process.stdout.write(s.trim().toUpperCase()))",
        gjs:
            'const I=imports.gi.GioUnix.InputStream.new(0,false),' +
            'O=imports.gi.GioUnix.OutputStream.new(1,false),D=new TextDecoder();' +
            "let s='',b;while((b=I.read_bytes(65536,null)).get_size()>0)s+=D.decode(b.get_data());" +
            'O.write(s.trim().toUpperCase(),null)',
    });
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
    const expand =
        'const R=/\\$\\{([A-Za-z_][A-Za-z0-9_]*):-([^}]*)\\}|\\$([A-Za-z_][A-Za-z0-9_]*)/g,' +
        'X=(t,g)=>t.replace(R,(_m,named,fallback,plain)=>{' +
        'const v=g(named ?? plain);' +
        "if (named !== undefined) return v === undefined || v === '' ? fallback : v;" +
        "return v ?? '';});";
    return evalSource(
        {
            node: `${expand}process.stdout.write(X(process.argv[1], n => process.env[n]))`,
            gjs: `${GJS_WRITE}${GJS_ENV}${expand}W(1,X(ARGV[0], E))`,
        },
        [template],
    );
}

/**
 * Print an environment variable and a newline, then copy stdin to stdout — the
 * stand-in for `sh -c 'echo $VAR; cat'`, whose subject is that BOTH pipes are
 * live when `env` carries an `undefined` value.
 */
export function printEnvThenCat(name: string): Command {
    return evalSource(
        {
            node:
                "process.stdout.write((process.env[process.argv[1]] ?? '') + '\\n');" +
                'process.stdin.pipe(process.stdout)',
            gjs:
                `${GJS_WRITE}${GJS_ENV}W(1,E(ARGV[0]) + '\\n');` +
                'const I=imports.gi.GioUnix.InputStream.new(0,false),' +
                'O=imports.gi.GioUnix.OutputStream.new(1,false);' +
                'let b;while((b=I.read_bytes(65536,null)).get_size()>0)O.write_bytes(b,null)',
        },
        [name],
    );
}

/** Print an environment variable, then the working directory on the next line. */
export function printEnvThenPwd(name: string): Command {
    return evalSource(
        {
            node: "process.stdout.write((process.env[process.argv[1]] ?? '') + '\\n' + process.cwd() + '\\n')",
            gjs: `${GJS_WRITE}${GJS_ENV}W(1,E(ARGV[0]) + '\\n' + imports.gi.GLib.get_current_dir() + '\\n')`,
        },
        [name],
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
 * A shell COMMAND LINE that runs one of the commands above — for the cases
 * where no built-in exists on both shells (`tr`, `printf`, `seq`, `cat`).
 *
 * DERIVED from the `Command`, never a third hand-written source: that is what
 * keeps the shell path and the spawn path exercising the same program, and it
 * is why `setTimeout(() => {}, 10000)` no longer appears five times in
 * `parity.spec.ts`.
 *
 * Every token is double-quoted, which is what makes one command line valid
 * under `/bin/sh` and `cmd.exe` alike, and it also covers an executable path
 * containing spaces (`C:\Program Files\nodejs\node.exe`). The sources above are
 * written with single quotes precisely so this wrapping is lossless.
 */
export function shellCmd([file, args]: Command): string {
    return [file, ...args].map((token) => `"${token}"`).join(' ');
}
