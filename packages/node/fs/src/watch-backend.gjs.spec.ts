// What GIO's file-monitor backend actually DELIVERS, measured rather than assumed.
//
// `watch-recursive.spec.ts` measures what `@gjsify/fs` reports. This measures the
// layer beneath it, through a raw `Gio.FileMonitor` with none of our mapping in the
// way, because a failure up there cannot tell "the backend delivered nothing" from
// "the backend delivered something we discarded" — different bugs, different fixes.
// On the darwin GJS leg they were indistinguishable: four rows failed with
// `Expected: true, Actual: false` while every create and delete row beside them
// passed, which is consistent with both readings and proves neither.
//
// GLib chooses the backend per platform: inotify on Linux, GKqueueFileMonitor on
// darwin, GWin32FileMonitor on Windows. GIO promises nothing uniform across them,
// and CHANGES_DONE_HINT is documented as exactly that — "a hint that this was
// probably the last change in a set of changes" — so treating it as the only route
// to "this file changed" is a promise GIO never made.
//
// The `.gjs.spec.ts` suffix is load-bearing, not cosmetic: `audit-runtimes.mjs`
// skips it precisely because specs are allowed to exercise GJS-only paths, and the
// GI modules load at runtime rather than through a static `@girs/*` import so the
// `--app node` bundle stays clean.

import { describe, expect, it, on } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

interface GioFile {
    get_path(): string | null;
}
interface GioMonitor {
    connect(signal: string, cb: (m: unknown, f: GioFile, other: GioFile | null, ev: number) => void): number;
    cancel(): boolean;
}
interface GioModule {
    File: { new_for_path(path: string): { monitor(flags: number, cancellable: null): GioMonitor } };
    FileMonitorFlags: { NONE: number };
    FileMonitorEvent: Record<string, number>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** How long to let the backend deliver. Generous: kqueue and inotify differ in latency. */
const SETTLE_MS = 1200;

export default async () => {
    await on('Gjs', async () => {
        await describe('Gio.FileMonitor — what this host delivers', async () => {
            const Gio = (await import('gi://Gio?version=2.0' as string)).default as GioModule;

            /** `CHANGED` for 2, and so on — the enum read backwards, so a dump is legible. */
            const eventNames = new Map<number, string>();
            for (const [name, value] of Object.entries(Gio.FileMonitorEvent)) {
                if (typeof value === 'number' && !eventNames.has(value)) eventNames.set(value, name);
            }

            /**
             * Monitor `dir`, run `act`, and return one `(event, path, monitored)` triple
             * per signal. The triples are the whole point: a failure has to say what the
             * backend sent, or the next reader is back to guessing from a boolean.
             */
            async function record(dir: string, act: () => void): Promise<string[]> {
                const seen: string[] = [];
                const monitor = Gio.File.new_for_path(dir).monitor(Gio.FileMonitorFlags.NONE, null);
                monitor.connect('changed', (_m, file, _other, ev) => {
                    const name = eventNames.get(ev) ?? `UNKNOWN(${ev})`;
                    seen.push(`${name} path=${file?.get_path() ?? 'null'} monitored=${dir}`);
                });
                await sleep(60);
                act();
                await sleep(SETTLE_MS);
                monitor.cancel();
                return seen;
            }

            const dump = (seen: string[]): string => (seen.length === 0 ? '(no events at all)' : seen.join(' | '));

            const CHANGE_EVENTS = ['CHANGED', 'CHANGES_DONE_HINT'];
            const isChange = (triple: string): boolean => CHANGE_EVENTS.some((n) => triple.startsWith(`${n} `));

            await it('reports a child being CREATED in a monitored directory', async () => {
                const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'gjsify-gio-mon-')));
                try {
                    const seen = await record(tmp, () => {
                        writeFileSync(join(tmp, 'fresh.txt'), 'x');
                    });
                    // The in-suite control: if this host raises nothing even for a create,
                    // the two rows below are measuring a dead monitor, not a backend.
                    expect(seen.length > 0 ? '' : 'the monitor raised nothing for a create').toBe('');
                } finally {
                    rmSync(tmp, { recursive: true, force: true });
                }
            });

            await it('reports a child being MODIFIED in a monitored directory', async () => {
                const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'gjsify-gio-mon-')));
                const child = join(tmp, 'existing.txt');
                writeFileSync(child, 'one');
                try {
                    const seen = await record(tmp, () => {
                        writeFileSync(child, 'two');
                    });
                    // This is the event `fs.watch`'s 'change' is built from, and the one
                    // the darwin failures all have in common.
                    const changes = seen.filter(isChange);
                    expect(changes.length > 0 ? '' : `no ${CHANGE_EVENTS.join('/')}; raw: ${dump(seen)}`).toBe('');
                    // And it has to NAME the child. A backend that reports the monitored
                    // directory instead leaves `relative(root, path)` empty, which is the
                    // shape that would break the recursive filenames without breaking the
                    // event count.
                    expect(
                        changes.some((t) => t.includes(`path=${child} `)) ? '' : `named no child; raw: ${dump(seen)}`,
                    ).toBe('');
                } finally {
                    rmSync(tmp, { recursive: true, force: true });
                }
            });

            await it('reports a child MODIFIED in a monitored SUBdirectory', async () => {
                // The per-directory monitor recursion is built from: if this row is the
                // one that fails, the recursion is sound and its leaves are not.
                const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'gjsify-gio-mon-')));
                const sub = join(tmp, 'sub');
                mkdirSync(sub, { recursive: true });
                const child = join(sub, 'nested.txt');
                writeFileSync(child, 'one');
                try {
                    const seen = await record(sub, () => {
                        writeFileSync(child, 'two');
                    });
                    const changes = seen.filter(isChange);
                    expect(changes.length > 0 ? '' : `no ${CHANGE_EVENTS.join('/')}; raw: ${dump(seen)}`).toBe('');
                    expect(
                        changes.some((t) => t.includes(`path=${child} `)) ? '' : `named no child; raw: ${dump(seen)}`,
                    ).toBe('');
                } finally {
                    rmSync(tmp, { recursive: true, force: true });
                }
            });
        });
    });
};
