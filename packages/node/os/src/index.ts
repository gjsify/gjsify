import { cli, getPathSeparator, getOs } from '@gjsify/utils';

export { constants }

import * as linux from './linux.js';
import * as darwin from './darwin.js';
import GLib from '@girs/glib-2.0';

import constants from './constants.js';

export const EOL = getPathSeparator() === '/' ? '\n' : '\r\n';

// Ported to packages/deno/std/node/os.ts
export const homedir = () => GLib.get_home_dir();

// Ported to deno runtime
export const hostname = () => GLib.get_host_name();

// Ported to deno runtime
export const release = () => cli('uname -r');

// Ported to packages/deno/std/node/os.ts
export const tmpdir = () => GLib.get_tmp_dir();

// Existing replacement in packages/deno/std/node/os.ts
export const type = () => cli('uname');

// Ported to packages/deno/std/node/os.ts
export const userInfo = () => ({
  uid: 1000,
  gid: 100,
  username: GLib.get_user_name(),
  homedir: GLib.get_home_dir()
});

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
