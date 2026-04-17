// W3C RTCStatsReport — read-only Map<string, object> of WebRTC statistics.
//
// Reference: W3C WebRTC spec § 8.5
// The report is a frozen snapshot; .set()/.delete()/.clear() are no-ops.

export interface RTCStats {
    timestamp: number;
    type: string;
    id: string;
    [key: string]: unknown;
}

/**
 * Read-only Map-like collection of stats entries keyed by id.
 * W3C requires iteration support but not mutation.
 */
export class RTCStatsReport {
    private readonly _map: Map<string, RTCStats>;

    constructor(entries?: Iterable<[string, RTCStats]>) {
        this._map = new Map(entries);
    }

    get size(): number { return this._map.size; }

    get(key: string): RTCStats | undefined { return this._map.get(key); }
    has(key: string): boolean { return this._map.has(key); }

    forEach(callbackfn: (value: RTCStats, key: string, map: RTCStatsReport) => void, thisArg?: unknown): void {
        this._map.forEach((value, key) => {
            callbackfn.call(thisArg, value, key, this);
        });
    }

    entries(): IterableIterator<[string, RTCStats]> { return this._map.entries(); }
    keys(): IterableIterator<string> { return this._map.keys(); }
    values(): IterableIterator<RTCStats> { return this._map.values(); }
    [Symbol.iterator](): IterableIterator<[string, RTCStats]> { return this._map.entries(); }
}
