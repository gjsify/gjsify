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

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
