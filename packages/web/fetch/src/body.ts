// SPDX-License-Identifier: MIT
// Adapted from node-fetch (https://github.com/node-fetch/node-fetch/blob/main/src/body.js)
// Copyright (c) node-fetch contributors. MIT license.
// Modifications: Rewritten for GJS using libsoup 3.0 and @gjsify/url

import { URLSearchParams } from '@gjsify/url';
import { Blob } from './utils/blob-from.js';

import { PassThrough, pipeline as pipelineCb, Readable, Stream, Writable } from 'node:stream';
import { Buffer } from 'node:buffer';

import { FormData, formDataToBlob } from '@gjsify/formdata';

import { FetchError } from './errors/fetch-error.js';
import { FetchBaseError } from './errors/base.js';
import { isBlob, isURLSearchParameters } from './utils/is.js';

import type { Request } from './request.js';
import type { Response } from './response.js';
import type { SystemError } from './types/index.js';

const pipeline = (source: Readable, dest: Writable): Promise<void> =>
    new Promise((resolve, reject) => {
        pipelineCb(source, dest, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });

const INTERNALS = Symbol('Body internals');

function isAnyArrayBuffer(val: unknown): val is ArrayBuffer {
    return val instanceof ArrayBuffer ||
        (typeof SharedArrayBuffer !== 'undefined' && val instanceof SharedArrayBuffer);
}

function isBoxedPrimitive(val: unknown): boolean {
    return (
        val instanceof String ||
        val instanceof Number ||
        val instanceof Boolean ||
        (typeof Symbol !== 'undefined' && val instanceof Symbol) ||
        (typeof BigInt !== 'undefined' && val instanceof (BigInt as unknown as typeof Number))
    );
}

 /**
  * Body mixin
  *
  * Ref: https://fetch.spec.whatwg.org/#body
  *
  * @param body Readable stream
  * @param opts Response options
  */
export default class Body {

    [INTERNALS]: {
        body: null | Buffer | Readable | Blob;
        stream: Readable | null;
        boundary: string;
        disturbed: boolean,
        error: null | FetchBaseError;
    } = {
        body: null,
        stream: null,
        boundary: '',
        disturbed: false,
        error: null,
    }

    size = 0;

    constructor(body: BodyInit | Readable | Blob | Buffer | null, options: { size?: number; headers?: unknown } = { size: 0 }) {
        this.size = options.size || 0;
        if (body === null || body === undefined) {
            // Body is undefined or null
            this[INTERNALS].body = null;
        } else if (isURLSearchParameters(body)) {
            // Body is a URLSearchParams
            this[INTERNALS].body = Buffer.from(body.toString())
        } else if (isBlob(body)) {
            // Body is blob
            this[INTERNALS].body = body as Blob;
        } else if (Buffer.isBuffer(body)) {
            // Body is Buffer
            this[INTERNALS].body = body;
        } else if (isAnyArrayBuffer(body)) {
            // Body is ArrayBuffer
            this[INTERNALS].body = Buffer.from(body);
        } else if (ArrayBuffer.isView(body)) {
            // Body is ArrayBufferView
            this[INTERNALS].body = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
        } else if (body instanceof Readable) {
            // Body is Node.js stream
            this[INTERNALS].body = body;
        } else if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
            // Body is Web ReadableStream — convert to Node.js Readable
            this[INTERNALS].body = readableStreamToReadable(body);
        } else if (body instanceof FormData) {
            // Body is FormData
            const blob = formDataToBlob(body) as Blob & globalThis.Blob;
            this[INTERNALS].body = blob;
            this[INTERNALS].boundary = blob.type?.split('boundary=')?.[1] ?? '';
        } else if (typeof body === 'string'){
            // String body
            this[INTERNALS].body = Buffer.from(body);
        } else if (body instanceof URLSearchParams){
            this[INTERNALS].body = Buffer.from(body.toString());
        } else {
            console.warn(`Unknown body type "${typeof body}", try to parse the body to string!`);
            this[INTERNALS].body = Buffer.from(String(body));
        }

        // Set up the internal stream
        const b = this[INTERNALS].body;
        if (Buffer.isBuffer(b)) {
            this[INTERNALS].stream = Readable.from(b);
        } else if (isBlob(b)) {
            this[INTERNALS].stream = Readable.from(blobToAsyncIterable(b as Blob));
        } else if (b instanceof Readable) {
            this[INTERNALS].stream = b;
        }

        if (b instanceof Stream) {
            b.on('error', (error_: Error) => {
                const error = error_ instanceof FetchBaseError
                    ? error_
                    : new FetchError(`Invalid response body while trying to fetch ${(this as unknown as Request).url}: ${error_.message}`, 'system', error_ as unknown as SystemError);
                this[INTERNALS].error = error;
            });
        }
    }

    get body(): ReadableStream<Uint8Array> | null {
        const stream = this[INTERNALS].stream;
        if (!stream) return null;

        // If ReadableStream is available, wrap the Readable into one
        if (typeof ReadableStream !== 'undefined') {
            return new ReadableStream<Uint8Array>({
                start(controller) {
                    stream.on('data', (chunk: Buffer | Uint8Array) => {
                        controller.enqueue(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
                    });
                    stream.on('end', () => {
                        controller.close();
                    });
                    stream.on('error', (err: Error) => {
                        controller.error(err);
                    });
                },
                cancel() {
                    stream.destroy();
                }
            });
        }

        return null;
    }

    get _stream() {
        return this[INTERNALS].stream;
    }

    get bodyUsed() {
        return this[INTERNALS].disturbed;
    }

    /**
     * Decode response as ArrayBuffer
     */
    async arrayBuffer(): Promise<ArrayBuffer> {
        const {buffer, byteOffset, byteLength} = await consumeBody(this);
        return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
    }

    async formData(): Promise<FormData> {
        const ct = (this as unknown as Request).headers?.get('content-type');

        if (ct?.startsWith('application/x-www-form-urlencoded')) {
            const formData = new FormData();
            const parameters = new URLSearchParams(await this.text());

            for (const [name, value] of parameters) {
                formData.append(name, value);
            }

            return formData;
        }

        const {toFormData} = await import('./utils/multipart-parser.js');
        return toFormData(this.body, ct);
    }

    /**
     * Return raw response as Blob
     */
    async blob(): Promise<Blob> {
        const ct = ((this as unknown as Request).headers?.get('content-type')) || (this[INTERNALS].body && (this[INTERNALS].body as Blob).type) || '';
        const buf = await this.arrayBuffer();

        return new Blob([buf], {
            type: ct
        });
    }

    /**
     * Decode response as json
     */
    async json(): Promise<unknown> {
        const text = await this.text();
        return JSON.parse(text);
    }

    /**
     * Decode response as text
     */
    async text(): Promise<string> {
        const buffer = await consumeBody(this);
        return new TextDecoder().decode(buffer);
    }
}

// In browsers, all properties are enumerable.
Object.defineProperties(Body.prototype, {
    body: {enumerable: true},
    bodyUsed: {enumerable: true},
    arrayBuffer: {enumerable: true},
    blob: {enumerable: true},
    json: {enumerable: true},
    text: {enumerable: true},
});

/**
 * Consume and convert an entire Body to a Buffer.
 */
async function consumeBody(data: Body & { url?: string }): Promise<Buffer> {
    if (data[INTERNALS].disturbed) {
        throw new TypeError(`body used already for: ${data.url}`);
    }

    data[INTERNALS].disturbed = true;

    if (data[INTERNALS].error) {
        throw data[INTERNALS].error;
    }

    const { _stream: body } = data;

    // Body is null
    if (body === null) {
        return Buffer.alloc(0);
    }

    if (!(body instanceof Stream)) {
        return Buffer.alloc(0);
    }

    // Body is stream — consume it
    const accum: (Buffer | Uint8Array)[] = [];
    let accumBytes = 0;

    try {
        for await (const chunk of body) {
            if (data.size > 0 && accumBytes + chunk.length > data.size) {
                const error = new FetchError(`content size at ${data.url} over limit: ${data.size}`, 'max-size');
                body.destroy(error);
                throw error;
            }

            accumBytes += chunk.length;
            accum.push(chunk);
        }
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        const error_ = error instanceof FetchBaseError ? error : new FetchError(`Invalid response body while trying to fetch ${data.url}: ${err.message}`, 'system', err as unknown as SystemError);
        throw error_;
    }

    try {
        if (accum.every(c => typeof c === 'string')) {
            return Buffer.from((accum as unknown as string[]).join(''));
        }

        return Buffer.concat(accum as Buffer[], accumBytes);
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        throw new FetchError(`Could not create Buffer from response body for ${data.url}: ${err.message}`, 'system', err as unknown as SystemError);
    }
}

/**
 * Clone body given Res/Req instance
 */
export const clone = <T extends Request | Response>(instance: T, highWaterMark?: number) => {
    let p1: PassThrough;
    let p2: PassThrough;
    let {body} = instance[INTERNALS];

    if (instance.bodyUsed) {
        throw new Error('cannot clone body after it is used');
    }

    if ((body instanceof Stream) && (typeof (body as unknown as Record<string, unknown>).getBoundary !== 'function')) {
        p1 = new PassThrough({highWaterMark});
        p2 = new PassThrough({highWaterMark});
        body.pipe(p1);
        body.pipe(p2);
        instance[INTERNALS].stream = p1;
        body = p2;
    }

    return body;
};

/**
 * Extract a Content-Type value from a body.
 */
export const extractContentType = (body: BodyInit | Readable | Blob | Buffer | null, request: Request | Response): string | null => {
    if (body === null) {
        return null;
    }

    if (typeof body === 'string') {
        return 'text/plain;charset=UTF-8';
    }

    if (isURLSearchParameters(body)) {
        return 'application/x-www-form-urlencoded;charset=UTF-8';
    }

    if (isBlob(body)) {
        return (body as Blob & globalThis.Blob).type || null;
    }

    if (Buffer.isBuffer(body) || isAnyArrayBuffer(body) || ArrayBuffer.isView(body)) {
        return null;
    }

    if (body instanceof FormData) {
        return `multipart/form-data; boundary=${request[INTERNALS].boundary}`;
    }

    if (body instanceof Stream) {
        return null;
    }

    return 'text/plain;charset=UTF-8';
};

/**
 * Get total bytes of a body.
 */
export const getTotalBytes = (request: Request): number | null => {
    const { body } = request[INTERNALS];

    if (body === null) {
        return 0;
    }

    if (isBlob(body)) {
        return (body as Blob).size;
    }

    if (Buffer.isBuffer(body)) {
        return body.length;
    }

    if (body && typeof (body as unknown as Record<string, unknown>).getLengthSync === 'function') {
        const streamBody = body as unknown as { getLengthSync(): number; hasKnownLength?(): boolean };
        return streamBody.hasKnownLength && streamBody.hasKnownLength() ? streamBody.getLengthSync() : null;
    }

    return null;
};

/**
 * Write a Body to a Node.js WritableStream.
 */
export const writeToStream = async (dest: Writable, {body}: {body: Readable | null}): Promise<void> => {
    if (body === null) {
        dest.end();
    } else {
        await pipeline(body, dest);
    }
};

/**
 * Convert a Web ReadableStream to a Node.js Readable.
 */
function readableStreamToReadable(webStream: ReadableStream): Readable {
    const reader = webStream.getReader();
    return new Readable({
        async read() {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    this.push(null);
                } else {
                    this.push(Buffer.from(value));
                }
            } catch (err) {
                this.destroy(err as Error);
            }
        },
        destroy(_err, callback) {
            reader.cancel().then(() => callback(null), callback);
        }
    });
}

/**
 * Convert a Blob to an async iterable for Readable.from().
 */
async function* blobToAsyncIterable(blob: Blob): AsyncIterable<Uint8Array> {
    if (typeof blob.stream === 'function') {
        const reader = (blob.stream() as unknown as ReadableStream).getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            yield value;
        }
    } else {
        // Fallback: read the entire blob at once
        yield new Uint8Array(await blob.arrayBuffer());
    }
}
