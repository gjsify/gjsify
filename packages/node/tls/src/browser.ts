// SPDX-License-Identifier: MIT
// Reference: Node.js lib/tls.js (surface mirror). The OCSP / channel-binding
// constant tables mirror `@gjsify/tls-native`
// (`packages/node/tls-native/src/ts/index.ts`); their VALUES are assigned by
// RFC 6960 §4.2.1 and RFC 5929 / RFC 9266, so restating them here is restating
// a spec, not forking an implementation.
//
// The BROWSER platform entry for `@gjsify/tls` — the module
// `gjsify build --app browser` resolves for `tls` / `node:tls` (see
// `ALIASES_NODE_FOR_BROWSER_TABLE` in
// `packages/infra/resolve-npm/lib/index.mjs`).
//
// ## What can and cannot exist here
//
// A user agent terminates TLS BELOW the JavaScript layer. There is no socket
// to wrap, no secure context to build and no handshake to observe — the same
// reason `@gjsify/https`' own browser entry cannot re-export `TLSSocket` or
// `createSecureContext` (see the `https` row in AGENTS.md). So `TLSSocket`,
// `Server`/`TLSServer`, `connect`, `createServer` and `createSecureContext`
// throw a structured error that names the module, the runtime and the caller.
//
// Three groups deliberately do NOT throw, because an honest answer exists:
//
//   · `checkServerIdentity` is REAL. It is pure RFC 6125 §6.4.3 hostname
//     matching over strings (`src/internal/hostname.ts` takes a single TYPE
//     import and nothing else), so it is re-exported unchanged rather than
//     reimplemented or stubbed.
//   · `rootCertificates` / `getCiphers()` return empty — which is the correct
//     information ("this platform exposes no trust store / cipher list to JS"),
//     and is also what the GJS root entry returns for `rootCertificates`.
//   · `hasOcspSupport()` / `hasTlsSessionAccess()` return `false`. Returning
//     false IS their contract; they exist precisely so a caller can detect an
//     unsupported platform without provoking a throw. `parseOcspResponse` then
//     throws, exactly as the root entry documents for the ungated call.
//
// Slot: browser:"none" — a NAMED unsupported stub. `none` describes the MODULE
// (you cannot open a TLS socket), not whether an incidental pure helper links.
// Promoting it would change ADR-0014 derived routing, which is a declaration
// change beyond the scope of naming this redirect. `scripts/audit-runtimes.mjs`
// reads the marker on the line above so its drift heuristic does not read the
// mere EXISTENCE of a `src/browser.ts` as a promotion to `polyfill`.
//
// The `unsupported()` helper is deliberately LOCAL — see the note in
// `@gjsify/child_process`'s `src/browser.ts`.

const MODULE = 'tls';
const RUNTIME = 'browser';
const REASON =
    'a user agent terminates TLS below the JavaScript layer — there is no socket to wrap and no secure context to hand back';

interface UnsupportedError extends Error {
    code: string;
    errno: number;
    syscall: string;
    gjsifyModule: string;
    gjsifyRuntime: string;
    gjsifyImporter?: string;
}

/** Best-effort call site of the importer — see `child_process/src/browser.ts`. */
function callerFrame(stack: string | undefined): string | undefined {
    if (!stack) return undefined;
    const frames: string[] = [];
    for (const raw of stack.split('\n').slice(1)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.includes('unsupported') || line.includes('callerFrame')) continue;
        frames.push(line.replace(/^at\s+/, ''));
        if (frames.length === 2) break;
    }
    return frames[1] ?? frames[0];
}

/** Throw a structured, self-describing "not on this platform" error. */
function unsupported(name: string): never {
    const importer = callerFrame(new Error().stack);
    const err = new Error(
        `[@gjsify/${MODULE}/${RUNTIME}] ${MODULE}.${name} is not available on the ${RUNTIME} platform: ` +
            `${REASON}.${importer ? ` Called from ${importer}.` : ''}`,
    ) as UnsupportedError;
    err.code = 'ENOTSUP';
    err.errno = -45;
    err.syscall = name;
    err.gjsifyModule = MODULE;
    err.gjsifyRuntime = RUNTIME;
    if (importer !== undefined) err.gjsifyImporter = importer;
    throw err;
}

// ─── Real, platform-independent surface ───────────────────────────────────

