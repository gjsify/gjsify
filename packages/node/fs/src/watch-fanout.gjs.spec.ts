// The per-file fan-out: what it attaches, what it releases, and what it costs.
//
// `watch-tree.ts`'s header has the measurement that makes the fan-out necessary
// — on darwin a DIRECTORY monitor reports a child being created and deleted but
// never a write landing inside an existing child, while a monitor on the file
// itself reports it. This file holds everything about that fan-out that can be
// asserted without being on darwin, which is nearly all of it: only the DELIVERY
// of the missing event is a property of the backend. Attach, re-attach on
// creation, disposal on deletion, the symlink rule, the budget and the release
// of every descriptor are ours, and `WatchTreeOverrides.fanOut` is what lets a
// Linux run measure them instead of leaving them to one CI leg.
//
// The cost is the other half. The per-directory recursion was priced once — one
// inotify watch descriptor per directory, 3 / 9 / 33 / 45 on real project trees,
// against a `max_user_watches` of 131041. Per FILE is a different order of
// magnitude and, on the host that needs it, each monitor costs a kernel file
// descriptor out of a per-PROCESS `RLIMIT_NOFILE` that macOS ships low. So the
// numbers below are not decoration: they are what the budget in `watch-tree.ts`
// is set against, printed on every run so the constant can be checked against a
// machine rather than against a comment.
//
// Neither an exhausted budget nor a leaked monitor fails where it happens. Both
// fail later, in some unrelated `open()` — a config read, a log write, a socket
// accept — with a stack trace that does not contain the word `watch`. Making
// both fail LOCALLY is what the two assertions here are for.
//
// GJS-only: on the Node leg `node:fs` is Node's own implementation and
// `WatchTree` is not in the picture at all.

import { describe, expect, it, on, print } from '@gjsify/unit';
import Gio from '@girs/gio-2.0';
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    realpathSync,
    rmSync,
    statSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WatchTree } from './watch-tree.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Long enough for a CREATED/DELETED to reach the directory monitor and be acted on. */
const SETTLE_MS = 600;

/**
 * Descriptors this PROCESS holds right now.
 *
 * `/dev/fd` is the one spelling both hosts answer: on Linux it resolves to
 * `/proc/self/fd`, on darwin it is a devfs directory of the calling process's
 * open descriptors. Only the DELTA is ever read, so the descriptor the listing
 * itself uses — present in both measurements — cancels out.
 */
function openDescriptors(): number {
    try {
        return readdirSync('/dev/fd').length;
    } catch {
        // A host without /dev/fd cannot answer, and inventing a number here would
        // turn "not measured" into a passing assertion.
        return -1;
    }
}

/** The process's soft `RLIMIT_NOFILE`, or `null` where nothing answered. */
function descriptorCeiling(): string | null {
    try {
        // `ulimit` is a shell builtin, so there is no API to call instead; argv
        // array, never an interpolated command line.
        const proc = Gio.Subprocess.new(['sh', '-c', 'ulimit -n'], Gio.SubprocessFlags.STDOUT_PIPE);
        const [, stdout] = proc.communicate_utf8(null, null);
        const value = (stdout ?? '').trim();
        return value === '' ? null : value;
    } catch {
        // `g_subprocess_new()` is `throws="1"` and a sandbox may refuse to spawn.
        return null;
    }
}

/** A tree of known shape: `dirs` levels, each holding `perDir` regular files. */
function makeTree(dirs: number, perDir: number): { root: string; dirs: number; files: number } {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'gjsify-wfan-')));
    let dir = root;
    for (let level = 0; level < dirs; level++) {
        if (level > 0) {
            dir = join(dir, `level${level}`);
            mkdirSync(dir);
        }
        for (let file = 0; file < perDir; file++) writeFileSync(join(dir, `f${file}.txt`), 'x');
    }
    return { root, dirs, files: dirs * perDir };
}

