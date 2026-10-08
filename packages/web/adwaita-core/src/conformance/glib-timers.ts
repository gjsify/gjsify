// `GLib.idle_add` / `timeout_add` / `source_remove` as observable behaviour.
//
// A vector is a program written against the `GLib` namespace and the data it must leave behind. The
// SAME vectors run on real `gi://GLib` (the ORACLE: a vector that fails there is wrong, never a port
// bug), on the core with the global timers, and on each port's `GLib` door.
//
// Priority ordering is held among idle sources only; a host event loop has no priority to give a
// timeout (see `glib-timers.ts`).

import type { ConstructHarness } from './constructs.js';

/** The part of `GLib` the vectors read. */
export interface GLibTimersLike {
    readonly PRIORITY_HIGH: number;
    readonly PRIORITY_DEFAULT: number;
    readonly PRIORITY_HIGH_IDLE: number;
    readonly PRIORITY_DEFAULT_IDLE: number;
    readonly PRIORITY_LOW: number;
    readonly SOURCE_REMOVE: boolean;
    readonly SOURCE_CONTINUE: boolean;
    idle_add(priority: number, run: () => boolean | void): number;
    timeout_add(priority: number, milliseconds: number, run: () => boolean | void): number;
    source_remove(sourceId: number): boolean;
}

/** What a driver hands the vectors. */
export interface GLibTimersSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly GLib: GLibTimersLike;
    /** Resolves after `milliseconds` of the subject's own loop; the loop must keep running meanwhile. */
    settle(milliseconds: number): Promise<void>;
    /** Runs `body` with the subject's error log silenced (a throwing callback logs by design). */
    quiet(body: () => Promise<void>): Promise<void>;
}

export const GLIB_TIMER_ROWS = ['constants', 'timeout', 'idle', 'remove', 'throw', 'arguments'] as const;

export type GLibTimerRow = (typeof GLIB_TIMER_ROWS)[number];

export interface GLibTimerVector {
    readonly row: GLibTimerRow;
    readonly rule: string;
    readonly observe: (subject: GLibTimersSubject) => unknown;
    readonly shows: unknown;
}

const SETTLE = 80;

function attempt(fn: () => void): boolean {
    try {
        fn();
        return false;
    } catch {
        return true;
    }
}

