// What THIS process is — its pid, its parent, the interpreter that started it
// and how much memory it holds — asked in ONE place.
//
// WHY THIS MODULE EXISTS
//
// Sibling of `host-os.ts`, and it exists for the mirror-image reason. That one
// was written because the tree spelled "which OS am I on" nine ways; this one
// is written because the tree answered "what is this process" by reading
// `/proc`, in two packages, with no fallback — and `/proc` is a LINUX
// filesystem. Measured on macOS 15.7.8 / gjs 1.88.1, against a `main` every
// check called green:
//
//   process.pid                 0      (`/proc/self/stat`   — absent)
//   process.ppid                0      (`/proc/self/status` — absent)
//   process.memoryUsage().rss   0      (`/proc/self/status` — absent)
//   process.execPath            the SCRIPT path, on every platform
//
// A pid of `0` is not a degraded reading. It is a valid pid (the kernel
// scheduler on Linux, the kernel task on Darwin), so every consumer that
// forwards it — a lock file, a log line, a `kill` — is wrong in a way nothing
// reports. That is the failure mode this module removes: each reader either
// answers or says it cannot, and none of them invents a plausible number.
//
// WHY CAPABILITY DETECTION AND NOT `hostOs()`
//
// The readers are keyed on what the host actually HAS (`/proc/self/status`
// readable? `ps(1)` on PATH?), never on the platform name. Two reasons, both
// paid for already: `@gjsify/v8`'s heap reader was written this way after a
// procfs-masked Linux container reported plausible-looking zeros, and a Linux
// host CAN legitimately lack procfs while a Darwin host never gains it. The OS
// name is a proxy for the capability; the capability is the thing.
//
// WHY FUNCTIONS AND NOT MODULE-EVAL CONSTANTS
//
// Same reason `host-os.ts` gives, plus one of its own: under GJS this module is
// evaluated while `@gjsify/process` is still installing its singleton, so a
// module-eval probe would run before the host is fully assembled. The pid is
// memoized on FIRST CALL instead — it cannot change for the life of a process,
// and paying one subprocess for it is the point of caching it.
//
// WHY A GUARDED `globalThis.imports` READ
//
// This module belongs to the `/core` half (see `core.ts`), which must be
// well-defined on every runtime including the browser. It is the GJS-GUARDED
// membership class: it probes for the GJS host and has a documented answer when
// there is none — `undefined` / `null`, never a fabricated value.

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
 * `/core` half and may not take a `@girs/gio-2.0` value import. The command
 * lines below are CONSTANTS with no interpolated user data — the one exception
 * to "pass an argv array, never a command line" that the anti-pattern rule
 * allows, and the reason each caller passes a literal.
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
 * This process's own pid, or `undefined` where nothing can answer.
 *
 * Two readers, capability-selected:
 *
 *   1. `/proc/self/stat` — its first field is the pid. One file read, no
 *      subprocess.
 *   2. `sh -c 'echo $PPID'` — the shell's PARENT is us, because
 *      `g_spawn_command_line_sync()` forks this process and execs the shell in
 *      the child. This is the same trick `@gjsify/v8`'s darwin heap reader has
 *      used since it was written, and it is portable to every POSIX host that
 *      has no procfs.
 *
 * Never `0`. `0` is a real pid, so returning it as "unknown" would hand every
 * caller a number that looks answered.
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
 * NOT `imports.system.programInvocationName`. That is the SCRIPT, and reporting
 * it as `execPath` is a defect with teeth: `spawn(process.execPath, […])` is the
 * documented portable way to start a second copy of the current runtime, and
 * against a script path it fails `ENOENT` — or worse, `g_spawn` retries a
 * non-executable text file through `/bin/sh` and the shell begins interpreting
 * a bundle.
 *
 *   1. `/proc/self/exe` — a symlink to the running binary, exact by
 *      construction.
 *   2. `g_find_program_in_path(g_get_prgname())` — the PATH lookup for the name
 *      this process was invoked under (`gjs`). Honest but not exact: a host with
 *      two gjs installations can resolve the other one. That is why it is the
 *      fallback and not the primary, and why nothing here defaults to a
 *      hardcoded `/usr/bin/gjs` — a path that does not exist on macOS at all.
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
 * DEGRADED CONTRACT off procfs: `ps(1)` reports only `rss` and `vsz`, so `data`
 * and `peak` stay `0` there. That is the same shape the Linux reader already
 * produced for a procfs it could not parse, so no consumer meets a new one —
 * but it is a real difference and `@gjsify/v8` documents it in
 * `getHeapStatistics()`'s own contract.
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
