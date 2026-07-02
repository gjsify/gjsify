// SPDX-License-Identifier: MIT
// Cross-process install lock for `gjsify install` (ADR 0001, step 2).
//
// WHAT is locked: mutation of ONE install prefix — its `node_modules/` tree,
// its `gjsify-lock.json`, and (through the same code path) the user-global
// prefix that `gjsify install -g` extracts into. Two processes installing
// into the SAME prefix used to interleave `rmSync` + extract on the same
// destination directories (corrupt trees, spurious ENOENT mid-extract) and
// tear the lockfile. The lock serializes them. Installs into DIFFERENT
// prefixes stay fully concurrent.
//
// WHAT is deliberately NOT locked: the shared XDG caches
// (`$XDG_CACHE_HOME/gjsify/{tarballs,metadata}`). Those are content-addressed
// and written via atomic tmp+`rename` (`install-cache-fs.ts`), so concurrent
// writers are already safe lock-free — identical-content last-rename-wins.
//
// Mechanism: `mkdir` of `<prefix>/node_modules/.gjsify-install-lock` is the
// atomic acquire. mkdir has exclusive-create semantics on every runtime we
// target: Node's `mkdirSync` throws EEXIST, and the GJS fs polyfill maps
// Gio's G_IO_ERROR_EXISTS to the same code. (A lock FILE with `flag: 'wx'`
// would NOT work — the GJS `writeFileSync` polyfill ignores open flags and
// happily overwrites.) An `owner.json` inside the dir records pid + start
// time for staleness checks and diagnostics.
//
// Staleness: a crashed install cannot release its lock, so contenders steal
// when
//   (a) the owner pid is provably dead (`/proc/<pid>` on Linux — readable
//       under both Node and GJS; a kill(0) probe covers non-/proc Nodes), or
//   (b) the lock outlives GJSIFY_INSTALL_LOCK_STALE_MS (default 35 min —
//       just above the 30-min overall install budget, so a budget-bound
//       install always times out and exits before its lock can be stolen
//       out from under it), or
//   (c) `mkdir` succeeded but `owner.json` never appeared within a short
//       grace period (the owner died between the two steps).
// The steal itself is race-free: the stale dir is claimed via an atomic
// `rename` to a unique sibling name — exactly one contender's rename
// succeeds; losers see ENOENT and simply retry the acquire loop.
//
// Re-entrant per process: `workspaceInstall` holds the root-prefix lock for
// the whole workspace flow while the inner `installPackagesNative` calls
// re-acquire the same prefix — those just bump a refcount.
//
// Escape hatch: GJSIFY_INSTALL_LOCK=0 disables locking entirely (e.g. for a
// network filesystem with broken rename/mkdir atomicity, or an outer tool
// that already serializes installs).

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface InstallLockHandle {
    /** Release the lock (refcounted; the on-disk dir is removed at count 0). */
    release(): void;
}

const LOCK_DIR_NAME = '.gjsify-install-lock';
const OWNER_FILE = 'owner.json';
/** Default staleness budget — see the header comment for why 35 min. */
const DEFAULT_STALE_MS = 35 * 60_000;
/** Window between a winner's `mkdir` and its `owner.json` write. */
const ACQUIRE_GRACE_MS = 15_000;
const WAIT_BASE_MS = 150;
const WAIT_MAX_MS = 1_000;

interface OwnerInfo {
    pid?: number;
    nonce?: string;
    startedAt?: number;
}

/** Locks held by THIS process, keyed by canonical lock-dir path. */
const held = new Map<string, { count: number; nonce: string }>();

let stealCounter = 0;

function staleMs(): number {
    const raw = process.env.GJSIFY_INSTALL_LOCK_STALE_MS;
    if (raw !== undefined) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return DEFAULT_STALE_MS;
}

function lockingDisabled(): boolean {
    const flag = process.env.GJSIFY_INSTALL_LOCK;
    if (flag === undefined) return false;
    const trimmed = flag.trim();
    return trimmed === '0' || trimmed === 'false';
}

/**
 * Is `pid` a live process on this machine?
 *
 * `/proc/<pid>` is the reliable cross-runtime probe on Linux (the primary
 * target): it works identically under Node and GJS. Elsewhere fall back to a
 * signal-0 probe — ESRCH means dead, EPERM means alive-but-foreign. The GJS
 * `process.kill` polyfill shells out and cannot report ESRCH, but GJS only
 * runs on /proc platforms in practice, so the fallback branch is Node's.
 * Unknown outcomes are treated as ALIVE (conservative — never steal a lock
 * we cannot prove abandoned; the mtime staleness budget still applies).
 */
