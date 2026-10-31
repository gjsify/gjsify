// SPDX-License-Identifier: MIT
// Tagged-JSON wire codec — what crosses the worker subprocess boundary
// (`structured-clone-wire.ts`).
//
// There are TWO copies of this codec: the TS module, and a raw-JS mirror
// inlined in `worker-bootstrap.ts` (BOOTSTRAP_CODE) because the spawned `gjs`
// has no module resolution to import the first one. So the structured-clone
// cases live in one `CODEC_CASES` matrix that runs against BOTH — the second
// run extracts the mirror out of BOOTSTRAP_CODE between its marker comments
// and evaluates it. A gap closed in one copy and forgotten in the other fails
// here instead of in a subprocess timeout.
//
// The binary cases are separate because the codec's base64 may not depend on
// `btoa`/`atob`: the mirror runs under a bare `gjs`, which has neither. The
// `without btoa/atob` case states that directly; `file-based-worker.spec.ts`
// covers the bootstrap's copy through a real subprocess, which is where the
// dependency actually broke.

import { describe, it, expect } from '@gjsify/unit';

import { decode, encode } from './structured-clone-wire.js';
import { BOOTSTRAP_CODE } from './worker-bootstrap.js';

interface Codec {
    encode(value: unknown, refs?: unknown): unknown;
    decode(value: unknown, refs?: unknown): unknown;
}

/** Encode, serialise, parse, decode — exactly what the transport does. */
function roundTripWith(codec: Codec, value: unknown): unknown {
    return codec.decode(JSON.parse(JSON.stringify(codec.encode(value))));
}

function roundTrip(value: unknown): unknown {
    return roundTripWith({ encode, decode }, value);
}

/**
 * Slice the mirror out of BOOTSTRAP_CODE and evaluate it. The markers are the
 * contract: they sit in the bootstrap template, and moving the codec out from
 * between them makes this fail rather than silently stop checking.
 */
function extractBootstrapCodec(): Codec {
    const beginMarker = '// --- GJSIFY_WIRE_CODEC_BEGIN ---';
    const endMarker = '// --- GJSIFY_WIRE_CODEC_END ---';
    const begin = BOOTSTRAP_CODE.indexOf(beginMarker);
    const end = BOOTSTRAP_CODE.indexOf(endMarker);
    if (begin === -1 || end <= begin) {
        throw new Error('BOOTSTRAP_CODE no longer carries the wire-codec markers');
    }
    const source = BOOTSTRAP_CODE.slice(begin + beginMarker.length, end);
    const factory = new Function(`${source}\nreturn { encode: encodeWire, decode: decodeWire };`);
    return factory() as Codec;
}

/**
 * Catch what `fn` throws and assert it is the DataCloneError the sender owes
 * its caller. `name` rather than `instanceof`: on a host with DOMException
 * the error is one of those, and on a bare `gjs` it is a tagged Error.
 */
function expectDataCloneError(fn: () => unknown): void {
    let caught: unknown;
    let threw = false;
    try {
        fn();
    } catch (error) {
        threw = true;
        caught = error;
    }
    expect(threw).toBe(true);
    expect((caught as Error).name).toBe('DataCloneError');
}

/**
 * The structured-clone case matrix, run against both copies of the codec.
 * One entry per behaviour the wire has to carry; `codec` is whichever copy is
 * under test.
 */
