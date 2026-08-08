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

/**
 * The `reason` for the rules whose OUR-SIDE implementation needs procfs.
 *
 * Pair it with `IS_GJS` at the call site, never with `!CAN_PROC_FD` alone. The
 * limitation described here is `@gjsify/fs`'s: native Node reaches the
 * descriptor through `fstat(2)` and passes these rules on a host with no procfs
 * at all. A marker that omits the leg therefore fires on the darwin and win32
 * NODE legs, where the test SUCCEEDS — and `it.failing` fails a run for
 * succeeding, which is exactly how it reddened `main` after #1039.
 */
export const NO_PROC_FD_REASON =
    'This host has no `/proc/self/fd` (measured at load — see `capabilities.spec.ts`), which is the only route ' +
    'GJS has to act on an open descriptor rather than on the path it was opened from. Without it `fstat`/' +
    '`ftruncate` fall back to the path and lose descriptor identity after a rename or an unlink. Scoped to the ' +
    'GJS leg: native Node uses fstat(2) and needs no procfs.';

/**
 * The `reason` for the rules whose TEST counts descriptors through procfs.
 *
 * Distinct from {@link NO_PROC_FD_REASON} and not interchangeable with it: these
 * rules fail on BOTH legs without `/proc/self/fd`, because the instrument they
 * measure a leak with is `readdirSync('/proc/self/fd')`.
 */
export const PROC_FD_COUNTING_REASON =
    'This rule counts open descriptors by reading `/proc/self/fd`, which this host does not have (measured at ' +
    'load — see `capabilities.spec.ts`). Unlike the descriptor-identity rules this is a limitation of the TEST, ' +
    'not of `@gjsify/fs`, so it applies to both legs — the leak it guards is real everywhere, only unmeasurable ' +
    'here. It retires the day the rule learns a portable way to count.';

/**
 * Does a mode-000 directory actually hide its contents from THIS process?
 *
 * Every rule about "the kernel would not tell me anything" needs a directory it
 * cannot search, and a process with `CAP_DAC_OVERRIDE` — root in a container,
 * which is how a lot of CI runs — is not bound by the mode at all. Without the
 * measurement those tests would go green on such a host for the wrong reason:
 * the open they expect to fail SUCCEEDS, so nothing is asserted.
 *
 * Measured with the same instrument the rules use, and gated the same way as
 * {@link CAN_SYMLINK}: it retires itself the moment the host stops granting the
 * override.
 */