function isPidAlive(pid: number): boolean {
    try {
        if (existsSync('/proc/self')) return existsSync(`/proc/${pid}`);
    } catch {
        /* fall through to the signal probe */
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
}

function mtimeMs(path: string): number | null {
    try {
        return statSync(path).mtimeMs;
    } catch {
        return null;
    }
}

interface LockVerdict {
    stale: boolean;
    reason?: string;
    ownerPid?: number;
}

/** Inspect an existing lock dir: held by a live owner, or stale? */
function assessLock(lockDir: string): LockVerdict {
    const ownerPath = join(lockDir, OWNER_FILE);
    let owner: OwnerInfo | null = null;
    try {
        owner = JSON.parse(readFileSync(ownerPath, 'utf-8')) as OwnerInfo;
    } catch {
        owner = null;
    }
    const now = Date.now();
    if (owner && typeof owner.pid === 'number') {
        if (!isPidAlive(owner.pid)) {
            return { stale: true, reason: `owner pid ${owner.pid} is gone`, ownerPid: owner.pid };
        }
        const started = typeof owner.startedAt === 'number' ? owner.startedAt : mtimeMs(ownerPath);
        if (started !== null && now - started > staleMs()) {
            // Alive but far beyond any plausible install duration — the
            // observed 0%-CPU hung-install shape. Steal so one wedged
            // process can't block every future install of this prefix.
            return {
                stale: true,
                reason: `owner pid ${owner.pid} exceeded the ${staleMs()}ms staleness budget`,
                ownerPid: owner.pid,
            };
        }
        return { stale: false, ownerPid: owner.pid };
    }
    // No readable owner.json: the winner may be between mkdir and the owner
    // write — give it a grace period, then treat the dir as abandoned.
    const dirMtime = mtimeMs(lockDir);
    if (dirMtime === null) return { stale: false }; // vanished — retry mkdir
    if (now - dirMtime > ACQUIRE_GRACE_MS) {
        return { stale: true, reason: 'no owner recorded within the acquire grace period' };
    }
    return { stale: false };
}

/**
 * Atomically claim + remove a stale lock dir. Returns `true` when THIS
 * process won the claim (the rename succeeded), `false` when another
 * contender got there first — the caller just retries its acquire loop.
 */
function stealStaleLock(lockDir: string): boolean {
    const claimed = `${lockDir}.stale-${process.pid}-${++stealCounter}`;
    try {
        renameSync(lockDir, claimed);
    } catch {
        return false; // lost the race (ENOENT) — someone else claimed/released it
    }
    try {
        rmSync(claimed, { recursive: true, force: true });
    } catch {
        /* a leftover claimed dir is inert — it is not the lock path */
    }
    return true;
}

function abortErr(signal: AbortSignal | undefined): Error {
    const reason = signal && 'reason' in signal ? (signal as { reason?: unknown }).reason : undefined;
    if (reason instanceof Error) return reason;
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolveP, reject) => {
        const onAbort = () => {
            clearTimeout(id);
            reject(abortErr(signal));
        };
        const id = setTimeout(() => {
            signal?.removeEventListener?.('abort', onAbort);
            resolveP();
        }, ms);
        if (signal?.aborted) {
            clearTimeout(id);
            reject(abortErr(signal));
            return;
        }
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}

function makeHandle(lockDir: string): InstallLockHandle {
    let released = false;
    return {
        release() {
            if (released) return;
            released = true;
            const entry = held.get(lockDir);
            if (!entry) return;
            entry.count--;
            if (entry.count > 0) return;
            held.delete(lockDir);
            // Only remove the on-disk dir when it is still OURS — a staleness
            // steal could have handed the path to another process meanwhile.
            try {
                const owner = JSON.parse(readFileSync(join(lockDir, OWNER_FILE), 'utf-8')) as OwnerInfo;
                if (owner.nonce !== undefined && owner.nonce !== entry.nonce) return;
            } catch {
                /* unreadable owner — we created the dir, attempt removal */
            }
            try {
                rmSync(lockDir, { recursive: true, force: true });
            } catch {
                /* best-effort: a leftover lock is reclaimed by staleness */
            }
        },
    };
}

/**
 * Acquire the cross-process install lock for `prefix`. Resolves once this
 * process may mutate `<prefix>/node_modules` + `<prefix>/gjsify-lock.json`;
 * the caller MUST `release()` in a `finally`. Waits (with backoff) while a
 * live concurrent install holds the lock; steals provably-stale locks (dead
 * owner pid / exceeded staleness budget). `signal` aborts the wait — wired
 * to the overall install budget so a waiter never outlives its own timeout.
 */
export async function acquireInstallLock(
    prefix: string,
    opts: { signal?: AbortSignal } = {},
): Promise<InstallLockHandle> {
    if (lockingDisabled()) {
        return {
            release() {
                /* locking disabled — nothing to release */
            },
        };
    }
    // Canonicalize so two spellings of the same prefix (symlink, relative
    // path) share one re-entrancy slot.
    let canonicalPrefix: string;
    try {
        canonicalPrefix = realpathSync(prefix);
    } catch {
        canonicalPrefix = resolve(prefix);
    }
    const lockDir = join(canonicalPrefix, 'node_modules', LOCK_DIR_NAME);

    const heldEntry = held.get(lockDir);
    if (heldEntry) {
        heldEntry.count++;
        return makeHandle(lockDir);
    }

    mkdirSync(dirname(lockDir), { recursive: true });
    const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let waitMs = WAIT_BASE_MS;
    let announcedWait = false;
    while (true) {
        if (opts.signal?.aborted) throw abortErr(opts.signal);
        try {
            mkdirSync(lockDir); // non-recursive → atomic exclusive create
            writeFileSync(
                join(lockDir, OWNER_FILE),
                JSON.stringify({ pid: process.pid, nonce, startedAt: Date.now() }),
            );
            held.set(lockDir, { count: 1, nonce });
            return makeHandle(lockDir);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        }
        const verdict = assessLock(lockDir);
        if (verdict.stale) {
            if (stealStaleLock(lockDir)) {
                console.warn(`gjsify install: removed stale install lock (${verdict.reason}) — ${lockDir}`);
            }
            continue; // retry mkdir immediately (we or another stealer moved it)
        }
        if (!announcedWait) {
            announcedWait = true;
            const who = verdict.ownerPid !== undefined ? ` (pid ${verdict.ownerPid})` : '';
            console.warn(`gjsify install: waiting for a concurrent install${who} to release ${lockDir} …`);
        }
        await delay(waitMs, opts.signal);
        waitMs = Math.min(Math.round(waitMs * 1.6), WAIT_MAX_MS);
    }
}
