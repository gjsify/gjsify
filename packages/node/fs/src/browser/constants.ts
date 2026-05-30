// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by memfs
// (streamich + contributors, Apache-2.0).
//
// In-memory only. No persistence (OPFS bridge is a future iteration).
// No file watching (FSWatcher is a stub). No real permission/owner enforcement.
//
// Mirror of `fs.constants` from Node 24. Values are POSIX-conventional; the
// in-memory volume only honours the O_/COPYFILE_/F_OK ones (mode-bit and
// file-type constants are exposed for shape parity).

export const F_OK = 0;
export const R_OK = 4;
export const W_OK = 2;
export const X_OK = 1;
export const COPYFILE_EXCL = 1;
export const COPYFILE_FICLONE = 2;
export const COPYFILE_FICLONE_FORCE = 4;
export const O_RDONLY = 0;
export const O_WRONLY = 1;
export const O_RDWR = 2;
export const O_CREAT = 64;
export const O_EXCL = 128;
export const O_TRUNC = 512;
export const O_APPEND = 1024;
export const O_SYNC = 1052672;
export const O_NONBLOCK = 2048;
export const O_DIRECTORY = 65536;
export const O_NOFOLLOW = 131072;
export const S_IFMT = 61440;
export const S_IFREG = 32768;
export const S_IFDIR = 16384;
export const S_IFCHR = 8192;
export const S_IFBLK = 24576;
export const S_IFIFO = 4096;
export const S_IFLNK = 40960;
export const S_IFSOCK = 49152;
export const S_IRWXU = 448;
export const S_IRUSR = 256;
export const S_IWUSR = 128;
export const S_IXUSR = 64;
export const S_IRWXG = 56;
export const S_IRGRP = 32;
export const S_IWGRP = 16;
export const S_IXGRP = 8;
export const S_IRWXO = 7;
export const S_IROTH = 4;
export const S_IWOTH = 2;
export const S_IXOTH = 1;

export const constants = {
    F_OK, R_OK, W_OK, X_OK,
    COPYFILE_EXCL, COPYFILE_FICLONE, COPYFILE_FICLONE_FORCE,
    O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_EXCL, O_TRUNC, O_APPEND, O_SYNC,
    O_NONBLOCK, O_DIRECTORY, O_NOFOLLOW,
    S_IFMT, S_IFREG, S_IFDIR, S_IFCHR, S_IFBLK, S_IFIFO, S_IFLNK, S_IFSOCK,
    S_IRWXU, S_IRUSR, S_IWUSR, S_IXUSR,
    S_IRWXG, S_IRGRP, S_IWGRP, S_IXGRP,
    S_IRWXO, S_IROTH, S_IWOTH, S_IXOTH,
};
