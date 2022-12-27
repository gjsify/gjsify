import { cli } from './cli.js'

export const arch = cli('uname -m').trim();
  
export const os = () => {
    const os = cli('uname -o').trim();
    if(/\bDarwin\b/i.test(os)) return 'darwin';
    if(/\bLinux\b/i.test(os)) return 'linux';
    return 'win32';
};

export const vendor = 'gjsify'

export const env = 'gnu';

export const target = `${arch}-${vendor}-${os()}-${env}`;