// process.hrtime — high-resolution monotonic timer. Reference: Node.js
// lib/process/per_thread.js (`hrtime`, `hrtime.bigint`).
//
// Source preference: GLib.get_monotonic_time() (microseconds → nanoseconds),
// then performance.now() (milliseconds → nanoseconds), finally Date.now()
// (milliseconds → nanoseconds, the only one that's clock-affected — last
// resort). The base sample is captured once at module load so successive
// hrtime() calls return deltas from a stable origin, matching Node's
// CLOCK_MONOTONIC_RAW behaviour.

import { getGjsGlobal } from './gjs.js';

export function getMonotonicTime(): bigint {
    try {
        const GLib = getGjsGlobal().imports?.gi?.GLib;
        if (GLib?.get_monotonic_time) {
            // GLib returns microseconds, convert to nanoseconds
            return BigInt(GLib.get_monotonic_time()) * 1000n;
        }
    } catch {
        /* ignore */
    }
    if (typeof performance?.now === 'function') {
        return BigInt(Math.round(performance.now() * 1e6));
    }
    return BigInt(Date.now()) * 1000000n;
}

export const hrtimeBase = getMonotonicTime();

export function hrtime(time?: [number, number]): [number, number] {
    const now = getMonotonicTime() - hrtimeBase;
    const seconds = Number(now / 1000000000n);
    const nanoseconds = Number(now % 1000000000n);

    if (time) {
        let diffSec = seconds - time[0];
        let diffNano = nanoseconds - time[1];
        if (diffNano < 0) {
            diffSec--;
            diffNano += 1e9;
        }
        return [diffSec, diffNano];
    }

    return [seconds, nanoseconds];
}

export function hrtimeBigint(): bigint {
    return getMonotonicTime() - hrtimeBase;
}
