// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target.
//
// Reference: refs/node/lib/dns.js (surface mirror)
//
// Slot: "browser:partial" — `lookup()` resolves only what a browser can
// honestly resolve without a DNS API (IP literals + `localhost`); every real
// name resolution (and every `resolve*`/`reverse`) returns a structured
// ENOTSUP. Mirrors `node-stdlib-browser`'s `dns mock`.
//
// A browser sandbox exposes no DNS resolver. Earlier versions of this stub
// resolved *every* hostname to 127.0.0.1, which silently lied about names
// like `example.com`. We now only short-circuit cases that are correct
// without a resolver:
//   - IP-address literals (v4/v6) — no DNS needed, the answer is the input.
//   - the reserved name `localhost` — always loopback per RFC 6761.
// Anything that would require a real DNS query reports ENOTSUP through the
// usual error channel (callback / rejected promise) instead of crashing.

type ErrnoLike = Error & { code?: string; errno?: number; syscall?: string; hostname?: string };

function makeNotSupported(syscall: string, hostname?: string): ErrnoLike {
    const err: ErrnoLike = new Error(`${syscall} ${hostname ?? ''} not available in browser`.trim());
    err.code = 'ENOTSUP';
    err.errno = -45;
    err.syscall = syscall;
    if (hostname !== undefined) err.hostname = hostname;
    return err;
}

// Minimal `node:net.isIP`-style probe (0 = not an IP, 4 = IPv4, 6 = IPv6).
// Inlined so the browser entry stays dependency-free — we only need the
// coarse classification, not full canonicalization.
function classifyIP(host: string): 0 | 4 | 6 {
    // IPv4: four 0-255 dotted octets.
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (v4) {
        if (v4.slice(1).every((o) => Number(o) <= 255)) return 4;
        return 0;
    }
    // IPv6: at least one ':' and only hex digits / ':' / '.' (v4-mapped tail).
    if (host.includes(':') && /^[0-9a-fA-F:.]+$/.test(host)) return 6;
    return 0;
}

// Hostnames a browser can resolve to loopback without any DNS query.
function loopbackFor(hostname: string, family: 4 | 6): { address: string; family: 4 | 6 } | null {
    const ip = classifyIP(hostname);
    if (ip === 4) return { address: hostname, family: 4 };
    if (ip === 6) return { address: hostname, family: 6 };
    if (hostname === 'localhost') {
        return family === 6 ? { address: '::1', family: 6 } : { address: '127.0.0.1', family: 4 };
    }
    return null;
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
    const resolved = loopbackFor(hostname, family);
    queueMicrotask(() => {
        if (!resolved) {
            // A real DNS query — not possible in the browser. Report through
            // the callback rather than lying with a loopback address.
            (callback as (err: ErrnoLike | null, addr: string, fam: number) => void)(
                makeNotSupported('lookup', hostname),
                '',
                family,
            );
            return;
        }
        if (opts.all) {
            (callback as (err: ErrnoLike | null, addrs: LookupAddress[]) => void)(null, [resolved]);
        } else {
            (callback as (err: ErrnoLike | null, addr: string, fam: number) => void)(
                null,
                resolved.address,
                resolved.family,
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
        return new Promise((resolveP, rejectP) => {
            const family = opts.family === 6 ? 6 : 4;
            const resolved = loopbackFor(hostname, family);
            queueMicrotask(() => {
                if (!resolved) {
                    rejectP(makeNotSupported('lookup', hostname));
                    return;
                }
                if (opts.all) resolveP([resolved]);
                else resolveP(resolved);
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
