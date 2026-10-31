// SPDX-License-Identifier: MIT
// #2337 — what survives the Worker boundary?
//
// Sends one value per case through a real subprocess worker and compares what
// came back with what went in. The worker also reports what it *saw*, so a
// value that is mangled on the way out and restored on the way back cannot
// pass by accident.
//
//   gjsify build docs/poc/web-worker/src/01-wire-roundtrip.mts --app gjs \
//       --outfile docs/poc/web-worker/out/01-wire-roundtrip.gjs.mjs
//   gjsify run docs/poc/web-worker/out/01-wire-roundtrip.gjs.mjs

import '@gjsify/node-globals/register/timers';
import '@gjsify/node-globals/register/url';
import { Worker } from '@gjsify/worker_threads';

const WORKER = new URL('../src/fixtures/echo.worker.mjs', import.meta.url);

interface Case {
    readonly name: string;
    readonly make: () => unknown;
    /** What the worker must report having received. */
    readonly expectTag: string;
    /** Compare the value that came back with the value that went in. */
    readonly same: (sent: any, back: any) => boolean;
    /**
     * What is wrong with the value that came back, in this case's own terms.
     * Without it a value-level failure prints nothing a reader can act on —
     * the tag matched, so naming the tag would only say "want X, saw X".
     */
    readonly explain?: (back: any) => string;
}

const cases: Case[] = [
    {
        name: 'Date',
        make: () => new Date('2026-10-30T12:34:56.789Z'),
        expectTag: 'Date',
        same: (a, b) => b instanceof Date && b.getTime() === a.getTime(),
    },
    {
        name: 'Map (string keys)',
        make: () =>
            new Map([
                ['a', 1],
                ['b', 2],
            ]),
        expectTag: 'Map',
        same: (a, b) => b instanceof Map && b.size === a.size && b.get('b') === 2,
    },
    {
        name: 'Map (object keys)',
        make: () => new Map([[{ k: 1 }, new Date(0)]]),
        expectTag: 'Map',
        same: (_a, b) => b instanceof Map && [...b.values()][0] instanceof Date,
    },
    {
        name: 'Set',
        make: () => new Set([1, 'two', 3n]),
        expectTag: 'Set',
        same: (a, b) => b instanceof Set && b.size === a.size && b.has('two'),
    },
    {
        name: 'BigInt',
        make: () => 9007199254740993n,
        expectTag: 'bigint',
        same: (a, b) => typeof b === 'bigint' && b === a,
    },
    {
        name: 'RegExp',
        make: () => /ab+c/giu,
        expectTag: 'RegExp',
        same: (a, b) => b instanceof RegExp && b.source === a.source && b.flags === a.flags,
    },
    {
        name: 'Error (TypeError)',
        make: () => new TypeError('wire-error'),
        expectTag: 'Error:TypeError',
        same: (a, b) => b instanceof Error && b.message === a.message && b.name === a.name,
    },
    {
        name: 'Uint8Array',
        make: () => new Uint8Array([1, 2, 253]),
        expectTag: 'Uint8Array(3)',
        same: (a, b) => b instanceof Uint8Array && b.length === a.length && b[2] === 253,
    },
    {
        name: 'Float64Array',
        make: () => new Float64Array([0.5, -1.25]),
        expectTag: 'Float64Array(2)',
        same: (a, b) => b instanceof Float64Array && b[1] === -1.25,
    },
    {
        name: 'BigInt64Array',
        make: () => new BigInt64Array([1n, -2n]),
        expectTag: 'BigInt64Array(2)',
        same: (a, b) => b instanceof BigInt64Array && b[1] === -2n,
    },
    {
        name: 'ArrayBuffer',
        make: () => new Uint8Array([9, 8, 7]).buffer,
        expectTag: 'ArrayBuffer(3)',
        same: (a, b) => b instanceof ArrayBuffer && b.byteLength === (a as ArrayBuffer).byteLength,
    },
    {
        name: 'DataView',
        make: () => new DataView(new Uint8Array([1, 2, 3, 4]).buffer),
        expectTag: 'DataView(4)',
        same: (_a, b) => b instanceof DataView && b.byteLength === 4,
    },
    {
        name: 'typed-array view offset',
        make: () => new Uint8Array(new Uint8Array([1, 2, 3, 4, 5]).buffer, 1, 3),
        expectTag: 'Uint8Array(3)',
        same: (_a, b) => b instanceof Uint8Array && b.length === 3 && b[0] === 2,
    },
    {
        name: 'undefined inside object',
        make: () => ({ a: undefined, b: 1 }),
        expectTag: 'object',
        same: (_a, b) => 'a' in b && b.a === undefined && b.b === 1,
        explain: (b) => `key "a" survived: ${'a' in b} (b.b = ${String(b?.b)})`,
    },
    {
        name: 'negative zero',
        make: () => ({ z: -0 }),
        expectTag: 'object',
        same: (_a, b) => Object.is(b.z, -0),
        explain: (b) => `came back as ${Object.is(b?.z, -0) ? '-0' : '+0'} (1/z = ${1 / b?.z})`,
    },
    {
        name: 'NaN / Infinity',
        make: () => ({ n: NaN, p: Infinity, m: -Infinity }),
        expectTag: 'object',
        same: (_a, b) => Number.isNaN(b.n) && b.p === Infinity && b.m === -Infinity,
    },
    {
        name: 'cyclic object',
        make: () => {
            const o: Record<string, unknown> = { tag: 'cycle' };
            o.self = o;
            return o;
        },
        expectTag: 'object',
        same: (_a, b) => b?.self === b,
    },
    {
        name: 'shared reference (same object twice)',
        make: () => {
            const inner = { id: 1 };
            return { a: inner, b: inner };
        },
        expectTag: 'object',
        same: (_a, b) => b.a === b.b,
    },
    {
        name: 'sparse array',
        // eslint-disable-next-line no-sparse-arrays
        make: () => [1, , 3],
        expectTag: 'Array(3)',
        same: (_a, b) => Array.isArray(b) && b.length === 3 && !(1 in b),
        explain: (b) => `hole at index 1 filled with ${String(b?.[1])} (1 in b: ${1 in b})`,
    },
    {
        name: 'function (must throw DataCloneError)',
        make: () => ({ fn: () => 1 }),
        expectTag: 'THROWS',
        same: () => false,
        explain: (b) => `postMessage did not throw; fn came back as ${typeof b?.fn}`,
    },
    {
        name: 'nested mix',
        make: () => ({
            when: new Date(1000),
            tags: new Set(['a']),
            index: new Map([['k', new Uint8Array([1])]]),
            big: 12345678901234567890n,
            err: new RangeError('nested'),
        }),
        expectTag: 'object',
        same: (_a, b) =>
            b.when instanceof Date &&
            b.tags instanceof Set &&
            b.index instanceof Map &&
            b.index.get('k') instanceof Uint8Array &&
            typeof b.big === 'bigint' &&
            b.err instanceof RangeError,
        explain: (b) =>
            [
                `Date ${b?.when instanceof Date}`,
                `Set ${b?.tags instanceof Set}`,
                `Map ${b?.index instanceof Map}`,
                `Uint8Array in Map ${b?.index?.get?.('k') instanceof Uint8Array}`,
                `bigint ${typeof b?.big === 'bigint'}`,
                `RangeError ${b?.err instanceof RangeError} (came back as ${b?.err?.constructor?.name}, .name = ${b?.err?.name})`,
            ].join(', '),
    },
];

