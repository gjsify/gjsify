import { cli } from '@gjsify/utils';
import * as linux from './linux.js';
import * as darwin from './darwin.js';
import GLib from '@gjsify/types/GLib-2.0';
import { getPathSeparator } from '@gjsify/utils';

import constants from './constants.js';

export { constants }

export const EOL = getPathSeparator() === '/' ? '\n' : '\r\n';

const UNAME_ALL = cli('uname -a');

export const arch = () => {
  if(/\bx86_64\b/.test(UNAME_ALL)) return 'x64';
  if(/\bi686\b/.test(UNAME_ALL)) return 'ia32';
  return 'arm';
};

export const platform = () => {
  if(/\bDarwin\b/i.test(UNAME_ALL)) return 'darwin';
  if(/\bLinux\b/i.test(UNAME_ALL)) return 'linux';
  return 'win32';
};

export const homedir = () => GLib.get_home_dir();

export const hostname = () => GLib.get_host_name();

export const release = () => cli('uname -r');

export const tmpdir = () => GLib.get_tmp_dir();

export const type = () => cli('uname');

export const userInfo = () => ({
  uid: 1000,
  gid: 100,
  username: GLib.get_user_name(),
  homedir: GLib.get_home_dir()
});

export const cpus = () => {
  const os = platform();
  switch (os) {
    case "darwin":
      return darwin.cpus();
    case "linux":
      return linux.cpus();
    default:
      console.warn(`${os} is not supported!`);
      break;
  }
};

export const endianness = () => {
  const os = platform();
  switch (os) {
    case "darwin":
      return darwin.endianness();
    case "linux":
      return linux.endianness();
    default:
      console.warn(`${os} is not supported!`);
      break;
  }
};

export const freemem = () => {
  const os = platform();
  switch (os) {
    case "darwin":
      return darwin.freemem();
    case "linux":
      return linux.freemem();
    default:
      console.warn(`${os} is not supported!`);
      break;
  }
};

export const loadavg = () => {
  const os = platform();
  switch (os) {
    case "darwin":
      return darwin.loadavg();
    case "linux":
      return linux.loadavg();
    default:
      console.warn(`${os} is not supported!`);
      break;
  }
}

export const networkInterfaces = () => {
  const os = platform();
  switch (os) {
    case "darwin":
      return darwin.networkInterfaces();
    case "linux":
      return linux.networkInterfaces();
    default:
      console.warn(`${os} is not supported!`);
      break;
  }
};
