// Host capabilities this package's specs depend on but cannot assume.
//
// WHY THIS FILE EXISTS
//
// Nineteen `@gjsify/fs` specs create a symbolic link. On the win11-gjsify VM
// every one of them failed with `EPERM: operation not permitted, symlink` —
// and NOT because Windows lacks symlinks. It has them; creating one requires
// either an elevated process or Developer Mode, and this host has neither.
//
// That makes the failure a HOST CAPABILITY, not a platform difference, and the
// distinction matters because the two need different instruments. A
// `{ when: isWin32() }` marker would be WRONG here in both directions: a
// Windows host WITH Developer Mode passes these tests, so the marker would fail
// the run for succeeding; and a GitHub `windows-latest` runner executes as an
// administrator, so a CI leg keyed on the platform would go green while a
// normal user's machine went red — the exact "verified nowhere" shape ADR 0018
// exists to remove.
//
// So the predicate is the capability itself, measured once at module load. On a
// host that can symlink, the tests below run and MUST pass; on one that cannot,
// the failure is tolerated and retires itself the moment the host gains the
// privilege.

import {
    chmodSync,
    closeSync,
    existsSync,
    ftruncateSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    rmSync,
    symlinkSync,
    writeFileSync,
    writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

/**
 * Can this process create a symbolic link?
 *
 * Measured, never inferred: the answer depends on the OS, on whether the
 * process is elevated, and on Windows also on the Developer Mode setting —
 * none of which any single flag reports.
 */
function probeSymlinkSupport(): boolean {
    let dir: string | undefined;
    try {
        dir = mkdtempSync(join(tmpdir(), 'gjsify-symlink-probe-'));
        const target = join(dir, 'target.txt');
        writeFileSync(target, 'probe');
        symlinkSync(target, join(dir, 'link.txt'));
        return true;
    } catch {
        // EPERM on Windows without the privilege; EACCES or ENOSYS elsewhere.
        // Any failure means the same thing to a caller: do not rely on it.
        return false;
    } finally {
        if (dir) {
            try {
                rmSync(dir, { recursive: true, force: true });
            } catch {
                // A probe must not fail the run over its own cleanup.
            }
        }
    }
}

export const CAN_SYMLINK = probeSymlinkSupport();

/** The `reason` string every symlink-gated `it.failing` shares. */
export const NO_SYMLINK_REASON =
    'Creating a symbolic link needs an elevated process or Developer Mode on Windows; this host has neither ' +
    '(measured at load — see `capabilities.spec.ts`). Not a platform gap: the same test passes on a Windows host ' +
    'that has the privilege, and this marker fails the run the day it does.';

/**
 * Does this filesystem keep `S_ISGID` on a directory and hand it down to
 * children?
 *
 * Measured for the same reason as {@link CAN_SYMLINK}: it is a property of the
 * MOUNT, not of the OS. NTFS carries no POSIX mode at all, `nosuid` mounts drop
 * the bit, and a container's overlayfs may or may not honour the inheritance —
 * none of which `process.platform` reports. The setgid rules in
 * `fs-semantics.spec.ts` guard a real regression (a post-create chmod that
 * silently strips an inherited `S_ISGID` breaks group access for everyone else
 * in a shared tree), so they must run wherever the host can express them.
 */
function probeSetgidInheritance(): boolean {
    let dir: string | undefined;
    try {
        dir = mkdtempSync(join(tmpdir(), 'gjsify-setgid-probe-'));
        const parent = join(dir, 'parent');
        mkdirSync(parent, { mode: 0o775 });
        chmodSync(parent, 0o2775);
        if ((lstatSync(parent).mode & 0o2000) === 0) return false;
        const child = join(parent, 'child');
        mkdirSync(child, { mode: 0o775 });
        return (lstatSync(child).mode & 0o2000) !== 0;
    } catch {
        return false;
    } finally {
        if (dir) {
            try {
                rmSync(dir, { recursive: true, force: true });
            } catch {
                // A probe must not fail the run over its own cleanup.
            }
        }
    }
}

export const CAN_SETGID = probeSetgidInheritance();

/** The `reason` string every setgid-gated `it.failing` shares. */
export const NO_SETGID_REASON =
    'This filesystem does not keep S_ISGID on a directory or does not hand it to children (measured at load — ' +
    'see `capabilities.spec.ts`). NTFS carries no POSIX mode bits, a `nosuid` mount drops them, and some overlay ' +
    'filesystems skip the inheritance. Not keyed on the platform: the same test passes on any mount that can ' +
    'express it, and this marker fails the run the day this one can.';

/**
 * Does `/proc/self/fd/<n>` resolve an open descriptor to its inode?
 *
 * This is the route `fstat`/`fchmod`/`ftruncate` take to act on the DESCRIPTOR
 * rather than on the path it was opened from — the property that makes them
 * survive a rename or an unlink. It is Linux-only, and `respond-with-file.ts`
 * already carries the scar of assuming otherwise (a procfs path resolved to
 * nothing on macOS, `statSync` threw, and a swallowed catch meant `statCheck`
 * silently never ran). So it is measured, and the descriptor-identity rules
 * that depend on it are gated on the measurement.
 */
function probeProcFdSupport(): boolean {
    try {
        return existsSync('/proc/self/fd/0');
    } catch {
        return false;
    }
}

export const CAN_PROC_FD = probeProcFdSupport();

/**
 * Does `ftruncate` act on the DESCRIPTOR, ignoring the file's own mode?
 *
 * `ftruncate(2)` checks exactly one thing: that the fd is open for writing. It
 * never looks at the permission bits, so the handle that created a mode-0444
 * file can still shorten it. GJS has no `g_ftruncate` and no route from an fd to
 * a `GSeekable` (`GioUnix.OutputStream` does not implement it, and
 * `GBufferedOutputStream` / `GDataOutputStream` wrapped around one both report
 * `can_truncate() == false` — measured under gjs 1.88.1), so truncation has to
 * re-open the descriptor by its procfs name, and that second `open(2)` IS
 * checked against the file's mode.
 *
 * Measured rather than keyed on the runtime, for the reason {@link CAN_SYMLINK}
 * gives: it is a property of what the host can express, and the marker must
 * retire itself the day a real binding lands rather than have to be remembered.
 */
function probeFdTruncateIgnoresFileMode(): boolean {
    let dir: string | undefined;
    try {
        dir = mkdtempSync(join(tmpdir(), 'gjsify-ftruncate-probe-'));
        const fd = openSync(join(dir, 'ro'), 'w', 0o444) as unknown as number;
        try {
            writeSync(fd, Buffer.from('ABCDEFGH'));
            ftruncateSync(fd, 4);
            return true;
        } finally {
            closeSync(fd);
        }
    } catch {
        return false;
    } finally {
        if (dir) {
            try {
                rmSync(dir, { recursive: true, force: true });
            } catch {
                // A probe must not fail the run over its own cleanup.
            }
        }
    }
}

export const CAN_FD_TRUNCATE_ANY_MODE = probeFdTruncateIgnoresFileMode();

/** The `reason` string the mode-independent-ftruncate rule carries. */
export const NO_FD_TRUNCATE_REASON =
    'This runtime cannot call ftruncate(2) on a descriptor (measured at load — see `capabilities.spec.ts`). GJS ' +
    'has no `g_ftruncate` and no route from an fd to a GSeekable, so truncation re-opens the descriptor by its ' +
    'procfs name — and that second open(2) IS checked against the file mode, which 0444 denies. The ACCESS-mode ' +
    'half of the contract (a read-only handle must not be able to truncate at all) is enforced and separately ' +
    'tested; this marker covers only the file-mode half, and it retires the day a real binding exists.';

/** The `reason` string every procfs-gated `it.failing` shares. */
export const NO_PROC_FD_REASON =
    'This host has no `/proc/self/fd` (measured at load — see `capabilities.spec.ts`), which is the only route ' +
    'GJS has to act on an open descriptor rather than on the path it was opened from. Without it `fstat`/' +
    '`ftruncate` fall back to the path and lose descriptor identity after a rename or an unlink.';
