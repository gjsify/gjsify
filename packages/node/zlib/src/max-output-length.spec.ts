// `maxOutputLength` — Node's zip-bomb guard on the convenience API.
//
// Expected values measured on Node 24: a decoder whose output would exceed the
// limit throws `RangeError` `ERR_BUFFER_TOO_LARGE` ("Cannot create a Buffer
// larger than N bytes"), output of exactly N bytes passes, and a bad limit is
// `ERR_OUT_OF_RANGE` / `ERR_INVALID_ARG_TYPE` before any work is scheduled.

import { describe, it, expect } from '@gjsify/unit';
import zlib, {
    deflate,
    deflateRawSync,
    deflateSync,
    gunzip,
    gunzipSync,
    gzipSync,
    inflate,
    inflateRaw,
    inflateRawSync,
    inflateSync,
    unzip,
    unzipSync,
    createInflate,
} from 'node:zlib';
import type { ZlibOptions } from 'node:zlib';
import { Buffer } from 'node:buffer';

type CodedError = Error & { code?: string };

const SIZE = 5000;
const plain = Buffer.alloc(SIZE, 0x61);

function catchError(fn: () => unknown): CodedError {
    try {
        fn();
    } catch (err) {
        return err as CodedError;
    }
    throw new Error('expected a throw');
}

function expectTooLarge(err: CodedError | null, limit: number): void {
    expect(err instanceof RangeError).toBe(true);
    expect(err?.code).toBe('ERR_BUFFER_TOO_LARGE');
    expect(err?.message).toBe(`Cannot create a Buffer larger than ${limit} bytes`);
}

type AsyncCodec = (data: Buffer, options: ZlibOptions, cb: (err: Error | null, result: Buffer) => void) => void;

function runAsync(
    codec: AsyncCodec,
    data: Buffer,
    options: ZlibOptions,
): Promise<{ err: CodedError | null; result?: Buffer }> {
    return new Promise((resolve) => {
        codec(data, options, (err, result) => resolve({ err: err as CodedError | null, result }));
    });
}

