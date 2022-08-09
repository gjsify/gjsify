import { cli } from '@gjsify/utils';
import * as linux from './src/linux.js';
import * as darwin from './src/darwin.js';
import GLib from 'gi://GLib';
import { getPathSeparator } from '@gjsify/utils';

import constants from './src/constants.js';

export { constants }

export const EOL = getPathSeparator() === '/' ? '\n' : '\r\n';

const UNAME_ALL = cli('uname -a');

export const arch = () => {
  switch (true) {
    case /\bx86_64\b/.test(UNAME_ALL): return 'x64';
    case /\bi686\b/.test(UNAME_ALL): return 'ia32';
    default: return 'arm';
  }
};

export const platform = () => {
  switch (true) {
    case /\bDarwin\b/i.test(UNAME_ALL): return 'darwin';
    case /\bLinux\b/i.test(UNAME_ALL): return 'linux';
    default: return 'win32';
  }
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
  const platform = platform();
  switch (platform) {
    case "darwin":
      return darwin.cpus();
    case "linux":
      return linux.cpus();
    default:
      console.warn(`${platform} is not supported!`);
      break;
  }
};

export const endianness = () => {
  const platform = platform();
  switch (platform) {
    case "darwin":
      return darwin.endianness();
    case "linux":
      return linux.endianness();
    default:
      console.warn(`${platform} is not supported!`);
      break;
  }
};

export const freemem = () => {
  const platform = platform();
  switch (platform) {
    case "darwin":
      return darwin.freemem();
    case "linux":
      return linux.freemem();
    default:
      console.warn(`${platform} is not supported!`);
      break;
  }
};

export const loadavg = () => {
  const platform = platform();
  switch (platform) {
    case "darwin":
      return darwin.loadavg();
    case "linux":
      return linux.loadavg();
    default:
      console.warn(`${platform} is not supported!`);
      break;
  }
}

export const networkInterfaces = () => {
  const platform = platform();
  switch (platform) {
    case "darwin":
      return darwin.networkInterfaces();
    case "linux":
      return linux.networkInterfaces();
    default:
      console.warn(`${platform} is not supported!`);
      break;
  }
};
