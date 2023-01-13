/**
 * Headers.js
 *
 * Headers class offers convenient helpers
 */
import { types } from 'util';
import * as http from 'http';
import type { IncomingMessage } from 'http';
import Soup from '@gjsify/types/Soup-3.0';

import { URLSearchParams } from '@gjsify/deno-runtime/ext/url/00_url';


/* c8 ignore next 9 */

const validateHeaderName = http.validateHeaderName;
const validateHeaderValue = http.validateHeaderValue;

/**
 * This Fetch API interface allows you to perform various actions on HTTP request and response headers.
 * These actions include retrieving, setting, adding to, and removing.
 * A Headers object has an associated header list, which is initially empty and consists of zero or more name and value pairs.
 * You can add to this using methods like append() (see Examples.)
 * In all methods of this interface, header names are matched by case-insensitive byte sequence.
 *
 */
export default class Headers extends URLSearchParams implements globalThis.Headers, Iterable<[string, string]> {
    /**
     * Headers class
     *
     * @constructor
     * @param init Response headers
     */
    constructor(init?: HeadersInit) {
        // Validate and normalize init object in [name, value(s)][]
        let result: string[][] = [];
        if (init instanceof Headers) {
            const raw = init.raw();
            for (const [name, values] of Object.entries(raw)) {
                result.push(...values.map(value => [name, value]));
            }
        } else if (init == null) { // eslint-disable-line no-eq-null, eqeqeq
            // No op
        } else if (typeof init === 'object' && !types.isBoxedPrimitive(init)) {
            const method = init[Symbol.iterator];
            // eslint-disable-next-line no-eq-null, eqeqeq
            if (method == null) {
                // Record<ByteString, ByteString>
                result.push(...Object.entries(init));
            } else {
                if (typeof method !== 'function') {
                    throw new TypeError('Header pairs must be iterable');
                }

                // Sequence<sequence<ByteString>>
                // Note: per spec we have to first exhaust the lists then process them
                result = [...(init as  string[][])] // TODO check if this works with Objects
                    .map(pair => {
                        if (
                            typeof pair !== 'object' || types.isBoxedPrimitive(pair)
                        ) {
                            throw new TypeError('Each header pair must be an iterable object');
                        }

                        return [...pair];
                    }).map(pair => {
                        if (pair.length !== 2) {
                            throw new TypeError('Each header pair must be a name/value tuple');
                        }

                        return [...pair];
                    });
            }
        } else {
            throw new TypeError('Failed to construct \'Headers\': The provided value is not of type \'(sequence<sequence<ByteString>> or record<ByteString, ByteString>)');
        }

        // Validate and lowercase
        result =
            result.length > 0 ?
                result.map(([name, value]) => {
                    validateHeaderName(name);
                    validateHeaderValue(name, String(value));
                    return [String(name).toLowerCase(), String(value)];
                }) :
                undefined;

        super(result);

        // Returning a Proxy that will lowercase key names, validate parameters and sort keys
        // eslint-disable-next-line no-constructor-return
        return new Proxy(this, {
            get(target, p, receiver) {
                switch (p) {
                    case 'append':
                    case 'set':
                        return (name: string, value: any) => {
                            validateHeaderName(name);
                            validateHeaderValue(name, String(value));
                            return URLSearchParams.prototype[p].call(
                                target,
                                String(name).toLowerCase(),
                                String(value)
                            );
                        };

                    case 'delete':
                    case 'has':
                    case 'getAll':
                        return (name: string) => {
                            validateHeaderName(name);
                            return URLSearchParams.prototype[p].call(
                                target,
                                String(name).toLowerCase()
                            );
                        };

                    case 'keys':
                        return () => {
                            target.sort();
                            return new Set(URLSearchParams.prototype.keys.call(target)).keys();
                        };

                    default:
                        return Reflect.get(target, p, receiver);
                }
            }
        });
        /* c8 ignore next */
    }

    get [Symbol.toStringTag]() {
        return this.constructor.name;
    }

    toString() {
        return Object.prototype.toString.call(this);
    }

    _appendToSoupMessage(message?: Soup.Message, type = Soup.MessageHeadersType.REQUEST) {
        const soupHeaders = message ? message.get_request_headers() : new Soup.MessageHeaders(type);
        for (const header in this.entries()) {
            soupHeaders.append(header, this.get(header));
        }
        return soupHeaders;
    }


    static _newFromSoupMessage(message: Soup.Message, type: Soup.MessageHeadersType = Soup.MessageHeadersType.RESPONSE) {
        let soupHeaders: Soup.MessageHeaders;
        const headers = new Headers();
        
        if (type === Soup.MessageHeadersType.RESPONSE) {
            soupHeaders = message.get_response_headers();
        } else if(type === Soup.MessageHeadersType.REQUEST)  {
            soupHeaders = message.get_request_headers();
        } else {
            for (const header in message.get_request_headers()) {
                headers.append(header, soupHeaders[header]);
            }
            soupHeaders = message.get_response_headers();
        }

        for (const header in soupHeaders) {
            headers.append(header, soupHeaders[header]);
        }
        return headers;
    }

    get(name: string) {
        const values = this.getAll(name);
        if (values.length === 0) {
            return null;
        }

        let value = values.join(', ');
        if (/^content-encoding$/i.test(name)) {
            value = value.toLowerCase();
        }

        return value;
    }

    forEach(callback, thisArg = undefined) {
        for (const name of this.keys()) {
            Reflect.apply(callback, thisArg, [this.get(name), name, this]);
        }
    }

    * values() {
        for (const name of this.keys()) {
            yield this.get(name);
        }
    }

    /**
     * 
     */
    * entries(): IterableIterator<[string, string]> {
        for (const name of this.keys()) {
            yield [name, this.get(name)];
        }
    }

	[Symbol.iterator]() {
		return this.entries();
	}

    /**
     * Node-fetch non-spec method
     * returning all headers and their values as array
     */
    raw(): Record<string, string[]> {
        return [...this.keys()].reduce((result, key) => {
            result[key] = this.getAll(key);
            return result;
        }, {});
    }

    /**
     * For better console.log(headers) and also to convert Headers into Node.js Request compatible format
     */
    [Symbol.for('nodejs.util.inspect.custom')]() {
        return [...this.keys()].reduce((result, key) => {
            const values = this.getAll(key);
            // Http.request() only supports string as Host header.
            // This hack makes specifying custom Host header possible.
            if (key === 'host') {
                result[key] = values[0];
            } else {
                result[key] = values.length > 1 ? values : values[0];
            }

            return result;
        }, {});
    }
}

/**
 * Re-shaping object for Web IDL tests
 * Only need to do it for overridden methods
 */
Object.defineProperties(
    Headers.prototype,
    ['get', 'entries', 'forEach', 'values'].reduce((result, property) => {
        result[property] = { enumerable: true };
        return result;
    }, {})
);

/**
 * Create a Headers object from an http.IncomingMessage.rawHeaders, ignoring those that do
 * not conform to HTTP grammar productions.
 * @param headers
 */
export function fromRawHeaders(headers: IncomingMessage['rawHeaders'] = []) {
    return new Headers(
        headers
            // Split into pairs
            .reduce((result, value, index, array) => {
                if (index % 2 === 0) {
                    result.push(array.slice(index, index + 2));
                }

                return result;
            }, [])
            .filter(([name, value]) => {
                try {
                    validateHeaderName(name);
                    validateHeaderValue(name, String(value));
                    return true;
                } catch {
                    return false;
                }
            })

    );
}
