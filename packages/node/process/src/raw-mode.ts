// Raw mode is a debt this process owes the terminal.
//
// The termios flags live on the terminal device, not in the process. A process
// that turns raw mode on and then dies without turning it off hands the next
// process — the shell — a terminal with no echo, no line editing and no ctrl-c,
// and the only way out is `stty sane` typed blind. Measured: a prompt killed
// mid-way left the terminal unusable until it was reset by hand.
//
// The claim is per DESCRIPTOR, not per caller. Two objects wrapping the same
// stdin must share one debt rather than stack two, and restoring a descriptor
// is idempotent — so the newest claim's restore is the one that runs, and a
// stale restore can never undo a raw mode a later owner set on purpose.
//
// What this cannot cover is stated rather than implied: SIGKILL admits no
// handler at all, and GJS tearing down its main loop does not emit `exit`. The
// hook is installed where the process object lives (`process-class.ts`), on its
// `exit` event, which `process.exit()` emits before it dies.

/** fd → the call that puts that descriptor back. One entry per descriptor. */
const claimed = new Map<number, () => void>();

/**
 * Record that this process put `fd` into raw mode, and how to undo it.
 *
 * Called by whoever performs the transition, on EVERY path — a path that forgets
 * to claim is a terminal nobody will restore, which is the bug this exists for.
 */
export function claimRawMode(fd: number, restore: () => void): void {
    claimed.set(fd, restore);
}

/**
 * Record that the owner turned `fd` back itself, in the normal close() path.
 *
 * A paid debt: nothing is owed at exit, so the exit hook must not run a restore
 * that could fight whoever claimed the descriptor afterwards.
 */
export function releaseRawMode(fd: number): void {
    claimed.delete(fd);
}

/** Whether this process still owes `fd` a restore. */
export function isRawModeClaimed(fd: number): boolean {
    return claimed.has(fd);
}

/**
 * Pay every outstanding debt, and report how many were paid.
 *
 * The map is emptied BEFORE anything runs, so a restore that claims again — or
 * throws — cannot be undone by this same pass. One descriptor failing does not
 * strand the others: every restore is attempted, and the first failure is
 * rethrown afterwards so the caller can see it. A silently empty restore is the
 * exact failure this module exists to remove, so the error is never swallowed.
 */
export function restoreClaimedRawModes(): number {
    const owed = [...claimed.entries()];
    claimed.clear();
    let paid = 0;
    let firstFailure: unknown;
    for (const [, restore] of owed) {
        try {
            restore();
            paid += 1;
        } catch (err) {
            firstFailure ??= err;
        }
    }
    if (firstFailure !== undefined) throw firstFailure;
    return paid;
}
