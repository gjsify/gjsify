// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by memfs
// (streamich + contributors, Apache-2.0).
//
// In-memory only. No persistence (OPFS bridge is a future iteration).
// No file watching (FSWatcher is a stub). No real permission/owner enforcement.
//
// Standalone entry for `import x from '@gjsify/fs/promises'` consumers when
// resolved through the `"browser"` condition. Mirror of Node's `fs/promises`
// module shape — namespace re-export of the promise APIs plus a default
// export that bundles them.

export {
    readFile,
    writeFile,
    appendFile,
    stat,
    lstat,
    access,
    readdir,
    mkdir,
    rmdir,
    rm,
    unlink,
    rename,
    copyFile,
    link,
    symlink,
    readlink,
    realpath,
    chmod,
    chown,
    truncate,
    utimes,
    mkdtemp,
    open,
    FileHandle,
} from './promises.js';

import {
    readFile,
    writeFile,
    appendFile,
    stat,
    lstat,
    access,
    readdir,
    mkdir,
    rmdir,
    rm,
    unlink,
    rename,
    copyFile,
    link,
    symlink,
    readlink,
    realpath,
    chmod,
    chown,
    truncate,
    utimes,
    mkdtemp,
    open,
    FileHandle,
} from './promises.js';

export { constants } from './constants.js';

export default {
    readFile,
    writeFile,
    appendFile,
    stat,
    lstat,
    access,
    readdir,
    mkdir,
    rmdir,
    rm,
    unlink,
    rename,
    copyFile,
    link,
    symlink,
    readlink,
    realpath,
    chmod,
    chown,
    truncate,
    utimes,
    mkdtemp,
    open,
    FileHandle,
};
