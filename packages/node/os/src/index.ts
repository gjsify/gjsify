// Reference: Node.js lib/os.js
// Reimplemented for GJS using GLib (get_home_dir, get_host_name, etc.)

import { cli, getPathSeparator } from '@gjsify/utils';
import Gio from '@girs/gio-2.0';

/** Cached OS detection result */
let _os = '';

/** Get the OS name (darwin, linux, win32) via uname */
const getOs = () => {
  if (_os) return _os;
  const os = cli('uname -o').trim();
  if (/\bDarwin\b/i.test(os)) { _os = 'darwin'; return _os; }
  if (/\bLinux\b/i.test(os)) { _os = 'linux'; return _os; }
  _os = 'win32';
  return _os;
};

/** Cached PID */
let _pid = 0;

/** Get the current process ID via Gio.Credentials */
const getPid = () => {
  if (!_pid) _pid = new Gio.Credentials().get_unix_pid();
  return _pid;
};

export { constants }

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

export const platform = () => cli('uname -s').trim().toLowerCase() as NodeJS.Platform;

export const arch = () => {
  const machine = cli('uname -m').trim();
  // Map uname -m to Node.js arch names
  if (machine === 'x86_64' || machine === 'amd64') return 'x64';
  if (machine === 'aarch64' || machine === 'arm64') return 'arm64';
  if (machine === 'i686' || machine === 'i386') return 'ia32';
  if (machine.startsWith('arm')) return 'arm';
  return machine;
};

export const machine = () => cli('uname -m').trim();

export const version = () => cli('uname -v').trim();

export const uptime = () => {
  const _os = getOs();
  switch (_os) {
    case "darwin":
      return darwin.uptime();
    case "linux":
      return linux.uptime();
    default:
      return 0;
  }
};

export const totalmem = () => {
  const _os = getOs();
  switch (_os) {
    case "darwin":
      return darwin.totalmem();
    case "linux":
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
    case "darwin":
      return darwin.cpus();
    case "linux":
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
    case "darwin":
      return darwin.endianness();
    case "linux":
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
    case "darwin":
      return darwin.freemem();
    case "linux":
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
    case "darwin":
      return darwin.loadavg();
    case "linux":
      return linux.loadavg();
    default:
      console.warn(`${_os} is not supported!`);
      break;
  }
}

export const networkInterfaces = () => {
  const _os = getOs();
  switch (_os) {
    case "darwin":
      return darwin.networkInterfaces();
    case "linux":
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
  const targetPid = (pid === undefined || pid === 0) ? getPid() : pid;
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
  } catch (err) {
    const error = new Error(`A system error occurred: priority could not be set`);
    (error as any).code = 'ERR_SYSTEM_ERROR';
    throw error;
  }
};