const CODEC_CASES: { name: string; check: (codec: Codec) => void }[] = [
    {
        name: 'keeps `undefined` as an object value',
        check: (codec) => {
            // JSON drops a key whose value is undefined, so without a tag the
            // key itself disappears and `'a' in back` turns false.
            const back = roundTripWith(codec, { a: undefined, b: 1 }) as Record<string, unknown>;
            expect('a' in back).toBe(true);
            expect(back.a).toBe(undefined);
            expect(back.b).toBe(1);
        },
    },
    {
        name: 'round-trips a top-level `undefined`',
        check: (codec) => {
            expect(roundTripWith(codec, undefined)).toBe(undefined);
            expect(roundTripWith(codec, null)).toBe(null);
        },
    },
    {
        name: 'round-trips `undefined` inside an array, Map and Set',
        check: (codec) => {
            const back = roundTripWith(codec, [undefined, 1]) as unknown[];
            expect(0 in back).toBe(true);
            expect(back[0]).toBe(undefined);
            const map = roundTripWith(codec, new Map([['k', undefined]])) as Map<string, unknown>;
            expect(map.has('k')).toBe(true);
            expect(map.get('k')).toBe(undefined);
            const set = roundTripWith(codec, new Set([undefined])) as Set<unknown>;
            expect(set.has(undefined)).toBe(true);
        },
    },
    {
        name: 'keeps the sign of negative zero',
        check: (codec) => {
            expect(Object.is(roundTripWith(codec, -0), -0)).toBe(true);
            expect(Object.is(roundTripWith(codec, 0), -0)).toBe(false);
            const back = roundTripWith(codec, { z: -0, arr: [-0, 0] }) as {
                z: number;
                arr: number[];
            };
            expect(Object.is(back.z, -0)).toBe(true);
            expect(Object.is(back.arr[0], -0)).toBe(true);
            expect(Object.is(back.arr[1], -0)).toBe(false);
        },
    },
    {
        name: 'keeps array holes sparse and distinct from `undefined`',
        check: (codec) => {
            // Built by assignment rather than as `[1, , 3]` so the holes are
            // unmistakable: indices 1 and 3 are never set, 4 is set to
            // `undefined`, and the two must stay distinguishable.
            const sent: unknown[] = [1];
            sent[2] = 3;
            sent[4] = undefined;
            const back = roundTripWith(codec, sent) as unknown[];
            expect(back.length).toBe(5);
            expect(1 in back).toBe(false);
            expect(3 in back).toBe(false);
            expect(4 in back).toBe(true);
            expect(back[4]).toBe(undefined);
            expect(back[0]).toBe(1);
            expect(back[2]).toBe(3);
        },
    },
    {
        name: 'round-trips a cyclic object',
        check: (codec) => {
            const sent: Record<string, unknown> = { name: 'root' };
            sent.self = sent;
            const back = roundTripWith(codec, sent) as Record<string, unknown>;
            expect(back.name).toBe('root');
            expect(back.self).toBe(back);
        },
    },
    {
        name: 'round-trips a cyclic array and a cycle through a Map',
        check: (codec) => {
            const arr: unknown[] = [1];
            arr.push(arr);
            const backArr = roundTripWith(codec, arr) as unknown[];
            expect(backArr[1]).toBe(backArr);

            const map = new Map<string, unknown>();
            map.set('self', map);
            const backMap = roundTripWith(codec, map) as Map<string, unknown>;
            expect(backMap.get('self')).toBe(backMap);
        },
    },
    {
        name: 'keeps a shared reference shared',
        check: (codec) => {
            const shared = { v: 1 };
            const back = roundTripWith(codec, { a: shared, b: shared, list: [shared] }) as {
                a: object;
                b: object;
                list: object[];
            };
            expect(back.a).toBe(back.b);
            expect(back.list[0]).toBe(back.a);
            // Shared, not merely equal: a mutation is visible through both.
            (back.a as { v: number }).v = 2;
            expect((back.b as { v: number }).v).toBe(2);
        },
    },
    {
        name: 'keeps references shared across Map, Set and Date',
        check: (codec) => {
            const shared = { v: 1 };
            const date = new Date(123456);
            const map = new Map<unknown, unknown>([[shared, shared]]);
            const back = roundTripWith(codec, {
                map,
                set: new Set([shared]),
                dates: [date, date],
                again: shared,
            }) as {
                map: Map<unknown, unknown>;
                set: Set<unknown>;
                dates: Date[];
                again: object;
            };
            const [key] = [...back.map.keys()];
            expect(key).toBe(back.again);
            expect(back.map.get(key)).toBe(back.again);
            expect([...back.set][0]).toBe(back.again);
            expect(back.dates[0]).toBe(back.dates[1]);
            expect(back.dates[0].getTime()).toBe(123456);
        },
    },
    {
        name: 'round-trips a DataView',
        check: (codec) => {
            const view = new DataView(new ArrayBuffer(8));
            view.setInt32(0, -7);
            view.setFloat32(4, 0.5);
            const back = roundTripWith(codec, view) as DataView;
            expect(back instanceof DataView).toBe(true);
            expect(back.byteLength).toBe(8);
            expect(back.getInt32(0)).toBe(-7);
            expect(back.getFloat32(4)).toBe(0.5);
        },
    },
    {
        name: 'carries only the DataView window, not its whole buffer',
        check: (codec) => {
            const buffer = new Uint8Array([1, 2, 3, 4, 5, 6]).buffer;
            const back = roundTripWith(codec, new DataView(buffer, 2, 3)) as DataView;
            expect(back.byteLength).toBe(3);
            expect(back.getUint8(0)).toBe(3);
            expect(back.getUint8(2)).toBe(5);
        },
    },
    {
        name: 'round-trips an Error with name, message and stack',
        check: (codec) => {
            const sent = new Error('went wrong');
            const back = roundTripWith(codec, sent) as Error;
            expect(back instanceof Error).toBe(true);
            expect(back.name).toBe('Error');
            expect(back.message).toBe('went wrong');
            expect(typeof back.stack).toBe('string');
            expect((back.stack as string).length > 0).toBe(true);
        },
    },
    {
        name: 'round-trips every interned Error subclass as itself',
        check: (codec) => {
            const sent = [
                new EvalError('eval'),
                new RangeError('range'),
                new ReferenceError('reference'),
                new SyntaxError('syntax'),
                new TypeError('type'),
                new URIError('uri'),
            ];
            const back = roundTripWith(codec, sent) as Error[];
            expect(back[0] instanceof EvalError).toBe(true);
            expect(back[1] instanceof RangeError).toBe(true);
            expect(back[2] instanceof ReferenceError).toBe(true);
            expect(back[3] instanceof SyntaxError).toBe(true);
            expect(back[4] instanceof TypeError).toBe(true);
            expect(back[5] instanceof URIError).toBe(true);
            for (let i = 0; i < sent.length; i++) {
                expect(back[i].name).toBe(sent[i].name);
                expect(back[i].message).toBe(sent[i].message);
            }
        },
    },
    {
        name: 'collapses a non-interned Error subclass to Error',
        check: (codec) => {
            class CustomError extends Error {
                constructor(message: string) {
                    super(message);
                    this.name = 'CustomError';
                }
            }
            const back = roundTripWith(codec, new CustomError('nope')) as Error;
            expect(back instanceof Error).toBe(true);
            expect(back.name).toBe('Error');
            expect(back.message).toBe('nope');
        },
    },
    {
        name: 'keeps a shared Error reference shared',
        check: (codec) => {
            const err = new RangeError('once');
            const back = roundTripWith(codec, { a: err, b: err }) as { a: Error; b: Error };
            expect(back.a).toBe(back.b);
            expect(back.a instanceof RangeError).toBe(true);
        },
    },
    {
        name: 'throws DataCloneError for a function',
        check: (codec) => {
            expectDataCloneError(() => codec.encode(() => 1));
            expectDataCloneError(() => codec.encode({ ok: 1, fn: function named() {} }));
        },
    },
    {
        name: 'throws DataCloneError for a symbol and other non-cloneables',
        check: (codec) => {
            expectDataCloneError(() => codec.encode(Symbol('s')));
            expectDataCloneError(() => codec.encode({ s: Symbol('s') }));
            expectDataCloneError(() => codec.encode(new WeakMap()));
            expectDataCloneError(() => codec.encode(Promise.resolve(1)));
        },
    },
    {
        name: 'escapes a user object carrying its own `__gjsify` key',
        check: (codec) => {
            // Without the escape wrapper the decoder reads this data as a tag
            // and hands back a Date — user data must never reach the switch.
            const back = roundTripWith(codec, { __gjsify: 'Date', value: 0, real: true }) as Record<
                string,
                unknown
            >;
            expect(back instanceof Date).toBe(false);
            expect(back.__gjsify).toBe('Date');
            expect(back.value).toBe(0);
            expect(back.real).toBe(true);
        },
    },
    {
        name: 'round-trips the pre-existing tagged types unchanged',
        check: (codec) => {
            const back = roundTripWith(codec, {
                date: new Date(1000),
                re: /ab+c/gi,
                big: 12345678901234567890n,
                inf: Infinity,
                negInf: -Infinity,
                nan: NaN,
                map: new Map<string, unknown>([['k', [1, 2]]]),
                set: new Set([1, 'two']),
                bytes: new Uint8Array([7, 8]),
            }) as Record<string, any>;
            expect(back.date.getTime()).toBe(1000);
            expect(back.re.source).toBe('ab+c');
            expect(back.re.flags).toBe('gi');
            expect(back.big).toBe(12345678901234567890n);
            expect(back.inf).toBe(Infinity);
            expect(back.negInf).toBe(-Infinity);
            expect(Number.isNaN(back.nan)).toBe(true);
            expect(back.map.get('k')).toStrictEqual([1, 2]);
            expect(back.set.has('two')).toBe(true);
            expect([...back.bytes]).toStrictEqual([7, 8]);
        },
    },
    {
        name: 'round-trips a nested mix of every supported type',
        check: (codec) => {
            const shared = { tag: 'shared' };
            const sent: Record<string, unknown> = {
                nested: { deep: { list: [1, undefined, -0, new Date(5)] } },
                err: new RangeError('deep'),
                dv: new DataView(new Uint8Array([1, 2, 3, 4]).buffer),
                shared,
                alsoShared: [shared],
            };
            sent.root = sent;
            const back = roundTripWith(codec, sent) as Record<string, any>;
            expect(back.root).toBe(back);
            expect(back.nested.deep.list[1]).toBe(undefined);
            expect(Object.is(back.nested.deep.list[2], -0)).toBe(true);
            expect(back.nested.deep.list[3].getTime()).toBe(5);
            expect(back.err instanceof RangeError).toBe(true);
            expect(back.dv.getUint8(3)).toBe(4);
            expect(back.alsoShared[0]).toBe(back.shared);
        },
    },
];

