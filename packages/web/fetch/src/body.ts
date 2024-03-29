
/**
 * Body.js
 *
 * Body interface provides common methods for Request and Response
 */

import { URLSearchParams } from '@gjsify/deno-runtime/ext/url/00_url';
import { Blob } from "@gjsify/deno-runtime/ext/web/09_file";

import { PassThrough, pipeline as pipelineCb, Readable, Stream, Writable } from 'stream';
import { ReadableStream as StreamWebReadableStream } from "stream/web";
import { types, deprecate, promisify } from 'util';
import { Buffer } from 'buffer';

import { FormData, formDataToBlob } from 'formdata-polyfill/esm.min.js';

import { FetchError } from './errors/fetch-error.js';
import { FetchBaseError } from './errors/base.js';
import { isBlob, isURLSearchParameters } from './utils/is.js';

import type { Request } from './request.js';
import type { Response } from './response.js';

const pipeline = promisify(pipelineCb);
const INTERNALS = Symbol('Body internals');
 
 /**
  * Body mixin
  *
  * Ref: https://fetch.spec.whatwg.org/#body
  *
  * @param body Readable stream
  * @param opts Response options
  */
export default class Body implements globalThis.Body {

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

    constructor(body: BodyInit | Readable | Blob | Buffer, options: ResponseInit & { size?: number } = { size: 0 }) {
        this.size = options.size || 0;
        if (body === null) {
            // Body is undefined or null
            this[INTERNALS].body = null;
        } else if (isURLSearchParameters(body)) {
            // Body is a URLSearchParams
            this[INTERNALS].body = Buffer.from(body.toString())
        } else if (isBlob(body)) {
            // Body is blob
        } else if (Buffer.isBuffer(body)) {
            // Body is Buffer
        } else if (types.isAnyArrayBuffer(body)) {
            // Body is ArrayBuffer
            this[INTERNALS].body = Buffer.from(body);
        } else if (ArrayBuffer.isView(body)) {
            // Body is ArrayBufferView
            this[INTERNALS].body = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
        } else if (body instanceof Readable) {
            // Body is stream
            this[INTERNALS].body = body;
        } else if (body instanceof ReadableStream || body instanceof StreamWebReadableStream) {
            // Body is web stream
            this[INTERNALS].body = Readable.fromWeb(body as StreamWebReadableStream); // TODO check compatibility between ReadableStream (from lib.dom.d.ts) and StreamWebReadableStream (from stream/web)
        } else if (body instanceof FormData) {
            // Body is FormData
            this[INTERNALS].body = formDataToBlob(body) as Blob & globalThis.Blob;
            this[INTERNALS].boundary = this[INTERNALS].body.type.split('=')[1];
        } else if (typeof body === 'string'){
            // None of the above
            // coerce to string then buffer
            this[INTERNALS].body = Buffer.from(body);
        } else if (body instanceof URLSearchParams){
            // None of the above
            // coerce to string then buffer
            this[INTERNALS].body = Buffer.from(body.toString());
        } else {
            console.warn(`Unknown body type "${typeof body}", try to parse the body to string!`);
            this[INTERNALS].body = Readable.from(typeof (body as any).toString === 'function' ? (body as any).toString() : body as any); // TODO
        }

        // ´this[INTERNALS].stream = body;

        if (Buffer.isBuffer(body)) {
            this[INTERNALS].stream = Readable.from(body);
        } else if (isBlob(body)) {
            // @ts-ignore
            this[INTERNALS].stream = Readable.from(body.stream());
        } else if (body instanceof Readable) {
            this[INTERNALS].stream = body;
        }

        if (body instanceof Stream) {
            body.on('error', error_ => {
                const error = error_ instanceof FetchBaseError ?
                    error_ :
                    new FetchError(`Invalid response body while trying to fetch ${(this as any).url}: ${error_.message}`, 'system', error_ as any);
                this[INTERNALS].error = error;
            });
        }
    }

    get body(): ReadableStream<Uint8Array> {
        // @ts-ignore
        return Readable.toWeb(this[INTERNALS].stream);
    }

    get _stream() {
        return this[INTERNALS].stream;
    }

    get bodyUsed() {
        return this[INTERNALS].disturbed;
    }

    /**
     * Decode response as ArrayBuffer
     *
     * @return  Promise
     */
    async arrayBuffer() {
        const {buffer, byteOffset, byteLength} = await consumeBody(this);
        return buffer.slice(byteOffset, byteOffset + byteLength);
    }

