// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target.
//
// Reference: refs/node/lib/dns.js (surface mirror)
//
// Slot: "browser:partial" — `lookup()` works (loopback), every real DNS
// resolver method throws ENOTSUP. Mirrors `node-stdlib-browser`'s `dns mock`.
//
// Browser has no DNS resolver API surface. We supply a `lookup()` that
// resolves to 127.0.0.1 (loopback) so consumers performing a perfunctory
// "is this even a hostname"-style check don't blow up, and `ENOTSUP`-coded
// throws for every real-resolution method.

type ErrnoLike = Error & { code?: string; errno?: number; syscall?: string; hostname?: string };

function makeNotSupported(syscall: string, hostname?: string): ErrnoLike {
    const err: ErrnoLike = new Error(`${syscall} ${hostname ?? ''} not available in browser`.trim());
    err.code = 'ENOTSUP';
    err.errno = -45;
    err.syscall = syscall;
    if (hostname !== undefined) err.hostname = hostname;
    return err;
}

// ─── Public error code re-exports (subset; matches @gjsify/dns) ──────────

export const NODATA = 'ENODATA';
export const FORMERR = 'EFORMERR';
export const SERVFAIL = 'ESERVFAIL';
export const NOTFOUND = 'ENOTFOUND';
export const NOTIMP = 'ENOTIMP';
export const REFUSED = 'EREFUSED';
export const BADQUERY = 'EBADQUERY';
export const BADNAME = 'EBADNAME';
export const BADFAMILY = 'EBADFAMILY';
export const BADRESP = 'EBADRESP';
export const CONNREFUSED = 'ECONNREFUSED';
export const TIMEOUT = 'ETIMEOUT';
export const EOF = 'EOF';
export const FILE = 'EFILE';
export const NOMEM = 'ENOMEM';
export const DESTRUCTION = 'EDESTRUCTION';
export const BADSTR = 'EBADSTR';
export const BADFLAGS = 'EBADFLAGS';
export const NONAME = 'ENONAME';
export const BADHINTS = 'EBADHINTS';
export const NOTINITIALIZED = 'ENOTINITIALIZED';
export const LOADIPHLPAPI = 'ELOADIPHLPAPI';
export const ADDRGETNETWORKPARAMS = 'EADDRGETNETWORKPARAMS';
export const CANCELLED = 'ECANCELLED';

export const ADDRCONFIG = 32;
export const V4MAPPED = 8;
export const ALL = 16;

// ─── lookup — degraded loopback ──────────────────────────────────────────

interface LookupOptions {
    family?: 0 | 4 | 6;
    hints?: number;
    all?: boolean;
    verbatim?: boolean;
}
type LookupAddress = { address: string; family: 4 | 6 };

// Mirrors `node:dns.lookup`. Callback-style only — the promises surface lives
// under `./promises` / the `promises` named export. We keep the impl loose
// (no overload tuple) so the structural callback shape matches every Node-typed
// consumer — overload-narrowed signatures clash with the W3C/Node `(err, addr,
// family) | (err, addrs[])` union the audit's strict-probe expects.
type LookupCb = (
    err: ErrnoLike | null,
    addressOrAddresses: string | LookupAddress[],
    family?: number,
) => void;

export function lookup(
    hostname: string,
    optsOrCb: number | LookupOptions | LookupCb,
    cb?: LookupCb,
): void {
    let opts: LookupOptions = {};
    let callback = cb;
    if (typeof optsOrCb === 'function') {
        callback = optsOrCb as typeof cb;
    } else if (typeof optsOrCb === 'number') {
        opts = { family: optsOrCb as 0 | 4 | 6 };
    } else if (optsOrCb && typeof optsOrCb === 'object') {
        opts = optsOrCb;
    }
    if (typeof callback !== 'function') {
        throw new TypeError('The "cb" argument must be of type function');
    }
    const family = opts.family === 6 ? 6 : 4;
    const address = family === 6 ? '::1' : '127.0.0.1';
    queueMicrotask(() => {
        if (opts.all) {
            (callback as (err: ErrnoLike | null, addrs: LookupAddress[]) => void)(null, [
                { address, family },
            ]);
        } else {
            (callback as (err: ErrnoLike | null, addr: string, fam: number) => void)(
                null,
                address,
                family,
            );
        }
    });
}

// ─── lookupService / resolve* / reverse / setServers / getServers ────────

export function lookupService(
    _address: string,
    _port: number,
    cb: (err: ErrnoLike | null, hostname: string, service: string) => void,
): void {
    queueMicrotask(() => cb(makeNotSupported('lookupService'), '', ''));
}

function _throwingAsync(syscall: string) {
    return (
        hostname: string,
        cb?: (err: ErrnoLike | null, result?: unknown) => void,
    ): void => {
        const fn = typeof cb === 'function' ? cb : undefined;
        if (!fn) {
            // Node's API requires a callback — mirror its TypeError.
            throw new TypeError('The "cb" argument must be of type function');
        }
        queueMicrotask(() => fn(makeNotSupported(syscall, hostname)));
    };
}