export const DEFAULT_MIN_VERSION = 'TLSv1.2';
export const DEFAULT_MAX_VERSION = 'TLSv1.3';
export const DEFAULT_CIPHERS =
    'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384';

/**
 * Pure RFC 6125 §6.4.3 hostname matching — identical on every runtime, so the
 * browser entry uses the SAME implementation as the root entry instead of a
 * stub. (`internal/hostname.ts` takes one type-only import and no platform
 * dependency; see its header.)
 */
export { checkServerIdentity } from './internal/hostname.js';

/**
 * A browser exposes no TLS cipher list to JavaScript. Empty is the honest
 * answer, not a placeholder — the UA negotiates ciphers below this layer.
 */
export function getCiphers(): string[] {
    return [];
}

/**
 * A browser exposes no trust store to JavaScript. Empty matches the GJS root
 * entry, which also cannot enumerate the system store.
 */
export const rootCertificates: string[] = [];

/** Symbolic OCSP cert-status values per RFC 6960 §4.2.1. */
export const OcspCertStatus = {
    GOOD: 0,
    REVOKED: 1,
    UNKNOWN: 2,
} as const;
export type OcspCertStatus = (typeof OcspCertStatus)[keyof typeof OcspCertStatus];

/** Symbolic OCSP responseStatus values per RFC 6960 §4.2.1. */
export const OcspResponseStatus = {
    SUCCESSFUL: 0,
    MALFORMED_REQUEST: 1,
    INTERNAL_ERROR: 2,
    TRY_LATER: 3,
    SIG_REQUIRED: 5,
    UNAUTHORIZED: 6,
} as const;
export type OcspResponseStatus = (typeof OcspResponseStatus)[keyof typeof OcspResponseStatus];

/** Symbolic channel-binding type per RFC 5929 / RFC 9266. */
export const TlsChannelBindingType = {
    TLS_UNIQUE: 0,
    TLS_SERVER_END_POINT: 1,
    TLS_EXPORTER: 2,
} as const;
export type TlsChannelBindingType = (typeof TlsChannelBindingType)[keyof typeof TlsChannelBindingType];

/**
 * `false` on the browser platform — the OCSP bridge is a GJS-only Vala
 * prebuild. Callers gate on this exactly as they do on Node.
 */
export function hasOcspSupport(): boolean {
    return false;
}

/**
 * `false` on the browser platform — there is no `gnutls_session_t` to reach.
 * Same contract as on Node / a GnuTLS-less build.
 */
export function hasTlsSessionAccess(): boolean {
    return false;
}

// ─── Unimplementable surface ──────────────────────────────────────────────

/**
 * Parse a DER-encoded OCSP response. Throws when OCSP support is unavailable —
 * the root entry's documented contract for an ungated call. Gate with
 * `hasOcspSupport()`.
 */
export function parseOcspResponse(_bytes: Uint8Array): never {
    return unsupported('parseOcspResponse');
}

/** A TLS client socket. Nothing below this layer is reachable; throws `ENOTSUP`. */
export class TLSSocket {
    constructor() {
        unsupported('TLSSocket');
    }
}

/** A TLS listening socket. A browser cannot accept connections; throws `ENOTSUP`. */
export class TLSServer {
    constructor() {
        unsupported('TLSServer');
    }
}

export { TLSServer as Server };

export function connect(..._args: unknown[]): TLSSocket {
    return unsupported('connect');
}

export function createServer(..._args: unknown[]): TLSServer {
    return unsupported('createServer');
}

export function createSecureContext(..._args: unknown[]): never {
    return unsupported('createSecureContext');
}

import { checkServerIdentity as _checkServerIdentity } from './internal/hostname.js';

const tlsDefault = {
    DEFAULT_MIN_VERSION,
    DEFAULT_MAX_VERSION,
    DEFAULT_CIPHERS,
    checkServerIdentity: _checkServerIdentity,
    getCiphers,
    rootCertificates,
    OcspCertStatus,
    OcspResponseStatus,
    TlsChannelBindingType,
    hasOcspSupport,
    hasTlsSessionAccess,
    parseOcspResponse,
    TLSSocket,
    TLSServer,
    Server: TLSServer,
    connect,
    createServer,
    createSecureContext,
};

export default tlsDefault;
