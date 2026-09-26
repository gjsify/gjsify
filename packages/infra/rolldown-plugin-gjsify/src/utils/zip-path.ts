import { sep } from 'node:path';

/**
 * Does `path` run THROUGH a `.zip` archive (Yarn PnP's `.yarn/cache/<pkg>.zip/...`)?
 *
 * The separator is the host's as well as `/`: `relative()` and rolldown's module ids answer
 * with `\` on win32, where a `.zip/`-only test never matched and a zip-resident module was
 * sent down the on-disk path. `\` counts only there, because on POSIX it is a filename
 * character. `separator` defaults to the host's; a parameter so both hosts are testable on one.
 */
export function hasZipSegment(path: string, separator: string = sep): boolean {
    return path.includes('.zip/') || (separator === '\\' && path.includes('.zip\\'));
}
