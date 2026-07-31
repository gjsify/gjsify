// Node.js API coverage — mirrors the table in AGENTS.md and status/status.json.
//
// 41 user-facing Node APIs grouped by stdlib category. Status tiers as in
// the Web Standards file, minus `out-of-scope` (every Node API is in scope).
//
// Native Vala bridges (http-soup-bridge, http2-native, sab-native,
// terminal-native, tls-native) live separately in `bridges.ts` — they aren't
// Node modules in the usual sense, they expose extra GI typelibs that some
// Node modules opt into for native-grade performance.

export type NodeApiStatus = 'full' | 'partial' | 'stub';

export interface NodeApi {
    name: string;
    status: NodeApiStatus;
    /** Library or GI dependency the implementation builds on */
    backed?: string;
    note?: string;
}

export interface NodeApiCategory {
    name: string;
    apis: readonly NodeApi[];
}

export const nodeApiCategories: readonly NodeApiCategory[] = [
    {
        name: 'I/O & Filesystem',
        apis: [
            { name: 'fs', status: 'full', backed: 'Gio' },
            { name: 'path', status: 'full' },
            { name: 'url', status: 'full', backed: 'GLib.Uri' },
            { name: 'querystring', status: 'full' },
        ],
    },
    {
        name: 'Networking',
        apis: [
            { name: 'net', status: 'full', backed: 'Gio.Socket' },
            { name: 'dgram', status: 'full', backed: 'Gio.Socket UDP' },
            { name: 'dns', status: 'full', backed: 'Gio.Resolver' },
            { name: 'http', status: 'full', backed: 'Soup 3.0', note: 'Server + ClientRequest + Agent' },
            { name: 'https', status: 'full', backed: 'Soup 3.0' },
            {
                name: 'http2',
                status: 'full',
                backed: 'Soup 3.0',
                note: 'h2 via ALPN; pushStream/respondWithFD/respondWithFile via @gjsify/http2-native (libnghttp2)',
            },
            { name: 'tls', status: 'full', backed: 'Gio.TlsConnection' },
            {
                name: 'ws',
                status: 'partial',
                backed: '@gjsify/websocket',
                note: 'npm ws drop-in; Autobahn 510 OK / 0 FAIL',
            },
        ],
    },
    {
        name: 'Streams & Buffers',
        apis: [
            { name: 'stream', status: 'full' },
            { name: 'buffer', status: 'full', backed: 'Blob/File' },
            { name: 'string_decoder', status: 'full' },
            { name: 'zlib', status: 'full', backed: 'Web Compression API' },
        ],
    },
    {
        name: 'Crypto',
        apis: [{ name: 'crypto', status: 'full', backed: 'GLib.Checksum + Hmac' }],
    },
    {
        name: 'Concurrency',
        apis: [
            { name: 'events', status: 'full' },
            {
                name: 'worker_threads',
                status: 'partial',
                backed: 'Gio.Subprocess + @gjsify/sab-native',
                note: 'Cross-process IPC, file-based workers',
            },
            { name: 'async_hooks', status: 'full' },
            { name: 'cluster', status: 'stub' },
        ],
    },
    {
        name: 'Process & OS',
        apis: [
            { name: 'process', status: 'full', backed: 'GLib' },
            { name: 'os', status: 'full', backed: 'GLib' },
            { name: 'child_process', status: 'full', backed: 'Gio.Subprocess' },
            { name: 'tty', status: 'full', backed: 'GjsifyTerminal (Vala)' },
            { name: 'globals', status: 'full' },
            { name: 'module', status: 'full' },
        ],
    },
    {
        name: 'Diagnostics & Utilities',
        apis: [
            { name: 'util', status: 'full' },
            { name: 'console', status: 'full' },
            { name: 'assert', status: 'full' },
            { name: 'perf_hooks', status: 'full' },
            { name: 'diagnostics_channel', status: 'full' },
            { name: 'readline', status: 'full' },
            { name: 'timers', status: 'full', note: 'GLib-source-safe (GLib.timeout_add)' },
            { name: 'constants', status: 'full' },
            { name: 'sys', status: 'full', note: 'Deprecated alias for util' },
            { name: 'inspector', status: 'stub' },
            { name: 'domain', status: 'stub', note: 'Deprecated by Node' },
        ],
    },
    {
        name: 'Storage',
        apis: [{ name: 'sqlite', status: 'partial', backed: 'Gda 6.0 (SQLite provider)' }],
    },
    {
        name: 'Compute',
        apis: [
            { name: 'vm', status: 'partial', note: 'runInThisContext via eval; no realm isolation' },
            {
                name: 'v8',
                status: 'partial',
                note: 'Wire-format v15 serialize/deserialize; no heap snapshot or CPU profile',
            },
        ],
    },
];

export interface NodeTotals {
    full: number;
    partial: number;
    stub: number;
    total: number;
    coveragePct: number;
}

export function tallyNodeCategory(cat: NodeApiCategory): NodeTotals {
    const t = { full: 0, partial: 0, stub: 0 };
    for (const a of cat.apis) t[a.status]++;
    const total = t.full + t.partial + t.stub;
    const coveragePct = total === 0 ? 0 : Math.round(((t.full + t.partial) / total) * 100);
    return { ...t, total, coveragePct };
}

export function tallyAllNodeApis(): NodeTotals {
    const acc = { full: 0, partial: 0, stub: 0, total: 0 };
    for (const cat of nodeApiCategories) {
        const t = tallyNodeCategory(cat);
        acc.full += t.full;
        acc.partial += t.partial;
        acc.stub += t.stub;
        acc.total += t.total;
    }
    const coveragePct = acc.total === 0 ? 0 : Math.round(((acc.full + acc.partial) / acc.total) * 100);
    return { ...acc, coveragePct };
}
