/**
 * Headers class — standalone implementation without URLSearchParams inheritance.
 *
 * Uses an internal Map<string, string[]> for header storage.
 * All header names are lowercased per the Fetch spec.
 */

import Soup from '@girs/soup-3.0';
import { validateHeaderName, validateHeaderValue } from '@gjsify/http';

const _headers = Symbol('Headers.headers');

function isBoxedPrimitive(val: unknown): boolean {
    return (
        val instanceof String ||
        val instanceof Number ||
        val instanceof Boolean ||
        (typeof Symbol !== 'undefined' && val instanceof Symbol) ||
        (typeof BigInt !== 'undefined' && val instanceof (BigInt as any))
    );
}

export default class Headers implements Iterable<[string, string]> {
    [_headers]: Map<string, string[]>;

    constructor(init?: HeadersInit | Headers | null) {
        this[_headers] = new Map();

        if (init == null) {
            return;
        }

        if (init instanceof Headers) {
            for (const [name, values] of init[_headers]) {
                this[_headers].set(name, [...values]);
            }
            return;
        }

        if (typeof init === 'object' && !isBoxedPrimitive(init)) {
            const method = (init as any)[Symbol.iterator];
            if (method == null) {
                // Record<string, string>
                for (const [name, value] of Object.entries(init)) {
                    validateHeaderName(name);
                    validateHeaderValue(name, String(value));
                    this.append(name, String(value));
                }
            } else {
                if (typeof method !== 'function') {
                    throw new TypeError('Header pairs must be iterable');
                }

                for (const pair of init as Iterable<string[]>) {
                    if (typeof pair !== 'object' || isBoxedPrimitive(pair)) {
                        throw new TypeError('Each header pair must be an iterable object');
                    }

                    const arr = [...pair];
                    if (arr.length !== 2) {
                        throw new TypeError('Each header pair must be a name/value tuple');
                    }

                    validateHeaderName(arr[0]);
                    validateHeaderValue(arr[0], String(arr[1]));
                    this.append(arr[0], String(arr[1]));
                }
            }
        } else {
            throw new TypeError(
                'Failed to construct \'Headers\': The provided value is not of type ' +
                '\'(sequence<sequence<ByteString>> or record<ByteString, ByteString>)\''
            );
        }
    }

    append(name: string, value: string): void {
        const lowerName = String(name).toLowerCase();
        const strValue = String(value);
        const existing = this[_headers].get(lowerName);
        if (existing) {
            existing.push(strValue);
        } else {
            this[_headers].set(lowerName, [strValue]);
        }
    }

    set(name: string, value: string): void {
        const lowerName = String(name).toLowerCase();
        this[_headers].set(lowerName, [String(value)]);
    }

    delete(name: string): void {
        this[_headers].delete(String(name).toLowerCase());
    }

    has(name: string): boolean {
        return this[_headers].has(String(name).toLowerCase());
    }

    get(name: string): string | null {
        const values = this[_headers].get(String(name).toLowerCase());
        if (!values || values.length === 0) {
            return null;
        }

        let value = values.join(', ');
        if (/^content-encoding$/i.test(name)) {
            value = value.toLowerCase();
        }

        return value;
    }

    getAll(name: string): string[] {
        return this[_headers].get(String(name).toLowerCase()) ?? [];
    }

    forEach(callback: (value: string, name: string, parent: Headers) => void, thisArg?: any): void {
        for (const name of this.keys()) {
            Reflect.apply(callback, thisArg, [this.get(name), name, this]);
        }
    }

    *keys(): IterableIterator<string> {
        const sorted = [...this[_headers].keys()].sort();
        const seen = new Set<string>();
        for (const key of sorted) {
            if (!seen.has(key)) {
                seen.add(key);
                yield key;
            }
        }
    }

    *values(): IterableIterator<string> {
        for (const name of this.keys()) {
            yield this.get(name)!;
        }
    }

    *entries(): IterableIterator<[string, string]> {
        for (const name of this.keys()) {
            yield [name, this.get(name)!];
        }
    }

    [Symbol.iterator](): IterableIterator<[string, string]> {
        return this.entries();
    }

    get [Symbol.toStringTag](): string {
        return 'Headers';
    }

    toString(): string {
        return Object.prototype.toString.call(this);
    }

    /**
     * Node-fetch non-spec method: return all headers and their values as arrays.
     */
    raw(): Record<string, string[]> {
        const result: Record<string, string[]> = {};
        for (const name of this.keys()) {
            result[name] = this.getAll(name);
        }
        return result;
    }

    /**
     * Append all headers to a Soup.Message for sending.
     */
    _appendToSoupMessage(message?: Soup.Message, type = Soup.MessageHeadersType.REQUEST): Soup.MessageHeaders {
        const soupHeaders = message ? message.get_request_headers() : new Soup.MessageHeaders(type);
        for (const [name, value] of this.entries()) {
            soupHeaders.append(name, value);
        }
        return soupHeaders;
    }

    /**
     * Create a Headers instance from a Soup.Message's headers.
     */
    static _newFromSoupMessage(message: Soup.Message, type: Soup.MessageHeadersType = Soup.MessageHeadersType.RESPONSE): Headers {
        const headers = new Headers();
        let soupHeaders: Soup.MessageHeaders;

        if (type === Soup.MessageHeadersType.RESPONSE) {
            soupHeaders = message.get_response_headers();
        } else {
            soupHeaders = message.get_request_headers();
        }

        // Soup.MessageHeaders.foreach iterates all header name/value pairs
        soupHeaders.foreach((name: string, value: string) => {
            headers.append(name, value);
        });

        return headers;
    }

    /**
     * For better console.log(headers)
     */
    [Symbol.for('nodejs.util.inspect.custom')]() {
        const result: Record<string, string | string[]> = {};
        for (const key of this.keys()) {
            const values = this.getAll(key);
            if (key === 'host') {
                result[key] = values[0];
            } else {
                result[key] = values.length > 1 ? values : values[0];
            }
        }
        return result;
    }
}

Object.defineProperties(
    Headers.prototype,
    ['get', 'entries', 'forEach', 'values'].reduce((result: PropertyDescriptorMap, property) => {
        result[property] = { enumerable: true };
        return result;
    }, {})
);