export const resolve = _throwingAsync('resolve');
export const resolve4 = _throwingAsync('resolve4');
export const resolve6 = _throwingAsync('resolve6');
export const resolveAny = _throwingAsync('resolveAny');
export const resolveCname = _throwingAsync('resolveCname');
export const resolveCaa = _throwingAsync('resolveCaa');
export const resolveMx = _throwingAsync('resolveMx');
export const resolveNaptr = _throwingAsync('resolveNaptr');
export const resolveNs = _throwingAsync('resolveNs');
export const resolvePtr = _throwingAsync('resolvePtr');
export const resolveSoa = _throwingAsync('resolveSoa');
export const resolveSrv = _throwingAsync('resolveSrv');
export const resolveTxt = _throwingAsync('resolveTxt');
export const reverse = _throwingAsync('reverse');

export const getServers = (): string[] => [];
export const setServers = (_servers: string[]): void => {
    // No-op in browser — matches what node-stdlib-browser does.
};
export const setDefaultResultOrder = (_order: 'ipv4first' | 'verbatim' | 'ipv6first'): void => {};
export const getDefaultResultOrder = (): 'verbatim' => 'verbatim';

// ─── Promises surface ────────────────────────────────────────────────────

function _throwingPromise(syscall: string) {
    return (hostname?: string): Promise<never> =>
        Promise.reject(makeNotSupported(syscall, hostname));
}

export const promises = {
    lookup(hostname: string, opts: LookupOptions = {}): Promise<LookupAddress | LookupAddress[]> {
        return new Promise((resolveP) => {
            const family = opts.family === 6 ? 6 : 4;
            const address = family === 6 ? '::1' : '127.0.0.1';
            queueMicrotask(() => {
                if (opts.all) resolveP([{ address, family }]);
                else resolveP({ address, family });
            });
        });
    },
    lookupService(_address: string, _port: number): Promise<{ hostname: string; service: string }> {
        return Promise.reject(makeNotSupported('lookupService'));
    },
    resolve: _throwingPromise('resolve'),
    resolve4: _throwingPromise('resolve4'),
    resolve6: _throwingPromise('resolve6'),
    resolveAny: _throwingPromise('resolveAny'),
    resolveCname: _throwingPromise('resolveCname'),
    resolveCaa: _throwingPromise('resolveCaa'),
    resolveMx: _throwingPromise('resolveMx'),
    resolveNaptr: _throwingPromise('resolveNaptr'),
    resolveNs: _throwingPromise('resolveNs'),
    resolvePtr: _throwingPromise('resolvePtr'),
    resolveSoa: _throwingPromise('resolveSoa'),
    resolveSrv: _throwingPromise('resolveSrv'),
    resolveTxt: _throwingPromise('resolveTxt'),
    reverse: _throwingPromise('reverse'),
    getServers,
    setServers,
    setDefaultResultOrder,
    getDefaultResultOrder,
};

// `dns.Resolver` placeholder so `new dns.Resolver()` doesn't throw on
// construction; every method routes through the same ENOTSUP path.
export class Resolver {
    constructor(_options?: { timeout?: number; tries?: number }) {}
    cancel(): void {}
    getServers(): string[] {
        return [];
    }
    setServers(_servers: string[]): void {}
    setLocalAddress(_v4?: string, _v6?: string): void {}
    resolve = _throwingAsync('resolve');
    resolve4 = _throwingAsync('resolve4');
    resolve6 = _throwingAsync('resolve6');
    resolveAny = _throwingAsync('resolveAny');
    resolveCname = _throwingAsync('resolveCname');
    resolveCaa = _throwingAsync('resolveCaa');
    resolveMx = _throwingAsync('resolveMx');
    resolveNaptr = _throwingAsync('resolveNaptr');
    resolveNs = _throwingAsync('resolveNs');
    resolvePtr = _throwingAsync('resolvePtr');
    resolveSoa = _throwingAsync('resolveSoa');
    resolveSrv = _throwingAsync('resolveSrv');
    resolveTxt = _throwingAsync('resolveTxt');
    reverse = _throwingAsync('reverse');
}

export default {
    lookup,
    lookupService,
    resolve,
    resolve4,
    resolve6,
    resolveAny,
    resolveCname,
    resolveCaa,
    resolveMx,
    resolveNaptr,
    resolveNs,
    resolvePtr,
    resolveSoa,
    resolveSrv,
    resolveTxt,
    reverse,
    getServers,
    setServers,
    setDefaultResultOrder,
    getDefaultResultOrder,
    promises,
    Resolver,
    NODATA,
    FORMERR,
    SERVFAIL,
    NOTFOUND,
    NOTIMP,
    REFUSED,
    BADQUERY,
    BADNAME,
    BADFAMILY,
    BADRESP,
    CONNREFUSED,
    TIMEOUT,
    EOF,
    FILE,
    NOMEM,
    DESTRUCTION,
    BADSTR,
    BADFLAGS,
    NONAME,
    BADHINTS,
    NOTINITIALIZED,
    LOADIPHLPAPI,
    ADDRGETNETWORKPARAMS,
    CANCELLED,
    ADDRCONFIG,
    V4MAPPED,
    ALL,
};
