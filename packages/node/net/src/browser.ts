// SPDX-License-Identifier: MIT
// Reference: Node.js lib/net.js (surface mirror); the IP classifier mirrors the
// same inlined-regex approach `@gjsify/dns`'s `src/browser.ts` already uses.
//
// The BROWSER platform entry for `@gjsify/net` — the module
// `gjsify build --app browser` resolves for `net` / `node:net` (see
// `ALIASES_NODE_FOR_BROWSER_TABLE` in
// `packages/infra/resolve-npm/lib/index.mjs`).
//
// ## What can and cannot exist here
//
// A browser sandbox exposes no raw TCP: it cannot dial an arbitrary host:port
// and it cannot accept an inbound connection. `Socket`, `Server`, `connect`,
// `createConnection` and `createServer` are therefore not "unimplemented", they
// are unimplementable, and they throw a structured error naming the module, the
// runtime and the caller.
//
// `isIP` / `isIPv4` / `isIPv6` are the exception, and they are the reason this
// file is not a blanket thrower: they are pure string classification with no
// platform contact at all. The GJS root entry happens to implement them via
// `Gio.InetAddress`, but that is an implementation detail — the ANSWER is
// platform-independent. Throwing on them would replace one lie (silently
// `undefined`) with a different one ("this cannot work here"), so they are
// implemented for real, with the same coarse regex classifier
// `@gjsify/dns`'s browser entry already inlines.
//
// Slot: browser:"none" — a NAMED unsupported stub. `none` describes the MODULE
// (you cannot open a socket), not whether an incidental pure helper links.
// Promoting the slot would change ADR-0014 derived routing and is a declaration
// change beyond the scope of naming this redirect. `scripts/audit-runtimes.mjs`
// reads the marker on the line above so its drift heuristic does not read the
// mere EXISTENCE of a `src/browser.ts` as a promotion to `polyfill`.
//
// The `unsupported()` helper is deliberately LOCAL — see the note in
// `@gjsify/child_process`'s `src/browser.ts` for why (no imports at all in a
// browser platform entry ⇒ no possible GJS leak).

const MODULE = 'net';
const RUNTIME = 'browser';
const REASON =
    'a browser sandbox exposes no raw TCP — it can neither dial an arbitrary host:port nor accept an inbound connection';

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

// `isIP` / `isIPv4` / `isIPv6` come from the package's shared classifier.
//
// This entry documents that it imports NOTHING, so that no GJS module can leak
// into a browser bundle through it. `is-ip.ts` takes no imports of its own, so
// that property is preserved by construction — and the alternative was a second
// copy of a spec-defined function, which is exactly how the GJS entry and this
// one came to disagree about `01.02.03.04` (see `is-ip.ts` for the measurement).
export { isIP, isIPv4, isIPv6 } from './is-ip.js';
import { isIP, isIPv4, isIPv6 } from './is-ip.js';

// ─── Unimplementable surface ──────────────────────────────────────────────

/** A TCP client socket. Constructing one needs raw TCP; throws `ENOTSUP`. */
export class Socket {
    constructor() {
        unsupported('Socket');
    }
}

/** A TCP listening socket. A browser cannot accept connections; throws `ENOTSUP`. */
export class Server {
    constructor() {
        unsupported('Server');
    }
}

export function createConnection(..._args: unknown[]): Socket {
    return unsupported('createConnection');
}

export function connect(..._args: unknown[]): Socket {
    return unsupported('connect');
}

export function createServer(..._args: unknown[]): Server {
    return unsupported('createServer');
}

const netDefault = {
    isIP,
    isIPv4,
    isIPv6,
    Socket,
    Server,
    createConnection,
    connect,
    createServer,
};

export default netDefault;
