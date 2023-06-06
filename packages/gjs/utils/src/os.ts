import { cli } from './cli.js';
import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';

import type { UserInfo } from './types/index.js';

/** Cache the arch detection */
let _arch: string = "";

/** Cache the os detection */
let _os: string = "";

/** Cache the target detection */
let _target: string = "";

/** Cache the userInfo */
const userInfo: {[username: string]: UserInfo} = {};

export const getArch = () => {
    if(_arch) {
        return _arch;
    }
    _arch = cli('uname -m').trim();
    return _arch;
}
  
export const getOs = () => {
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

export const getVendor = () => 'gjsify';

export const getEnv = () => 'gnu';

export const getTarget = () => {
    if(_target) {
        return _target;
    }
    _target = `${getArch()}-${getVendor()}-${getOs()}-${getEnv()}`;
    return _target;
}

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

export const getUserInfo = (username?: string) => {
    const file = Gio.File.new_for_path('/etc/passwd');
    if(!username) {
        username = GLib.get_user_name();
    }

    if(userInfo[username]) {
        return userInfo[username];
    }
    const [success, contents] = file.load_contents(null);
    if(!success) {
        throw new Error(`Failed to load ${file.get_path()}`);
    }

    const contentStr = new TextDecoder().decode(contents);

    userInfo[username] = extractUserInfo(contentStr, username);
    return userInfo[username];
}
