// Reference: Node.js lib/os.js
// Reimplemented for GJS using GLib (get_home_dir, get_host_name, etc.)

import { cli, getPathSeparator } from '@gjsify/utils';
import { mapMachine, mapSysname } from '@gjsify/utils/core';
import Gio from '@girs/gio-2.0';

/** Cached OS detection result */
let _os: NodeJS.Platform | '' = '';

/**
 * Get the OS family in Node's `process.platform` vocabulary.
 *
 * Uses `uname -s`, which is POSIX. The previous `uname -o` is a GNU extension:
 * Darwin's `uname` rejects it outright, and `cli()` throws on any stderr — so
 * this function, and everything branching on it, was simply unreachable on
 * macOS. That is why `@gjsify/os` ran as a non-gating probe on the macOS CI
 * leg rather than as part of the suite.
 *
 * The `uname` → Node-name mapping is shared with `@gjsify/process` via
 * `@gjsify/utils/core` so the two can never disagree.
 */
const getOs = (): NodeJS.Platform => {
    if (_os) return _os;
    _os = mapSysname(cli('uname -s')) ?? 'linux';
    return _os;
};

/** Cached PID */
let _pid = 0;

/** Get the current process ID via Gio.Credentials */
const getPid = () => {
    if (!_pid) _pid = new Gio.Credentials().get_unix_pid();
    return _pid;
};

export { constants };

import * as linux from './linux.js';
import * as darwin from './darwin.js';
import GLib from '@girs/glib-2.0';

import constants from './constants.js';

export const EOL = getPathSeparator() === '/' ? '\n' : '\r\n';

export const devNull = getPathSeparator() === '/' ? '/dev/null' : '\\\\.\\nul';

export const homedir = () => GLib.get_home_dir();

export const hostname = () => GLib.get_host_name();

export const release = () => cli('uname -r').trim();

export const tmpdir = () => GLib.get_tmp_dir();

export const type = () => cli('uname').trim();

// Node defines `os.platform()` and `os.arch()` as returning exactly
// `process.platform` / `process.arch`. Sharing the mapping (rather than
// lower-casing `uname -s` and hand-rolling a second, shorter arch table) keeps
// that identity true and fixes both surfaces at once: the old `toLowerCase()`
// produced `mingw64_nt-10.0` on MSYS, and the old arch table knew nothing of
// ppc64 / s390x / riscv64 / loong64 — it returned the raw `uname -m` string.
export const platform = (): NodeJS.Platform => getOs();

export const arch = (): NodeJS.Architecture => mapMachine(cli('uname -m')) ?? 'x64';

export const machine = () => cli('uname -m').trim();

export const version = () => cli('uname -v').trim();

export const uptime = () => {
    const _os = getOs();
    switch (_os) {
        case 'darwin':
            return darwin.uptime();
        case 'linux':
            return linux.uptime();
        default:
            return 0;
    }
};

export const totalmem = () => {
    const _os = getOs();
    switch (_os) {
        case 'darwin':
            return darwin.totalmem();
        case 'linux':
            return linux.totalmem();
        default:
            return 0;
    }
};

export const availableParallelism = () => {
    const c = cpus();
    return c ? c.length : 1;
};

export const userInfo = () => {
    let uid = 1000;
    let gid = 100;
    let shell = '';
    try {
        uid = parseInt(cli('id -u'), 10);
        gid = parseInt(cli('id -g'), 10);
        shell = GLib.getenv('SHELL') || '';
    } catch {
        // fallback to defaults
    }
    return {
        uid,
        gid,
        username: GLib.get_user_name(),
        homedir: GLib.get_home_dir(),
        shell,
    };
};

// Ported to packages/deno/std/node/os.ts
export const cpus = () => {
    const _os = getOs();
    switch (_os) {
        case 'darwin':
            return darwin.cpus();
        case 'linux':
            return linux.cpus();
        default:
            console.warn(`${_os} is not supported!`);
            break;
    }
};

// Existing replacement in packages/deno/std/node/os.ts
export const endianness = () => {
    const _os = getOs();
    switch (_os) {
        case 'darwin':
            return darwin.endianness();
        case 'linux':
            return linux.endianness();
        default:
            console.warn(`${_os} is not supported!`);
            break;
    }
};

// Ported to packages/deno/std/node/os.ts
export const freemem = () => {
    const _os = getOs();
    switch (_os) {
        case 'darwin':
            return darwin.freemem();
        case 'linux':
            return linux.freemem();
        default:
            console.warn(`${_os} is not supported!`);
            break;
    }
};

// Ported to packages/deno/std/node/os.ts
export const loadavg = () => {
    const _os = getOs();
    switch (_os) {
        case 'darwin':
            return darwin.loadavg();
        case 'linux':
            return linux.loadavg();
        default:
            console.warn(`${_os} is not supported!`);
            break;
    }
};

export const networkInterfaces = () => {
    const _os = getOs();
    switch (_os) {
        case 'darwin':
            return darwin.networkInterfaces();
        case 'linux':
            return linux.networkInterfaces();
        default:
            console.warn(`${_os} is not supported!`);
            break;
    }
};

/**
 * Get process scheduling priority.
 * Uses `ps -o ni=` to read the nice value for a given process.
 * pid 0 (or omitted) means the current process.
 */
export const getPriority = (pid?: number): number => {
    const targetPid = pid === undefined || pid === 0 ? getPid() : pid;
    try {
        const nice = cli(`ps -o ni= -p ${targetPid}`).trim();
        const val = parseInt(nice, 10);
        if (!isNaN(val)) return val;
    } catch {
        // fallback
    }
    return 0;
};

/**
 * Set process scheduling priority.
 * Uses `renice` command. Requires appropriate permissions for other processes.
 */
export const setPriority = (pidOrPriority: number, priority?: number): void => {
    let pid: number;
    let prio: number;
    if (priority === undefined) {
        prio = pidOrPriority;
        pid = 0;
    } else {
        pid = pidOrPriority;
        prio = priority;
    }

    if (typeof pid !== 'number' || !Number.isInteger(pid)) {
        throw new TypeError('The "pid" argument must be an integer');
    }
    if (typeof prio !== 'number' || !Number.isInteger(prio) || prio < -20 || prio > 19) {
        throw new RangeError('The "priority" argument must be an integer between -20 and 19');
    }

    try {
        const actualPid = pid === 0 ? getPid() : pid;
        cli(`renice -n ${prio} -p ${actualPid}`);
    } catch (_err) {
        const error: NodeJS.ErrnoException = new Error(`A system error occurred: priority could not be set`);
        error.code = 'ERR_SYSTEM_ERROR';
        throw error;
    }
};

export default {
    EOL,
    arch,
    availableParallelism,
    constants,
    cpus,
    devNull,
    endianness,
    freemem,
    getPriority,
    homedir,
    hostname,
    loadavg,
    machine,
    networkInterfaces,
    platform,
    release,
    setPriority,
    tmpdir,
    totalmem,
    type,
    uptime,
    userInfo,
    version,
};
