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
//
// The module under test lives in @gjsify/terminal-native — the one package
// @gjsify/process and @gjsify/tty already share, so neither pays a
// cross-package dependency for a ledger both must write to. Its spec stays HERE
// because this is where the debt is paid (`Process`'s `exit` event) and because
// this package's test legs already exist; @gjsify/terminal-native ships none.

import { describe, it, expect } from '@gjsify/unit';
import {
    claimRawMode,
    isRawModeClaimed,
    noteRawMode,
    releaseRawMode,
    restoreClaimedRawModes,
} from '@gjsify/terminal-native';

/** The terminal being put right again, recorded so a test can assert it happened. */
function recorder(log: string[], name: string): () => void {
    return () => log.push(name);
}

export default async () => {
    await describe('raw-mode claims (ledger in @gjsify/terminal-native)', async () => {
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

        // `noteRawMode` is the rule both streams call, and it is the rule that
        // was wrong twice: a transition that changed nothing claimed nothing,
        // and a transition that DID change the terminal claimed nothing on the
        // native path. The undo is the same call inverted, so the two directions
        // cannot drift apart — asserted here without a terminal, which is what
        // makes it the part that can run on every host.
        await it('notes the debt a real transition creates, and none a failed one does', async () => {
            const applied: string[] = [];
            const setRawMode = (enable: boolean) => {
                applied.push(enable ? 'raw' : 'sane');
                return true;
            };

            expect(noteRawMode(51, true, setRawMode)).toBe(true);
            expect(isRawModeClaimed(51)).toBe(true);
            expect(applied).toStrictEqual(['raw']);

            // Turning it off pays the debt in the normal close path.
            expect(noteRawMode(51, false, setRawMode)).toBe(true);
            expect(isRawModeClaimed(51)).toBe(false);
            expect(applied).toStrictEqual(['raw', 'sane']);

            // set_raw_mode returns false for a descriptor that is not a terminal
            // (a piped stdin). Nothing changed, so nothing is owed — and the
            // verdict is handed back, so a caller with a stty fallback can take
            // the same transition again by other means.
            const refused = (enable: boolean) => {
                applied.push(enable ? 'raw?' : 'sane?');
                return false;
            };
            expect(noteRawMode(52, true, refused)).toBe(false);
            expect(isRawModeClaimed(52)).toBe(false);
            expect(applied).toStrictEqual(['raw', 'sane', 'raw?']);
        });

        // The undo has to be the transition, inverted — a hand-written second
        // spelling of it is how the two paths came to differ in the first place.
        await it('undoes a noted transition with the same call that made it', async () => {
            const applied: string[] = [];
            const setRawMode = (enable: boolean) => {
                applied.push(enable ? 'raw' : 'sane');
                return true;
            };
            noteRawMode(53, true, setRawMode);
            restoreClaimedRawModes();
            expect(applied).toStrictEqual(['raw', 'sane']);
            expect(isRawModeClaimed(53)).toBe(false);
        });
    });
};
