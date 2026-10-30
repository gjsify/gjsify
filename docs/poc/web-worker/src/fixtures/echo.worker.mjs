// SPDX-License-Identifier: MIT
// Echo worker for the web-worker spike. Raw .mjs so the same file runs as a
// GJS subprocess worker and as a Node worker thread without bundling.
//
// Protocol:
//   { type: 'echo', value }   → { type: 'echo', value }   (value sent back as-is)
//   { type: 'describe', value } → { type: 'describe', report } (what arrived, by tag)
//   { type: 'rows', n }       → { type: 'rows', rows }    (n generated rows)
//   { type: 'bytes', n }      → { type: 'bytes', buf }    (n-byte Uint8Array)
//   { type: 'close' }         → closes the port

const ctx = globalThis.__gjsify_worker_context;
let parentPort;
if (ctx) {
    ({ parentPort } = ctx);
} else {
    ({ parentPort } = await import('node:worker_threads'));
}

const tag = (v) => {
    if (v === null) return 'null';
    if (typeof v !== 'object') return typeof v;
    if (v instanceof Date) return 'Date';
    if (v instanceof Map) return 'Map';
    if (v instanceof Set) return 'Set';
    if (v instanceof RegExp) return 'RegExp';
    if (v instanceof Error) return `Error:${v.name}`;
    if (v instanceof ArrayBuffer) return `ArrayBuffer(${v.byteLength})`;
    if (ArrayBuffer.isView(v)) return `${v.constructor.name}(${v.length})`;
    if (Array.isArray(v)) return `Array(${v.length})`;
    return 'object';
};

const describe = (v) => {
    const report = { tag: tag(v) };
    if (v instanceof Date) report.iso = v.toISOString();
    else if (v instanceof Map) report.entries = [...v.entries()].map(([k, x]) => [tag(k), tag(x)]);
    else if (v instanceof Set) report.members = [...v].map(tag);
    else if (v instanceof RegExp) report.source = `${v.source}/${v.flags}`;
    else if (v instanceof Error) report.message = v.message;
    else if (ArrayBuffer.isView(v)) report.first = String(v[0]);
    else if (typeof v === 'bigint') report.value = v.toString();
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
        report.keys = Object.keys(v);
        report.self = v.self === v;
        report.fields = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tag(x)]));
    }
    return report;
};

const makeRows = (n) => {
    const rows = new Array(n);
    for (let i = 0; i < n; i++) {
        rows[i] = {
            id: i,
            name: `item-${i}`,
            qty: i % 97,
            price: (i % 1000) / 100,
            active: i % 3 === 0,
            note: 'lorem ipsum dolor sit amet consectetur',
        };
    }
    return rows;
};

parentPort.on('message', (msg) => {
    switch (msg?.type) {
        case 'echo':
            parentPort.postMessage({ type: 'echo', value: msg.value });
            break;
        case 'describe':
            parentPort.postMessage({ type: 'describe', report: describe(msg.value) });
            break;
        case 'rows':
            parentPort.postMessage({ type: 'rows', rows: makeRows(msg.n) });
            break;
        case 'bytes':
            parentPort.postMessage({ type: 'bytes', buf: new Uint8Array(msg.n).fill(7) });
            break;
        case 'close':
            parentPort.close();
            break;
        default:
            parentPort.postMessage({ type: 'unknown', got: String(msg?.type) });
    }
});

parentPort.postMessage({ type: 'ready' });