/** Directories and regular files under `dir`, counted without watching anything. */
function countTree(dir: string): { dirs: number; files: number } | null {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return null;
    }
    let dirs = 1;
    let files = 0;
    for (const entry of entries) {
        const stats = statSync(join(dir, entry), { throwIfNoEntry: false });
        if (stats === undefined) continue;
        if (stats.isDirectory()) {
            const below = countTree(join(dir, entry));
            if (below === null) continue;
            dirs += below.dirs;
            files += below.files;
        } else if (stats.isFile()) {
            files++;
        }
    }
    return { dirs, files };
}

/**
 * Give the GIO backend its shared state before anything is measured.
 *
 * Both backends keep one process-wide descriptor behind every monitor — the
 * inotify instance on Linux, the kqueue on darwin — opened lazily with the FIRST
 * monitor and never released. Measured from a cold process that shows up as one
 * descriptor a watch took and did not give back, which is a leak report about the
 * platform rather than about `close()`.
 */
function warmUpBackend(): void {
    const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'gjsify-wwarm-')));
    try {
        const tree = new WatchTree(
            tmp,
            true,
            () => {},
            () => {},
            { fanOut: true },
        );
        tree.close();
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

export default async () => {
    await on('Gjs', async () => {
        await describe('fs.watch — the per-file fan-out', async () => {
            await it('gives every regular file a monitor of its own', async () => {
                const tree = makeTree(3, 4);
                const watch = new WatchTree(
                    tree.root,
                    true,
                    () => {},
                    () => {},
                    { fanOut: true },
                );
                const held = watch.monitorCount;
                watch.close();
                rmSync(tree.root, { recursive: true, force: true });
                expect(held).toBe(tree.dirs + tree.files);
            });

            await it('does not give a symlink a monitor of its own', async () => {
                // The same rule that keeps a symlinked DIRECTORY from being descended,
                // applied to the fan-out: `isFile` is REGULAR, so a link is watched as
                // an entry of its parent and nothing more. Without it a `node_modules`
                // full of links would be re-watched once per link.
                const tree = makeTree(1, 2);
                symlinkSync(join(tree.root, 'f0.txt'), join(tree.root, 'link.txt'));
                symlinkSync(tree.root, join(tree.root, 'self'));
                const watch = new WatchTree(
                    tree.root,
                    true,
                    () => {},
                    () => {},
                    { fanOut: true },
                );
                const held = watch.monitorCount;
                watch.close();
                rmSync(tree.root, { recursive: true, force: true });
                expect(held).toBe(tree.dirs + tree.files);
            });

            await it('attaches to a file created after the watch started, and lets go when it is deleted', async () => {
                // The growth path is event-driven, not a re-walk: a create DOES reach
                // the directory monitor on every backend, so the file can be attached
                // at the moment it appears.
                const tree = makeTree(2, 2);
                const watch = new WatchTree(
                    tree.root,
                    true,
                    () => {},
                    () => {},
                    { fanOut: true },
                );
                const initial = watch.monitorCount;
                try {
                    const late = join(tree.root, 'level1', 'late.txt');
                    writeFileSync(late, 'x');
                    await sleep(SETTLE_MS);
                    expect(watch.monitorCount).toBe(initial + 1);

                    unlinkSync(late);
                    await sleep(SETTLE_MS);
                    // Not hygiene: a monitor left on a path that no longer exists is
                    // also the monitor that would keep the NEXT file of that name from
                    // getting one, and on a descriptor-counted host it is the leak.
                    expect(watch.monitorCount).toBe(initial);
                } finally {
                    watch.close();
                    rmSync(tree.root, { recursive: true, force: true });
                }
            });

            await it('gives every monitor and every descriptor back on close()', async () => {
                warmUpBackend();
                const tree = makeTree(3, 8);
                const baseline = openDescriptors();
                const watch = new WatchTree(
                    tree.root,
                    true,
                    () => {},
                    () => {},
                );
                const held = watch.monitorCount;
                const whileOpen = openDescriptors();
                watch.close();
                const afterClose = openDescriptors();
                rmSync(tree.root, { recursive: true, force: true });

                // The host's OWN default, not a forced fan-out: this row is the price
                // of a watch as a consumer will actually pay it.
                print(
                    `    ↳ cost: ${tree.dirs} dirs + ${tree.files} files → ${held} monitors, ` +
                        `${whileOpen - baseline} descriptors (soft RLIMIT_NOFILE ${descriptorCeiling() ?? 'unmeasured'})`,
                );

                expect(held >= tree.dirs ? '' : `held ${held} monitors for ${tree.dirs} directories`).toBe('');
                expect(watch.monitorCount).toBe(0);
                // The half a stopped event stream cannot prove. A fan-out that leaks
                // does not fail here; it fails in somebody else's open().
                expect(
                    baseline < 0 || afterClose <= baseline
                        ? ''
                        : `close() left ${afterClose - baseline} descriptor(s) open (baseline ${baseline}, ` +
                              `while open ${whileOpen}, after close ${afterClose})`,
                ).toBe('');
            });

            await it('refuses to attach past its budget, and says so', async () => {
                const tree = makeTree(3, 4);
                const errors: Array<Error & { code?: string; path?: string }> = [];
                // Two: the tree has three directories, so the refusal happens on a host
                // that fans out and on one that does not.
                const budget = 2;
                const watch = new WatchTree(
                    tree.root,
                    true,
                    () => {},
                    (err) => {
                        errors.push(err as Error & { code?: string; path?: string });
                    },
                    { budget },
                );
                const held = watch.monitorCount;
                watch.close();
                rmSync(tree.root, { recursive: true, force: true });

                // Once, not once per refused path: past the limit every remaining entry
                // raises the same fact, and a storm of them is another way to be unread.
                expect(errors.length).toBe(1);
                const err = errors[0];
                expect(err?.code).toBe('ERR_FS_WATCH_MONITOR_BUDGET');
                // The two facts a consumer has to act on: how much it was allowed, and
                // where the recursion stopped being complete.
                expect(err?.message?.includes(String(budget)) ? '' : `budget not named: ${err?.message}`).toBe('');
                expect(
                    typeof err?.path === 'string' && err.path.startsWith(tree.root)
                        ? ''
                        : `no path under the watched root: ${String(err?.path)}`,
                ).toBe('');
                expect(held <= budget ? '' : `held ${held} monitors on a budget of ${budget}`).toBe('');
                expect(watch.monitorCount).toBe(0);
            });

            await it('says nothing when the budget is not reached', async () => {
                // The other half of the row above: an implementation that raised the
                // error unconditionally would pass that one.
                const tree = makeTree(3, 4);
                const errors: unknown[] = [];
                const watch = new WatchTree(
                    tree.root,
                    true,
                    () => {},
                    (err) => errors.push(err),
                    { fanOut: true, budget: 1024 },
                );
                const held = watch.monitorCount;
                watch.close();
                rmSync(tree.root, { recursive: true, force: true });
                expect(errors.length).toBe(0);
                expect(held).toBe(tree.dirs + tree.files);
            });

            await it('prices the trees the per-directory recursion was priced on', async () => {
                // A projection, not a watch: attaching a monitor per file on a real
                // source tree would spend most of a low `RLIMIT_NOFILE` to learn a
                // number the counts already give. The per-monitor descriptor cost is
                // measured by the close() row above; this one supplies the multiplier.
                const trees: Array<[label: string, path: string]> = [
                    ['packages/node/fs/src', 'src'],
                    ['packages/infra/cli/src', join('..', '..', 'infra', 'cli', 'src')],
                    [
                        'showcases/dom/excalibur-jelly-jumper/src',
                        join('..', '..', '..', 'showcases', 'dom', 'excalibur-jelly-jumper', 'src'),
                    ],
                ];
                for (const [label, path] of trees) {
                    const counted = countTree(path);
                    print(
                        counted === null
                            ? `    ↳ ${label}: (absent from this checkout)`
                            : `    ↳ ${label}: ${counted.dirs} dirs, ${counted.files} files → ` +
                                  `${counted.dirs} monitors per-directory, ` +
                                  `${counted.dirs + counted.files} with the fan-out`,
                    );
                }
                // What this row ASSERTS is only that the walk it measures with is not
                // silently answering zero for everything.
                const own = countTree('src');
                expect(own !== null && own.files > 0 ? '' : 'the walk found no files in this package').toBe('');
            });
        });
    });
};