// One worker per case. A case that kills the child must not take the rest of
// the run with it — and a decode failure in the child does kill it.
const session = async () => {
    const worker = new Worker(WORKER);
    let workerError: string | null = null;
    let exited: number | null = null;

    await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('worker never became ready')), 8000);
        worker.on('message', (m: any) => {
            if (m?.type === 'ready') {
                clearTimeout(t);
                resolve();
            }
        });
        worker.on('error', (e: Error) => {
            workerError ??= e?.message ?? String(e);
            clearTimeout(t);
            reject(new Error(`worker error: ${workerError}`));
        });
        worker.on('exit', (c: number) => {
            exited ??= c;
        });
    });

    const ask = (msg: unknown, ms = 4000) =>
        new Promise<any>((resolve, reject) => {
            const t = setTimeout(() => {
                reject(
                    new Error(
                        workerError
                            ? `child reported: ${workerError}${exited === null ? '' : ` (exit ${exited})`}`
                            : exited === null
                              ? 'timeout, child alive and silent'
                              : `timeout, child exited ${exited}`,
                    ),
                );
            }, ms);
            const onMessage = (m: any) => {
                if (m?.type === 'ready') return;
                clearTimeout(t);
                worker.off('message', onMessage);
                resolve(m);
            };
            worker.on('message', onMessage);
            try {
                worker.postMessage(msg);
            } catch (e) {
                clearTimeout(t);
                worker.off('message', onMessage);
                reject(new Error(`parent postMessage threw: ${(e as Error).message}`));
            }
        });

    return { ask, close: () => worker.terminate() };
};

let pass = 0;
let fail = 0;

for (const c of cases) {
    const sent = c.make();
    let line: string;
    const s = await session();
    try {
        const seen = await s.ask({ type: 'describe', value: sent });
        const echoed = await s.ask({ type: 'echo', value: c.make() });
        const tagOk = seen.report?.tag === c.expectTag;
        const valueOk = c.same(sent, echoed.value);
        const extra =
            c.name === 'cyclic object' || c.name === 'shared reference (same object twice)'
                ? ` worker-saw-self=${seen.report?.self}`
                : '';
        if (tagOk && valueOk) {
            pass++;
            line = `PASS  ${c.name}`;
        } else {
            fail++;
            const why: string[] = [];
            if (!tagOk) why.push(`worker saw ${JSON.stringify(seen.report?.tag)}, want ${JSON.stringify(c.expectTag)}`);
            if (!valueOk) why.push(c.explain?.(echoed.value) ?? 'the value that came back differs');
            line = `FAIL  ${c.name} — ${why.join('; ')}${extra}`;
        }
    } catch (e) {
        const msg = (e as Error).message;
        const isClone = /clone|convert|serial|JSON|circular|cyclic/i.test(msg);
        if (c.expectTag === 'THROWS' && isClone) {
            pass++;
            line = `PASS  ${c.name} — threw: ${msg.slice(0, 70)}`;
        } else {
            fail++;
            line = `FAIL  ${c.name} — ${msg.slice(0, 110)}`;
        }
    }
    await s.close();
    console.log(line);
}

console.log(`\n01-wire-roundtrip: ${pass} pass, ${fail} fail, ${cases.length} cases`);
