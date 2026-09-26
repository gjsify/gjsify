// `fs.constants` — its own module so `fs/promises` can re-export it (Node's
// `fsPromises.constants`) without importing the `fs` barrel, which imports it.

import { openFlagValues, type PosixOpenFlags } from './posix-flags.js';

/**
 * Accessor descriptors for the `O_*` members of `fs.constants`, each reading the
 * platform table when it is ASKED rather than when this module is evaluated.
 *
 * They are installed with `defineProperties` and NOT spread into the literal:
 * object spread copies values, so `{ ...openFlagGetters() }` would invoke every
 * getter at module-evaluation time and freeze exactly the answer this exists to
 * avoid. See the call site for why the timing matters.
 */
function openFlagDescriptors(): PropertyDescriptorMap {
    const descriptors: PropertyDescriptorMap = {};
    for (const name of Object.keys(openFlagValues())) {
        descriptors[name] = {
            enumerable: true,
            configurable: true,
            get: () => openFlagValues()[name as keyof PosixOpenFlags],
        };
    }
    return descriptors;
}

const fixedConstants = {
    // File access constants
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
    X_OK: 1,
    // File copy constants
    COPYFILE_EXCL: 1,
    COPYFILE_FICLONE: 2,
    COPYFILE_FICLONE_FORCE: 4,
    // File open constants — from the ONE platform table `parseOpenFlags()` also
    // reads. These were hardcoded Linux values, harmless while nothing but JS
    // looked at them and not harmless now that they reach `open(2)`: on darwin
    // `O_CREAT` is 0x200, which is Linux's `O_TRUNC`, so a caller passing
    // `constants.O_CREAT` would have silently truncated the file it created.
    //
    // GETTERS, not a spread. `openFlagValues()` is a function precisely so the
    // platform is read LATE (posix-flags.ts says so in as many words):
    // `process.platform` is a lazy property that `@gjsify/process` installs at
    // register time, so a value frozen during module evaluation can capture the
    // byte-1 stub's answer for the life of the process. Spreading the call here
    // re-froze it one line below the comment explaining why it must not be. The
    // divergence is silent and darwin-only — the same dormant-wrong-constant
    // shape as `mkdtempSync`'s 0o777, inert until the day the value is used.
    // File type constants
    S_IFMT: 61440,
    S_IFREG: 32768,
    S_IFDIR: 16384,
    S_IFCHR: 8192,
    S_IFBLK: 24576,
    S_IFIFO: 4096,
    S_IFLNK: 40960,
    S_IFSOCK: 49152,
    // File mode constants
    S_IRWXU: 448,
    S_IRUSR: 256,
    S_IWUSR: 128,
    S_IXUSR: 64,
    S_IRWXG: 56,
    S_IRGRP: 32,
    S_IWGRP: 16,
    S_IXGRP: 8,
    S_IRWXO: 7,
    S_IROTH: 4,
    S_IWOTH: 2,
    S_IXOTH: 1,
};

export const constants = Object.defineProperties(fixedConstants, openFlagDescriptors()) as typeof fixedConstants &
    PosixOpenFlags;
