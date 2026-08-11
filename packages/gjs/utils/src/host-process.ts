// What THIS process is — its pid, its parent, the interpreter that started it
// and how much memory it holds — asked in ONE place.
//
// Sibling of `host-os.ts`. It exists because the tree answered "what is this
// process" by reading `/proc`, in two packages, with no fallback — and `/proc` is
// a LINUX filesystem. On macOS (gjs 1.88.1) every one of those readers returned
// `0` for pid, ppid and rss while all checks stayed green. `0` is not a degraded
// reading: it is a valid pid, so every consumer that forwards it — a lock file, a
// log line, a `kill` — is wrong in a way nothing reports. Here each reader either
// answers or says it cannot; none invents a plausible number.
//
// Readers are keyed on what the host HAS (`/proc/self/status` readable? `ps(1)` on
// PATH?), never on the platform name: a Linux host can legitimately lack procfs,
// and `@gjsify/v8`'s heap reader was rewritten this way after a procfs-masked
// container reported plausible-looking zeros.
//
// Functions, not module-eval constants: under GJS this module is evaluated while
// `@gjsify/process` is still installing its singleton, so a module-eval probe runs
// before the host is assembled. The pid is memoized on FIRST CALL instead.
//
// The guarded `globalThis.imports` read is the GJS-GUARDED membership shape of the
// `/core` half (see `core.ts`): off GJS it answers `undefined` / `null`, never a
// fabricated value.

/** The GJS bootstrap object, as much of it as this module reads. */
interface GjsGlibImports {
    imports?: {
        gi?: {
            GLib?: {
                file_get_contents(path: string): [boolean, Uint8Array];
                file_test(path: string, test: number): boolean;
                file_read_link(path: string): string;
                find_program_in_path(program: string): string | null;
                get_prgname(): string | null;
                spawn_command_line_sync(commandLine: string): [boolean, Uint8Array, Uint8Array, number];
            };
        };
    };
}

/** `G_FILE_TEST_EXISTS`. Spelled numerically — this module takes no `@girs/*` value import. */
const FILE_TEST_EXISTS = 16;

type HostGlib = NonNullable<NonNullable<NonNullable<GjsGlibImports['imports']>['gi']>['GLib']>;

/**
 * The host's GLib, or `undefined` off GJS.
 *
 * Deliberately re-probed rather than cached: a cached `undefined` from an early
 * call would outlive the bootstrap that later provides it.
 */
function hostGlib(): HostGlib | undefined {
    try {
        return (globalThis as GjsGlibImports).imports?.gi?.GLib;
    } catch {
        // A `globalThis.imports` getter that throws is not a GJS host. Treated
        // as absence rather than propagated: every caller's contract is already
        // "or `undefined` when nothing answers".
        return undefined;
    }
}

/** Read a whole file as text through GLib, or `null` when it is not readable. */
function readText(GLib: HostGlib, path: string): string | null {
    try {
        const [ok, contents] = GLib.file_get_contents(path);
        if (!ok || !contents) return null;
        return new TextDecoder().decode(contents);
    } catch {
        return null;
    }
}

/**
 * Run `commandLine` and return its trimmed stdout, or `null` on any failure.
 *
 * `g_spawn_command_line_sync()` and not `Gio.Subprocess`: this module is in the
 * `/core` half and may not take a `@girs/gio-2.0` value import. The exception the
 * "argv array, never a command line" anti-pattern rule allows requires that no
 * user data reaches the string — every caller here passes a literal except
 * {@link hostPpid}, which interpolates a pid this module parsed itself.
 */
function shellOut(GLib: HostGlib, commandLine: string): string | null {
    try {
        const [ok, stdout] = GLib.spawn_command_line_sync(commandLine);
        if (!ok || !stdout) return null;
        const text = new TextDecoder().decode(stdout).trim();
        return text.length > 0 ? text : null;
    } catch {
        return null;
    }
}

/** Does this host have a readable procfs for the current process? */
export function hasProcfs(): boolean {
    const GLib = hostGlib();
    if (!GLib) return false;
    try {
        return GLib.file_test('/proc/self/status', FILE_TEST_EXISTS);
    } catch {
        return false;
    }
}

/** Memoized — a pid cannot change, and the non-procfs path costs a subprocess. */
let cachedPid: number | null = null;

/**
 * This process's own pid, or `undefined` where nothing can answer. Never `0` —
 * that is a real pid, and returning it as "unknown" hands the caller a number
 * that looks answered.
 *
 * Two readers, capability-selected:
 *
 *   1. `/proc/self/stat` — its first field is the pid. One file read, no
 *      subprocess.
 *   2. `sh -c 'echo $PPID'` — the shell's PARENT is us, because
 *      `g_spawn_command_line_sync()` forks this process and execs the shell in
 *      the child (same trick as `@gjsify/v8`'s darwin heap reader; portable to
 *      every POSIX host without procfs).
 */