export default async () => {
    const syncDecoders: [string, (o: ZlibOptions) => Uint8Array][] = [
        ['inflateSync', (o) => inflateSync(deflateSync(plain), o)],
        ['inflateRawSync', (o) => inflateRawSync(deflateRawSync(plain), o)],
        ['gunzipSync', (o) => gunzipSync(gzipSync(plain), o)],
        ['unzipSync (gzip)', (o) => unzipSync(gzipSync(plain), o)],
        ['unzipSync (deflate)', (o) => unzipSync(deflateSync(plain), o)],
    ];

    await describe('zlib maxOutputLength: sync decoders', async () => {
        for (const [name, decode] of syncDecoders) {
            await it(`${name} throws ERR_BUFFER_TOO_LARGE one byte over the limit`, async () => {
                expectTooLarge(
                    catchError(() => decode({ maxOutputLength: SIZE - 1 })),
                    SIZE - 1,
                );
            });

            await it(`${name} returns output of exactly the limit`, async () => {
                expect(decode({ maxOutputLength: SIZE }).length).toBe(SIZE);
            });
        }

        await it('stops a small input that expands far past the limit', async () => {
            const bomb = deflateSync(Buffer.alloc(4 * 1024 * 1024));
            expectTooLarge(
                catchError(() => inflateSync(bomb, { maxOutputLength: 1024 })),
                1024,
            );
        });

        await it('counts the output of every gzip member against one limit', async () => {
            const multi = Buffer.concat([gzipSync(Buffer.alloc(600, 1)), gzipSync(Buffer.alloc(600, 2))]);
            expectTooLarge(
                catchError(() => gunzipSync(multi, { maxOutputLength: 1000 })),
                1000,
            );
            expect(gunzipSync(multi, { maxOutputLength: 1200 }).length).toBe(1200);
        });

        await it('accepts a fractional limit and allows its integer part', async () => {
            const small = deflateSync('ab');
            expectTooLarge(
                catchError(() => inflateSync(small, { maxOutputLength: 1.5 })),
                1.5,
            );
            expect(inflateSync(small, { maxOutputLength: 2.5 }).length).toBe(2);
        });

        await it('applies to the compressors as well', async () => {
            expectTooLarge(
                catchError(() => deflateSync(plain, { maxOutputLength: 5 })),
                5,
            );
            expectTooLarge(
                catchError(() => gzipSync(plain, { maxOutputLength: 5 })),
                5,
            );
        });

        await it('passes empty output with the smallest limit', async () => {
            expect(inflateSync(deflateSync(Buffer.alloc(0)), { maxOutputLength: 1 }).length).toBe(0);
        });
    });

    await describe('zlib maxOutputLength: callback API', async () => {
        const asyncDecoders: [string, AsyncCodec, Buffer][] = [
            ['inflate', inflate as AsyncCodec, deflateSync(plain)],
            ['inflateRaw', inflateRaw as AsyncCodec, deflateRawSync(plain)],
            ['gunzip', gunzip as AsyncCodec, gzipSync(plain)],
            ['unzip', unzip as AsyncCodec, gzipSync(plain)],
        ];

        for (const [name, codec, input] of asyncDecoders) {
            await it(`${name} passes ERR_BUFFER_TOO_LARGE to the callback`, async () => {
                const { err } = await runAsync(codec, input, { maxOutputLength: SIZE - 1 });
                expectTooLarge(err, SIZE - 1);
            });

            await it(`${name} returns output of exactly the limit`, async () => {
                const { err, result } = await runAsync(codec, input, { maxOutputLength: SIZE });
                expect(err).toBeNull();
                expect(result?.length).toBe(SIZE);
            });
        }

        // On GJS the Web path is the compression-streams polyfill, which inflates the
        // whole body before anything is counted; a limit must keep the decode bounded.
        const bombPlain = Buffer.alloc(4 * 1024 * 1024);
        const bombs: [string, AsyncCodec, Buffer][] = [
            ['inflate', inflate as AsyncCodec, deflateSync(bombPlain)],
            ['inflateRaw', inflateRaw as AsyncCodec, deflateRawSync(bombPlain)],
            ['gunzip', gunzip as AsyncCodec, gzipSync(bombPlain)],
            ['unzip', unzip as AsyncCodec, gzipSync(bombPlain)],
        ];
        for (const [name, codec, bomb] of bombs) {
            await it(`${name} stops a small input that expands far past the limit`, async () => {
                const { err } = await runAsync(codec, bomb, { maxOutputLength: 1024 });
                expectTooLarge(err, 1024);
            });
        }

        await it('deflate passes ERR_BUFFER_TOO_LARGE to the callback', async () => {
            const { err } = await runAsync(deflate as AsyncCodec, plain, { maxOutputLength: 5 });
            expectTooLarge(err, 5);
        });

        await it('throws a bad limit synchronously instead of calling back', async () => {
            const err = catchError(() => inflate(deflateSync(plain), { maxOutputLength: 0 }, () => {}));
            expect(err.code).toBe('ERR_OUT_OF_RANGE');
        });
    });

    await describe('zlib maxOutputLength: option validation', async () => {
        const input = deflateSync('abc');
        const max = Number.MAX_SAFE_INTEGER;

        await it('rejects values below 1, including -0', async () => {
            for (const [value, shown] of [
                [0, '0'],
                [-1, '-1'],
                [-0, '-0'],
            ] as const) {
                const err = catchError(() => inflateSync(input, { maxOutputLength: value }));
                expect(err instanceof RangeError).toBe(true);
                expect(err.code).toBe('ERR_OUT_OF_RANGE');
                expect(err.message).toBe(
                    `The value of "options.maxOutputLength" is out of range. It must be >= 1 and <= ${max}. Received ${shown}`,
                );
            }
        });

        await it('rejects values above the maximum with a separated number', async () => {
            const err = catchError(() => inflateSync(input, { maxOutputLength: 2 ** 53 }));
            expect(err.code).toBe('ERR_OUT_OF_RANGE');
            expect(err.message).toBe(
                `The value of "options.maxOutputLength" is out of range. It must be >= 1 and <= ${max}. Received 9_007_199_254_740_992`,
            );
        });

        await it('rejects Infinity as not finite', async () => {
            const err = catchError(() => inflateSync(input, { maxOutputLength: Infinity }));
            expect(err.code).toBe('ERR_OUT_OF_RANGE');
            expect(err.message).toBe(
                'The value of "options.maxOutputLength" is out of range. It must be a finite number. Received Infinity',
            );
        });

        await it('rejects non-numbers with ERR_INVALID_ARG_TYPE', async () => {
            for (const [value, shown] of [
                ['a', "type string ('a')"],
                [true, 'type boolean (true)'],
                [null, 'null'],
            ] as const) {
                const err = catchError(() => inflateSync(input, { maxOutputLength: value as unknown as number }));
                expect(err instanceof TypeError).toBe(true);
                expect(err.code).toBe('ERR_INVALID_ARG_TYPE');
                expect(err.message).toBe(
                    `The "options.maxOutputLength" property must be of type number. Received ${shown}`,
                );
            }
        });

        await it('treats NaN and undefined as the default', async () => {
            expect(inflateSync(input, { maxOutputLength: NaN }).length).toBe(3);
            expect(inflateSync(input, { maxOutputLength: undefined }).length).toBe(3);
        });

        await it('validates the option on stream construction', async () => {
            expect(catchError(() => createInflate({ maxOutputLength: 0 })).code).toBe('ERR_OUT_OF_RANGE');
        });

        // Node applies the limit only in the convenience API; a stream emits
        // everything. Asserted so the two do not drift apart.
        await it('does not enforce the limit on a stream', async () => {
            const stream = createInflate({ maxOutputLength: 10 });
            const total = await new Promise<number>((resolve, reject) => {
                let n = 0;
                stream.on('data', (c: Buffer) => (n += c.length));
                stream.on('end', () => resolve(n));
                stream.on('error', reject);
                stream.end(deflateSync(plain));
            });
            expect(total).toBe(SIZE);
        });

        await it('exposes unzip and unzipSync on the default export', async () => {
            expect(typeof zlib.unzip).toBe('function');
            expect(typeof zlib.unzipSync).toBe('function');
        });
    });
};