/**
 * Run `fn` with `btoa`/`atob` removed from the global object, then restore
 * them. Deliberately no fall-back for a host that refuses the delete: the
 * sibling SAB suite records what a conditional `expect(true)` costs, and a
 * codec that cannot be stripped of its globals is a result worth failing on.
 */
function withoutBase64Globals(fn: () => void): void {
    const g = globalThis as Record<string, unknown>;
    const savedBtoa = g.btoa;
    const savedAtob = g.atob;
    delete g.btoa;
    delete g.atob;
    try {
        expect(g.btoa).toBe(undefined);
        expect(g.atob).toBe(undefined);
        fn();
    } finally {
        if (savedBtoa !== undefined) g.btoa = savedBtoa;
        if (savedAtob !== undefined) g.atob = savedAtob;
    }
}

export default async () => {
    await describe('structured-clone-wire — binary', async () => {
        await it('round-trips a Uint8Array at every base64 padding length', async () => {
            // 0..5 bytes covers all three padding shapes twice over; a wrong
            // alphabet or a mis-sized output buffer shows up as a length or
            // byte mismatch here rather than three layers up.
            for (let len = 0; len <= 5; len++) {
                const sent = new Uint8Array(len);
                for (let i = 0; i < len; i++) sent[i] = i * 51 + 1;
                const back = roundTrip(sent) as Uint8Array;
                expect(back instanceof Uint8Array).toBe(true);
                expect(back.length).toBe(len);
                expect([...back]).toStrictEqual([...sent]);
            }
        });

        await it('produces standard base64 on the wire', async () => {
            // Pins the alphabet and the padding against a known encoding, so a
            // self-consistent but non-standard codec cannot pass.
            const wire = encode(new TextEncoder().encode('Mankind')) as { data: string };
            expect(wire.data).toBe('TWFua2luZA==');
        });

        await it('round-trips every byte value', async () => {
            const sent = new Uint8Array(256);
            for (let i = 0; i < 256; i++) sent[i] = i;
            const back = roundTrip(sent) as Uint8Array;
            expect([...back]).toStrictEqual([...sent]);
        });

        await it('round-trips an ArrayBuffer', async () => {
            const back = roundTrip(new Uint8Array([9, 8, 7]).buffer) as ArrayBuffer;
            expect(back instanceof ArrayBuffer).toBe(true);
            expect(back.byteLength).toBe(3);
            expect([...new Uint8Array(back)]).toStrictEqual([9, 8, 7]);
        });

        await it('round-trips a Float64Array and a BigInt64Array', async () => {
            const floats = roundTrip(new Float64Array([0.5, -1.25])) as Float64Array;
            expect(floats instanceof Float64Array).toBe(true);
            expect(floats[1]).toBe(-1.25);
            const bigs = roundTrip(new BigInt64Array([1n, -2n])) as BigInt64Array;
            expect(bigs instanceof BigInt64Array).toBe(true);
            expect(bigs[1]).toBe(-2n);
        });

        await it('carries only a view, not the whole backing buffer', async () => {
            const view = new Uint8Array(new Uint8Array([1, 2, 3, 4, 5]).buffer, 1, 3);
            const back = roundTrip(view) as Uint8Array;
            expect(back.length).toBe(3);
            expect([...back]).toStrictEqual([2, 3, 4]);
        });

        await it('encodes and decodes without btoa/atob on the global', async () => {
            const sent = new Uint8Array([0, 1, 127, 128, 255]);
            let back: Uint8Array | undefined;
            withoutBase64Globals(() => {
                back = roundTrip(sent) as Uint8Array;
            });
            expect([...back!]).toStrictEqual([...sent]);
        });
    });

    await describe('structured-clone-wire — structured clone (TS copy)', async () => {
        for (const testCase of CODEC_CASES) {
            await it(testCase.name, async () => {
                testCase.check({ encode, decode });
            });
        }
    });

    await describe('structured-clone-wire — structured clone (bootstrap mirror)', async () => {
        const mirror = extractBootstrapCodec();

        await it('exposes encodeWire/decodeWire between the markers', async () => {
            expect(typeof mirror.encode).toBe('function');
            expect(typeof mirror.decode).toBe('function');
        });

        for (const testCase of CODEC_CASES) {
            await it(testCase.name, async () => {
                testCase.check(mirror);
            });
        }
    });
};
