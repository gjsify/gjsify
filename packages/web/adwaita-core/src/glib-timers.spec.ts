// The GLib timers core against the shared vectors on the global timers, plus what only the core
// can see: a host it is handed, and the one-source-one-handle bookkeeping.

import { describe, expect, it } from '@gjsify/unit';

import { GLIB_TIMER_VECTORS, driveGLibTimerVectors } from './conformance/glib-timers.js';
import type { GLibTimersSubject } from './conformance/glib-timers.js';
import { createGLibTimers, type TimerHost } from './glib-timers.js';

const subject: GLibTimersSubject = {
    name: 'adwaita-core',
    isOracle: false,
    GLib: createGLibTimers(),
    settle: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    quiet: async (body) => {
        const original = console.error;
        console.error = () => {};
        try {
            await body();
        } finally {
            console.error = original;
        }
    },
};

export default async () => {
    await driveGLibTimerVectors(subject, { describe, it, expect });

    await describe('adwaita-core: GLib timers host', async () => {
        await it('schedules through the host it is handed and clears what it removes', () => {
            const scheduled = new Map<number, { run: () => void; milliseconds: number }>();
            let next = 1;
            const host: TimerHost = {
                setTimeout(run, milliseconds) {
                    const handle = next++;
                    scheduled.set(handle, {
                        run: () => {
                            scheduled.delete(handle);
                            run();
                        },
                        milliseconds,
                    });
                    return handle;
                },
                clearTimeout: (handle) => void scheduled.delete(handle as number),
            };
            const GLib = createGLibTimers(host);
            let runs = 0;
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                runs += 1;
                return GLib.SOURCE_CONTINUE;
            });
            expect([...scheduled.values()].map((entry) => entry.milliseconds).join()).toBe('250');
            [...scheduled.values()][0]!.run();
            expect(runs).toBe(1);
            expect(scheduled.size).toBe(1);
            expect(GLib.source_remove(id)).toBe(true);
            expect(scheduled.size).toBe(0);
        });
        await it('a throwing callback logs, drops its source and does not wedge the idle pump', () => {
            const pending: Array<() => void> = [];
            const GLib = createGLibTimers({
                setTimeout: (run) => pending.push(run),
                clearTimeout() {},
            });
            const seen: string[] = [];
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                throw new Error('boom');
            });
            GLib.idle_add(GLib.PRIORITY_LOW, () => void seen.push('low'));
            const original = console.error;
            console.error = () => {};
            try {
                pending.shift()!();
            } finally {
                console.error = original;
            }
            pending.shift()!();
            expect(seen.join()).toBe('low');
            expect(pending.length).toBe(0);
        });
        await it('has a vector row for every vector', () => {
            expect(GLIB_TIMER_VECTORS.length > 0).toBe(true);
        });
    });
};