export function hostPid(): number | undefined {
    if (cachedPid !== null) return cachedPid > 0 ? cachedPid : undefined;
    const GLib = hostGlib();
    if (!GLib) return undefined;

    let pid = 0;
    const stat = hasProcfs() ? readText(GLib, '/proc/self/stat') : null;
    if (stat) {
        pid = parseInt(stat, 10);
    } else {
        const echoed = shellOut(GLib, "sh -c 'echo $PPID'");
        if (echoed) pid = parseInt(echoed, 10);
    }

    cachedPid = Number.isInteger(pid) && pid > 0 ? pid : 0;
    return cachedPid > 0 ? cachedPid : undefined;
}

/**
 * This process's parent pid, or `undefined` where nothing can answer.
 *
 * `/proc/self/status`' `PPid:` line where procfs exists, otherwise `ps -o ppid=`
 * on our own pid — the POSIX-mandated spelling, so it needs no per-OS table.
 * A parent pid of `1` (reparented to init/launchd) is a real answer and is
 * returned as such; only a failed read is `undefined`.
 */
export function hostPpid(): number | undefined {
    const GLib = hostGlib();
    if (!GLib) return undefined;

    const status = hasProcfs() ? readText(GLib, '/proc/self/status') : null;
    if (status) {
        const match = /PPid:\s+(\d+)/.exec(status);
        if (match) {
            const ppid = parseInt(match[1], 10);
            return Number.isInteger(ppid) ? ppid : undefined;
        }
    }

    const pid = hostPid();
    if (pid === undefined) return undefined;
    const out = shellOut(GLib, `ps -o ppid= -p ${pid}`);
    if (!out) return undefined;
    const ppid = parseInt(out, 10);
    return Number.isInteger(ppid) ? ppid : undefined;
}

/**
 * The absolute path of the INTERPRETER running this process — what Node calls
 * `process.execPath` — or `undefined` where nothing can answer.
 *
 * NOT `imports.system.programInvocationName`: that is the SCRIPT, and reporting it
 * as `execPath` breaks `spawn(process.execPath, […])` — the portable way to start
 * a second copy of the runtime — with `ENOENT`, or worse, `g_spawn` retries the
 * non-executable text file through `/bin/sh` and the shell interprets a bundle.
 *
 *   1. `/proc/self/exe` — a symlink to the running binary, exact by
 *      construction.
 *   2. `g_find_program_in_path(g_get_prgname())` — honest but not exact, since a
 *      host with two gjs installations can resolve the other one; hence the
 *      fallback position. Nothing defaults to a hardcoded `/usr/bin/gjs`, a path
 *      that does not exist on macOS at all.
 */
export function hostExecPath(): string | undefined {
    const GLib = hostGlib();
    if (!GLib) return undefined;

    if (hasProcfs()) {
        try {
            const exe = GLib.file_read_link('/proc/self/exe');
            if (exe) return exe;
        } catch {
            // `/proc/self/exe` is unreadable under some sandboxes even where
            // procfs is mounted. Fall through to the PATH lookup.
        }
    }

    try {
        const name = GLib.get_prgname();
        if (name) {
            const found = GLib.find_program_in_path(name);
            if (found) return found;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

/** The OS's view of a process's memory, in bytes. */
export interface ProcessMemory {
    /** Address space — Linux `VmSize`, `ps -o vsz`. */
    virtual: number;
    /** Resident set — Linux `VmRSS`, `ps -o rss`. */
    resident: number;
    /** Data segment — Linux `VmData`. `0` where the reader cannot see it. */
    data: number;
    /** Peak address space — Linux `VmPeak`. `0` where the reader cannot see it. */
    peak: number;
}

/**
 * This process's memory figures, or `null` when no reader applies.
 *
 * Degraded off procfs: `ps(1)` reports only `rss` and `vsz`, so `data` and `peak`
 * stay `0` — the same shape the Linux reader already produced for a procfs it
 * could not parse.
 *
 * Both `ps` columns are in KiB on Linux and on macOS (POSIX mandates KiB for
 * `rss`; BSD `vsz` follows), so one multiply serves both.
 */
export function readProcessMemory(): ProcessMemory | null {
    const GLib = hostGlib();
    if (!GLib) return null;

    const status = hasProcfs() ? readText(GLib, '/proc/self/status') : null;
    if (status) {
        const fields = new Map<string, number>();
        for (const line of status.split('\n')) {
            const m = /^(\w+):\s+(\d+)(\s+kB)?/.exec(line);
            if (m) fields.set(m[1], parseInt(m[2], 10) * (m[3] ? 1024 : 1));
        }
        if (fields.size > 0) {
            return {
                virtual: fields.get('VmSize') ?? 0,
                resident: fields.get('VmRSS') ?? 0,
                data: fields.get('VmData') ?? 0,
                peak: fields.get('VmPeak') ?? 0,
            };
        }
    }

    // One subprocess, not two: `$PPID` inside the shell is this process, so the
    // reading needs no prior `hostPid()` call (and stays correct even if that
    // one could not answer).
    const out = shellOut(GLib, "sh -c 'ps -o rss=,vsz= -p $PPID'");
    if (!out) return null;
    const m = /^(\d+)\s+(\d+)$/.exec(out);
    if (!m) return null;
    return {
        virtual: parseInt(m[2], 10) * 1024,
        resident: parseInt(m[1], 10) * 1024,
        data: 0,
        peak: 0,
    };
}
