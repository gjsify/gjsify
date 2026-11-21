/**
 * Per-host pacing: at most `maxConcurrent` requests in flight to one host, and optionally a gap
 * between the starts of two. Hosts are independent. Slots are handed over directly, so a waiter
 * never races a newcomer for the slot a finished request frees.
 */

export interface HostLimiterOptions {
    /** Requests in flight per host. Default 2. */
    readonly maxConcurrent?: number;
    /** Minimum gap between two request starts on one host, in ms. Default 0. */
    readonly minIntervalMs?: number;
    /** Injected for tests. */
    readonly sleep?: (ms: number) => Promise<void>;
    readonly now?: () => number;
}

interface HostState {
    active: number;
    waiting: Array<() => void>;
    nextStart: number;
}

export class HostLimiter {
    readonly #max: number;
    readonly #minInterval: number;
    readonly #sleep: (ms: number) => Promise<void>;
    readonly #now: () => number;
    readonly #hosts = new Map<string, HostState>();

    constructor(options: HostLimiterOptions = {}) {
        const max = options.maxConcurrent ?? 2;
        if (!Number.isInteger(max) || max < 1) throw new RangeError('maxConcurrent must be an integer >= 1');
        this.#max = max;
        this.#minInterval = Math.max(0, options.minIntervalMs ?? 0);
        this.#sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
        this.#now = options.now ?? (() => Date.now());
    }

    async run<T>(host: string, task: () => Promise<T>): Promise<T> {
        let state = this.#hosts.get(host);
        if (!state) {
            state = { active: 0, waiting: [], nextStart: 0 };
            this.#hosts.set(host, state);
        }
        if (state.active >= this.#max) await new Promise<void>((resolve) => state.waiting.push(resolve));
        else state.active += 1;

        try {
            if (this.#minInterval > 0) {
                const now = this.#now();
                const start = Math.max(now, state.nextStart);
                state.nextStart = start + this.#minInterval;
                if (start > now) await this.#sleep(start - now);
            }
            return await task();
        } finally {
            const next = state.waiting.shift();
            if (next) next();
            else state.active -= 1;
        }
    }
}