export const GLIB_TIMER_VECTORS: readonly GLibTimerVector[] = [
    {
        row: 'constants',
        rule: 'the priorities and the source return values are GLib values (glib/gmain.h)',
        observe: ({ GLib }) => [
            GLib.PRIORITY_HIGH,
            GLib.PRIORITY_DEFAULT,
            GLib.PRIORITY_HIGH_IDLE,
            GLib.PRIORITY_DEFAULT_IDLE,
            GLib.PRIORITY_LOW,
            GLib.SOURCE_REMOVE,
            GLib.SOURCE_CONTINUE,
        ],
        shows: [-100, 0, 100, 200, 300, false, true],
    },
    {
        row: 'timeout',
        rule: 'a callback returning SOURCE_REMOVE runs once',
        async observe({ GLib, settle }) {
            let runs = 0;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
                runs += 1;
                return GLib.SOURCE_REMOVE;
            });
            await settle(SETTLE);
            return runs;
        },
        shows: 1,
    },
    {
        row: 'timeout',
        rule: 'a callback returning SOURCE_CONTINUE repeats until it returns SOURCE_REMOVE',
        async observe({ GLib, settle }) {
            let runs = 0;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
                runs += 1;
                return runs < 3 ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
            });
            await settle(SETTLE * 2);
            return runs;
        },
        shows: 3,
    },
    {
        row: 'timeout',
        rule: 'a callback returning nothing is not SOURCE_CONTINUE',
        async observe({ GLib, settle }) {
            let runs = 0;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
                runs += 1;
            });
            await settle(SETTLE);
            return runs;
        },
        shows: 1,
    },
    {
        row: 'timeout',
        rule: 'the id is a positive integer and two sources never share one',
        observe({ GLib }) {
            const a = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => GLib.SOURCE_REMOVE);
            const b = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => GLib.SOURCE_REMOVE);
            const shape = [Number.isInteger(a) && a > 0, Number.isInteger(b) && b > 0, a !== b];
            GLib.source_remove(a);
            GLib.source_remove(b);
            return shape;
        },
        shows: [true, true, true],
    },
    {
        row: 'idle',
        rule: 'idle sources of a lower priority value run first (PRIORITY_HIGH_IDLE < DEFAULT_IDLE < LOW)',
        async observe({ GLib, settle }) {
            const order: string[] = [];
            GLib.idle_add(GLib.PRIORITY_LOW, () => void order.push('low'));
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => void order.push('default'));
            GLib.idle_add(GLib.PRIORITY_HIGH_IDLE, () => void order.push('high'));
            await settle(SETTLE);
            return order;
        },
        shows: ['high', 'default', 'low'],
    },
    {
        row: 'idle',
        rule: 'an idle callback returning SOURCE_CONTINUE repeats until it returns SOURCE_REMOVE',
        async observe({ GLib, settle }) {
            let runs = 0;
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                runs += 1;
                return runs < 3 ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
            });
            await settle(SETTLE);
            return runs;
        },
        shows: 3,
    },
    {
        row: 'idle',
        rule: 'an idle callback does not run inside idle_add',
        observe({ GLib }) {
            let runs = 0;
            const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                runs += 1;
                return GLib.SOURCE_REMOVE;
            });
            GLib.source_remove(id);
            return runs;
        },
        shows: 0,
    },
    {
        row: 'remove',
        rule: 'source_remove of a live timeout answers true and the callback never runs',
        async observe({ GLib, settle }) {
            let runs = 0;
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => void (runs += 1));
            const removed = GLib.source_remove(id);
            await settle(SETTLE);
            return [removed, runs];
        },
        shows: [true, 0],
    },
    {
        row: 'remove',
        rule: 'source_remove of a live idle source answers true and the callback never runs',
        async observe({ GLib, settle }) {
            let runs = 0;
            const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => void (runs += 1));
            const removed = GLib.source_remove(id);
            await settle(SETTLE);
            return [removed, runs];
        },
        shows: [true, 0],
    },
    {
        row: 'remove',
        rule: 'source_remove of an unknown id answers false, and so does removing twice',
        observe({ GLib }) {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => GLib.SOURCE_REMOVE);
            return [GLib.source_remove(987654321), GLib.source_remove(id), GLib.source_remove(id)];
        },
        shows: [false, true, false],
    },
    {
        row: 'remove',
        rule: 'source_remove of a source that already finished answers false',
        async observe({ GLib, settle }) {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => GLib.SOURCE_REMOVE);
            await settle(SETTLE);
            return GLib.source_remove(id);
        },
        shows: false,
    },
    {
        row: 'remove',
        rule: 'a source removes itself from its callback: true, and SOURCE_CONTINUE does not revive it',
        async observe({ GLib, settle }) {
            let runs = 0;
            let removed: boolean | null = null;
            const id: number = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
                runs += 1;
                removed = GLib.source_remove(id);
                return GLib.SOURCE_CONTINUE;
            });
            await settle(SETTLE);
            return [removed, runs];
        },
        shows: [true, 1],
    },
    {
        row: 'throw',
        rule: 'a throwing timeout callback is logged and its source removed: it runs once',
        async observe({ GLib, settle, quiet }) {
            let runs = 0;
            await quiet(async () => {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
                    runs += 1;
                    throw new Error('boom');
                });
                await settle(SETTLE);
            });
            return runs;
        },
        shows: 1,
    },
    {
        row: 'throw',
        rule: 'a throwing idle callback is logged and its source removed: it runs once, later sources still run',
        async observe({ GLib, settle, quiet }) {
            const seen: string[] = [];
            await quiet(async () => {
                GLib.idle_add(GLib.PRIORITY_HIGH_IDLE, () => {
                    seen.push('throws');
                    throw new Error('boom');
                });
                GLib.idle_add(GLib.PRIORITY_LOW, () => void seen.push('low'));
                await settle(SETTLE);
            });
            return seen;
        },
        shows: ['throws', 'low'],
    },
    {
        row: 'arguments',
        rule: 'a callback that is not a function throws',
        observe: ({ GLib }) => [
            attempt(() => void GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, null as never)),
            attempt(() => void GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, null as never)),
        ],
        shows: [true, true],
    },
];

/** Holds a subject to the vectors. */
export async function driveGLibTimerVectors(
    subject: GLibTimersSubject,
    harness: ConstructHarness,
    vectors: readonly GLibTimerVector[] = GLIB_TIMER_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: GLib timers`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