    async formData() {
        const ct = (this as unknown as Request).headers?.get('content-type');

        if (ct.startsWith('application/x-www-form-urlencoded')) {
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
     *
     * @return Promise
     */
    // @ts-ignore
    async blob() {
        const ct = ((this as unknown as Request).headers?.get('content-type')) || (this[INTERNALS].body && (this[INTERNALS].body as Blob).type) || '';
        const buf = await this.arrayBuffer();

        return new Blob([buf], {
            type: ct
        });
    }

    /**
     * Decode response as json
     *
     * @return  Promise
     */
    async json() {
        const text = await this.text();
        return JSON.parse(text);
    }

    /**
     * Decode response as text
     *
     * @return  Promise
     */
    async text() {
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
    data: {get: deprecate(() => {},
        'data doesn\'t exist, use json(), text(), arrayBuffer(), or body instead',
        'https://github.com/node-fetch/node-fetch/issues/1000 (response)')}
 });
 
 /**
  * Consume and convert an entire Body to a Buffer.
  *
  * Ref: https://fetch.spec.whatwg.org/#concept-body-consume-body
  *
  * @return Promise
  */
async function consumeBody(data: Body & Partial<Request>) {
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

    /* c8 ignore next 3 */
    if (!(body instanceof Stream)) {
        return Buffer.alloc(0);
    }

    // Body is stream
    // get ready to actually consume the body
    const accum = [];
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
    } catch (error) {
        const error_ = error instanceof FetchBaseError ? error : new FetchError(`Invalid response body while trying to fetch ${data.url}: ${error.message}`, 'system', error);
        throw error_;
    }

    if (body.readableEnded === true || (body as any)._readableState.ended === true) {
        try {
            if (accum.every(c => typeof c === 'string')) {
                return Buffer.from(accum.join(''));
            }

            return Buffer.concat(accum, accumBytes);
        } catch (error) {
            throw new FetchError(`Could not create Buffer from response body for ${data.url}: ${error.message}`, 'system', error);
        }
    } else {
        throw new FetchError(`Premature close of server response while trying to fetch ${data.url}`);
    }
}
 
 /**
  * Clone body given Res/Req instance
  *
  * @param Mixed instance       Response or Request instance
  * @param highWaterMark highWaterMark for both PassThrough body streams
  * @return Mixed
  */
export const clone = <T extends Request | Response>(instance: T, highWaterMark?: number) => {
    let p1: PassThrough;
    let p2: PassThrough;
    let {body} = instance[INTERNALS];

    // Don't allow cloning a used body
    if (instance.bodyUsed) {
        throw new Error('cannot clone body after it is used');
    }

    // Check that body is a stream and not form-data object
    // note: we can't clone the form-data object without having it as a dependency
    if ((body instanceof Stream) && (typeof (body as any).getBoundary !== 'function')) {
        // Tee instance body
        p1 = new PassThrough({highWaterMark});
        p2 = new PassThrough({highWaterMark});
        body.pipe(p1);
        body.pipe(p2);
        // Set instance body to teed body and return the other teed body
        instance[INTERNALS].stream = p1;
        body = p2;
    }
 
    return body;
 };
 
// const getNonSpecFormDataBoundary = deprecate(
//     (body) => body.getBoundary(),
//     'form-data doesn\'t follow the spec and requires special treatment. Use alternative package',
//     'https://github.com/node-fetch/node-fetch/issues/1167'
// );
 
 /**
  * Performs the operation "extract a `Content-Type` value from |object|" as
  * specified in the specification:
  * https://fetch.spec.whatwg.org/#concept-bodyinit-extract
  *
  * This function assumes that instance.body is present.
  *
  * @param body Any options.body input
  */
export const extractContentType = (body: BodyInit | string | ArrayBuffer | Readable | Blob | ArrayBufferView | Buffer | FormData | globalThis.ReadableStream<any> | null, request: Request | Response): string | null => {
    // Body is null or undefined
    if (body === null) {
        return null;
    }

    // Body is string
    if (typeof body === 'string') {
        return 'text/plain;charset=UTF-8';
    }

    // Body is a URLSearchParams
    if (isURLSearchParameters(body)) {
        return 'application/x-www-form-urlencoded;charset=UTF-8';
    }

    // Body is blob
    if (isBlob(body)) {
        return (body as Blob & globalThis.Blob).type || null;
    }

    // Body is a Buffer (Buffer, ArrayBuffer or ArrayBufferView)
    if (Buffer.isBuffer(body) || types.isAnyArrayBuffer(body) || ArrayBuffer.isView(body)) {
        return null;
    }

    if (body instanceof FormData) {
        return `multipart/form-data; boundary=${request[INTERNALS].boundary}`;
    }

    // Detect form data input from form-data module
    // if (body && typeof body.getBoundary === 'function') {
    //     return `multipart/form-data;boundary=${getNonSpecFormDataBoundary(body)}`;
    // }

    // Body is stream - can't really do much about this
    if (body instanceof Stream) {
        return null;
    }

    // Body constructor defaults other things to string
    return 'text/plain;charset=UTF-8';
};
 
 /**
  * The Fetch Standard treats this as if "total bytes" is a property on the body.
  * For us, we have to explicitly get it with a function.
  *
  * ref: https://fetch.spec.whatwg.org/#concept-body-total-bytes
  *
  * @param request Request object with the body property.
  */
export const getTotalBytes = (request: Request): number | null => {
    const { body } = request[INTERNALS];

    // Body is null or undefined
    if (body === null) {
        return 0;
    }

    // Body is Blob
    if (isBlob(body)) {
        return (body as Blob).size;
    }

    // Body is Buffer
    if (Buffer.isBuffer(body)) {
        return body.length;
    }

    // Detect form data input from form-data module
    if (body && typeof (body as any).getLengthSync === 'function') {
        const anyBody = body as any;
        return anyBody.hasKnownLength && anyBody.hasKnownLength() ? anyBody.getLengthSync() : null;
    }

    // Body is stream
    return null;
};
 
 /**
  * Write a Body to a Node.js WritableStream (e.g. http.Request) object.
  *
  * @param dest The stream to write to.
  * @param obj.body Body object from the Body instance.
  */
 export const writeToStream = async (dest: Writable, {body}): Promise<void> => {
    if (body === null) {
        // Body is null
        dest.end();
    } else {
        // Body is stream
        await pipeline(body, dest);
    }
 };
 