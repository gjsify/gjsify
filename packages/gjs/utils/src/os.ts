import { cli } from './cli.js';
import { ExtFile } from '@gjsify/gio-2.0';

export const arch = cli('uname -m').trim();

/** Cache the os detection */
let _os: string = "";
  
export const os = () => {
    if(_os) {
        return _os;
    }
    const os = cli('uname -o').trim();
    if(/\bDarwin\b/i.test(os)) {
        _os = 'darwin';
        return _os;
    }
    if(/\bLinux\b/i.test(os)) {
        _os = 'linux';
        return _os;
    }
    _os = 'win32';
    return _os;
};

export const vendor = 'gjsify'

export const env = 'gnu';

export const target = `${arch}-${vendor}-${os()}-${env}`;

/** Extract user info from passwd by username */
const extractUserInfo = (passwd: string, username: string) => {
    const lines = passwd.split('\n');
    for (const line of lines) {
      const parts = line.split(':');
      if (parts[0] === username) {
        return {
          username: parts[0],
          // password: parts[1],
          userId: parseInt(parts[2], 10),
          groupId: parseInt(parts[3], 10),
          userInfo: parts[4],
          homeDirectory: parts[5],
          shell: parts[6]
        };
      }
    }
    return null;
}

export const getUserInfo = (username: string) => {
    const file: ExtFile = ExtFile.newForPath('/etc/passwd');
    const contents = file.loadContents({ encoding: 'utf-8' });
    return extractUserInfo(contents, username);
}

export const getUserInfoAsync = async (username: string) => {
    const file: ExtFile = ExtFile.newForPath('/etc/passwd');
    const contents = await file.loadContentsAsync({ encoding: 'utf-8' });
    return extractUserInfo(contents, username);
}