function probeSearchDenial(): boolean {
    let dir: string | undefined;
    try {
        dir = mkdtempSync(join(tmpdir(), 'gjsify-search-probe-'));
        const blind = join(dir, 'blind');
        mkdirSync(blind);
        writeFileSync(join(blind, 'inside'), 'probe');
        chmodSync(blind, 0o000);
        try {
            closeSync(openSync(join(blind, 'inside'), 'r') as unknown as number);
            return false;
        } catch {
            return true;
        } finally {
            chmodSync(blind, 0o700);
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

export const CAN_DENY_SEARCH = probeSearchDenial();

/** The `reason` string every search-denial-gated `it.failing` shares. */
export const NO_DENY_SEARCH_REASON =
    'A mode-000 directory does not hide its contents from this process (measured at load — see ' +
    '`capabilities.spec.ts`). A process holding CAP_DAC_OVERRIDE — root in a container, and so a great deal of ' +
    'CI — is not bound by the mode, so the open these rules expect to be REFUSED succeeds and there is nothing ' +
    'left to assert. Not keyed on the platform or the uid: the marker retires the day the override is gone.';

// ─── the gates that are KEYED and not probed, and why ────────────────────────
//
// Everything above measures. These do not, and the exception needs its reason
// stated once rather than argued five times below.
//
// A probe here would run under `test.gjs.mjs` too, where `node:fs` IS
// `@gjsify/fs` — so it would ask the implementation under test whether the
// implementation is right, and then excuse it for saying no. That is harmless
// for a FACILITY (can this host make a symlink at all) and fatal for a
// SEMANTIC: `mode` and the errno classifier are precisely the two surfaces this
// package most recently shipped broken, and a probe-shaped gate over them would
// have marked all thirty mode rules "expected failure" the day `mode` regressed
// and reported the suite green.
//
// Keying on `win32` cannot excuse gjsify anywhere, because there is no GJS host
// on Windows: `windows-suites.yml` runs the NODE leg alone, so what these gates
// scope is the reference implementation's own platform dialect, never our port.

/** True on real GJS — the same signal `@gjsify/unit` gates its host hooks on. */
export const IS_GJS =
    typeof (globalThis as { process?: { versions?: { gjs?: string } } }).process?.versions?.gjs === 'string';

const IS_WIN32 = process.platform === 'win32';

/**
 * Can this filesystem store the nine POSIX permission bits and report them back?
 *
 * NTFS cannot. Node synthesizes a mode on Windows — 0o666 for a writable file,
 * 0o444 for a read-only one, and nothing narrower — so every rule of the form
 * "the mode I asked for is the mode on disk" compares 0o600 against 0o666 and
 * fails for a reason that has nothing to do with the code under test.
 */
export const CAN_EXPRESS_POSIX_MODE = !IS_WIN32;

/** The `reason` string every mode-gated `it.failing` shares. */
export const NO_POSIX_MODE_REASON =
    'This filesystem does not store the POSIX permission bits (win32/NTFS). Node synthesizes the mode there — ' +
    '0o666 for a writable file, 0o444 for a read-only one — so "the mode I asked for is the mode on disk" is ' +
    'not expressible, and neither is a umask. Keyed on the platform rather than probed, deliberately: see the ' +
    'note above `IS_GJS`. The assertion is unchanged and still runs, and must pass, on every POSIX host.';

/**
 * Does this host spell the POSIX errno for a refusal the way Linux does?
 *
 * win32 answers ENOENT where POSIX says ENOTDIR (a child of a regular file) and
 * ENOENT or EINVAL where POSIX says ENAMETOOLONG, and reports EPERM for the
 * EACCES and EINVAL cases. These are the reference implementation's own dialect,
 * not a defect in the classifier the rules below guard.
 */
export const HAS_POSIX_ERRNO = !IS_WIN32;

/** The `reason` string every errno-dialect-gated `it.failing` shares. */
export const NO_POSIX_ERRNO_REASON =
    'win32 does not spell these refusals the POSIX way: ENOENT for what POSIX calls ENOTDIR, ENOENT or EINVAL ' +
    'for ENAMETOOLONG, EPERM for EACCES and EINVAL. That is the host dialect, not the classifier under test — ' +
    'and there is no GJS leg on Windows, so this marker can never excuse gjsify. Keyed, not probed: a probe ' +
    'would ask the error classifier whether the error classifier is correct.';

/**
 * Does an exclusive create refuse a symbolic link that dangles?
 *
 * `O_EXCL` on POSIX refuses ANY existing name, symlink included — which is what
 * stops whoever planted the link from choosing where the caller's bytes land.
 * win32 opens it instead. The rules this gates are security rules, which is
 * exactly why they are keyed rather than probed: a probe would ask the code
 * under test whether the hole is open, and take yes for an answer.
 */
export const EXCL_REFUSES_SYMLINK = !IS_WIN32;

/** The `reason` string the exclusive-create-over-symlink rules share. */
export const NO_EXCL_SYMLINK_REASON =
    'win32 does not refuse a dangling symbolic link on an exclusive create the way POSIX O_EXCL does. Keyed on ' +
    'the platform and never probed: these are security rules, and a probe would ask the implementation under ' +
    'test whether its own hole is open. There is no GJS leg on Windows, so nothing here excuses our port.';

/**
 * Does `open(2)` keep a setuid/setgid bit that was requested in the create mode,
 * and `mkdir(2)` a sticky bit?
 *
 * Linux keeps both: `open` masks the requested mode with nothing but the umask,
 * and `vfs_mkdir()` masks to `S_IRWXUGO | S_ISVTX`, so sticky survives. BSD —
 * and therefore darwin — masks the create mode to `ACCESSPERMS`, dropping every
 * special bit before the inode is written.
 *
 * Keyed on `linux` rather than probed for the reason above: the special bits ARE
 * the mode surface, and a probe would let a gjsify regression describe itself as
 * a host property.
 */
export const CREATE_KEEPS_SPECIAL_BITS = process.platform === 'linux';

/** The `reason` string the special-bit rules share. */
export const NO_SPECIAL_BITS_REASON =
    'This kernel drops the special bits from a create mode. Linux keeps a requested setuid/setgid through ' +
    'open(2) and a sticky bit through mkdir(2) (`vfs_mkdir()` masks to S_IRWXUGO|S_ISVTX); BSD, and so darwin, ' +
    'masks the create mode to ACCESSPERMS and drops them. Keyed rather than probed — see the note above ' +
    '`IS_GJS`: the mode is the surface a probe would be least able to judge.';

/**
 * Does a positional write on an `O_APPEND` descriptor still append?
 *
 * POSIX requires it — XSH `pwrite`: "If the O_APPEND flag of the file status
 * flags is set, the file offset shall be set to the end of the file prior to
 * each write". Linux obeys, and so does libuv on win32 (measured: the rule
 * passes there). darwin is the outlier — BSD's pwrite writes AT the offset — so
 * `writeSync(fd, buf, 0, n, 0)` on an append fd destroys the head of the log.
 *
 * `@gjsify/fs` implements the POSIX rule on every platform (it never passes a
 * position for an append descriptor at all — see `_writeCore`), so on a
 * non-Linux host the two legs genuinely disagree, and it is the REFERENCE that
 * diverges from the standard. The marker therefore scopes to the Node leg; the
 * GJS leg runs the rule and must pass.
 */
export const PWRITE_OBEYS_APPEND = process.platform !== 'darwin';

/** The `reason` string the positional-append rule carries. */
export const NO_PWRITE_APPEND_REASON =
    "This host's pwrite(2) ignores POSIX XSH's O_APPEND clause and writes at the offset instead of at EOF " +
    '(BSD does, and so darwin; Linux and libuv-on-win32 obey). The expectation is the POSIX one and ' +
    '`@gjsify/fs` implements it ' +
    'everywhere, so this marker is scoped to the NODE leg: on the GJS leg the rule runs and must pass.';
