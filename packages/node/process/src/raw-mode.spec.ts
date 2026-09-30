// Test: raw mode is a debt this process owes the terminal.
//
// termios flags live on the terminal device, not in the process. A process
// that turns raw mode on and then dies without turning it off leaves the NEXT
// process — the shell — with no echo, no line editing and no ctrl-c, and the
// only way out is `stty sane` typed blind.
//
// `setRawMode` has two paths. The stty fallback registered an exit handler; the
// native path returned immediately and registered nothing, so on every host
// with the prebuild installed — the normal case — the debt was never paid.
// These tests pin that a claim is per fd, so two objects wrapping the same
// stdin share one debt instead of stacking two, and that paying it is
// idempotent and survives a restore that throws.

import { describe, it, expect } from '@gjsify/unit';
import { claimRawMode, isRawModeClaimed, releaseRawMode, restoreClaimedRawModes } from './raw-mode.js';

/** The terminal being put right again, recorded so a test can assert it happened. */
function recorder(log: string[], name: string): () => void {
    return () => log.push(name);
}

export default async () => {
    await describe('@gjsify/process raw-mode claims', async () => {
        await it('restores every descriptor that was claimed', async () => {
            const log: string[] = [];
            claimRawMode(0, recorder(log, 'stdin'));
            claimRawMode(1, recorder(log, 'stdout'));
            expect(isRawModeClaimed(0)).toBe(true);
            expect(isRawModeClaimed(1)).toBe(true);

            restoreClaimedRawModes();

            expect(log.length).toBe(2);
            expect(log).toContain('stdin');
            expect(log).toContain('stdout');
            // The debt is spent, so a second restore must not undo the terminal a
            // second time — and must not fire a restore belonging to a later claim.
            expect(isRawModeClaimed(0)).toBe(false);
            expect(isRawModeClaimed(1)).toBe(false);
            restoreClaimedRawModes();
            expect(log.length).toBe(2);
        });

        await it('releases only the descriptor that was handed back', async () => {
            const log: string[] = [];
            claimRawMode(0, recorder(log, 'stdin'));
            claimRawMode(1, recorder(log, 'stdout'));

            // The owner turned raw mode off itself, in the normal close() path.
            // That is a paid debt: nothing is owed at exit, and re-restoring would
            // put back a terminal a LATER owner has since claimed on purpose.
            releaseRawMode(0);
            expect(isRawModeClaimed(0)).toBe(false);

            restoreClaimedRawModes();
            expect(log.length).toBe(1);
            expect(log[0]).toBe('stdout');
        });

        // The two paths through setRawMode used to differ in whether they
        // remembered. Same fd, two callers: one entry, so the last claim's
        // restore is the one that runs — restoring a descriptor is idempotent,
        // but running a stale restore could undo a deliberate raw mode set
        // after it.
        await it('keeps one claim per descriptor, newest restore wins', async () => {
            const log: string[] = [];
            claimRawMode(0, recorder(log, 'first'));
            claimRawMode(0, recorder(log, 'second'));
            expect(isRawModeClaimed(0)).toBe(true);

            restoreClaimedRawModes();
            expect(log.length).toBe(1);
            expect(log[0]).toBe('second');
        });

        // A restore that throws must not strand the descriptors after it: one
        // broken descriptor cannot be allowed to cost every other one its
        // terminal.
        await it('keeps restoring after one restore throws', async () => {
            const log: string[] = [];
            claimRawMode(0, () => {
                throw new Error('fd 0 is gone');
            });
            claimRawMode(1, recorder(log, 'stdout'));

            let thrown: unknown;
            try {
                restoreClaimedRawModes();
            } catch (err) {
                thrown = err;
            }

            expect(log.length).toBe(1);
            expect(log[0]).toBe('stdout');
            expect(isRawModeClaimed(1)).toBe(false);
            // The failure is reported, never swallowed: the caller is a process
            // exit hook, and a silently empty restore is the exact bug this
            // module exists to remove.
            expect(String(thrown)).toContain('fd 0 is gone');
        });

        await it('starts with nothing claimed', async () => {
            expect(isRawModeClaimed(7)).toBe(false);
            expect(restoreClaimedRawModes()).toBe(0);
        });
    });
};
