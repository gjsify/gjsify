import { cli } from '@gjsify/utils';

const UNAME_ALL = cli('uname -a');

export const arch = () => {
  if(/\bx86_64\b/.test(UNAME_ALL)) return 'x86_64';
  if(/\bi686\b/.test(UNAME_ALL)) return 'i686';
  if(/\aarch64\b/.test(UNAME_ALL)) return 'aarch64';
  return 'arm';
};

export const platform = () => {
  if(/\bDarwin\b/i.test(UNAME_ALL)) return 'darwin';
  if(/\bLinux\b/i.test(UNAME_ALL)) return 'linux';
  return 'win32';
};

export const build = {
    os: platform(),
    arch: arch(),
}