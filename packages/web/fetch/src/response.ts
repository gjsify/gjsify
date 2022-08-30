/**
 * Response.js
 *
 * Response class provides content decoding
 */

 import Gio from '@gjsify/types/Gio-2.0';

import Headers from './headers.js';
import Body, { clone, extractContentType } from './body.js';
import { isRedirect } from './utils/is-redirect.js';
import type { Readable } from 'node:stream';

const INTERNALS = Symbol('Response internals');

interface GjsifyResponseInit extends ResponseInit {
    type?: ResponseType;
    url?: string;
    counter?: number;
    highWaterMark?: number;
    ok?: boolean;
    redirected?: boolean;
    size?: number;
}

/**
 * Response class
 *
 * Ref: https://fetch.spec.whatwg.org/#response-class
 *
 * @param body Readable stream
 * @param opts Response options
 */
export class GjsifyResponse extends Body implements Response {

    [INTERNALS]: {
        type: ResponseType;
        url: string;
        status: number;
        statusText: string;
        headers: Headers;
        counter: number;
        highWaterMark: number;
    };

    constructor(body: BodyInit | Readable | Blob | Buffer | null = null, options: GjsifyResponseInit = {}) {
        super(body, options);

        // eslint-disable-next-line no-eq-null, eqeqeq, no-negated-condition
        const status = options.status != null ? options.status : 200;

        const headers = new Headers(options.headers);

        if (body !== null && !headers.has('Content-Type')) {
            const contentType = extractContentType(body, this);
            if (contentType) {
                headers.append('Content-Type', contentType);
            }
        }

        this[INTERNALS] = {
            type: 'default',
            url: options.url,
            status,
            statusText: options.statusText || '',
            headers,
            counter: options.counter,
            highWaterMark: options.highWaterMark
        };
    }

    get type() {
        return this[INTERNALS].type;
    }

    get url() {
        return this[INTERNALS].url || '';
    }

    get status() {
        return this[INTERNALS].status;
    }

    /**
     * Convenience property representing if the request ended normally
     */
    get ok() {
        return this[INTERNALS].status >= 200 && this[INTERNALS].status < 300;
    }

    get redirected() {
        return this[INTERNALS].counter > 0;
    }

    get statusText() {
        return this[INTERNALS].statusText;
    }

    get headers() {
        return this[INTERNALS].headers;
    }

    get highWaterMark() {
        return this[INTERNALS].highWaterMark;
    }

    /**
     * Clone this response
     *
     * @return  Response
     */
    clone() {
        return new GjsifyResponse(clone(this, this.highWaterMark), {
            type: this.type,
            url: this.url,
            status: this.status,
            statusText: this.statusText,
            headers: this.headers,
            ok: this.ok,
            redirected: this.redirected,
            size: this.size,
            highWaterMark: this.highWaterMark
        });
    }

    /**
     * @param url The URL that the new response is to originate from.
     * @param status An optional status code for the response (e.g., 302.)
     * @returns A Response object.
     */
    static redirect(url: string, status = 302) {
        if (!isRedirect(status)) {
            throw new RangeError('Failed to execute "redirect" on "response": Invalid status code');
        }

        return new GjsifyResponse(null, {
            headers: {
                location: new URL(url).toString()
            },
            status
        });
    }

    static error() {
        const response = new GjsifyResponse(null, { status: 0, statusText: '' });
        response[INTERNALS].type = 'error';
        return response;
    }

    get [Symbol.toStringTag]() {
        return 'Response';
    }

    async text(): Promise<string> {
        if (!this._inputStream) {
          return super.text();
        }
    
        const outputStream = Gio.MemoryOutputStream.new_resizable();
    
        await new Promise<number>((resolve, reject) => {
          outputStream.splice_async(this._inputStream, Gio.OutputStreamSpliceFlags.CLOSE_TARGET | Gio.OutputStreamSpliceFlags.CLOSE_SOURCE, GLib.PRIORITY_DEFAULT, null, (self, res) => {
            try {
              resolve(outputStream.splice_finish(res));
            } catch (error) {
              reject(error);
            }
          });
        });
    
    
        const bytes = outputStream.steal_as_bytes();
    
        return new TextDecoder().decode((bytes as any).toArray()); // TODO ts-for-gir: Add toArray method
      }
}

Object.defineProperties(Response.prototype, {
    type: { enumerable: true },
    url: { enumerable: true },
    status: { enumerable: true },
    ok: { enumerable: true },
    redirected: { enumerable: true },
    statusText: { enumerable: true },
    headers: { enumerable: true },
    clone: { enumerable: true }
});

export default GjsifyResponse;