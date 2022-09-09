import { cli } from './cli.js'

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