import { Event, EventTarget } from '@gjsify/dom-events';
import { ReadableStream, WritableStream } from '@gjsify/web-streams';

import { asNetworkError, serialError } from './errors.js';
import type { PortConnection, PortHandle, PortSource } from './port-source.js';
import type { SerialOptions, SerialPortInfo } from './types.js';

export interface SerialOutputSignals {
    dataTerminalReady?: boolean;
    requestToSend?: boolean;
    break?: boolean;
}

export interface SerialInputSignals {
    dataCarrierDetect: boolean;
    clearToSend: boolean;
    ringIndicator: boolean;
    dataSetReady: boolean;
}

const DEFAULT_BUFFER = 255;

/**
 * Web Serial's `SerialPort` over a `PortSource`. Follows the spec's state rules: one `open()` at a
 * time, `readable`/`writable` are `null` while closed or after a fatal error, `close()` waits for
 * the streams to be released. Control signals do not exist on a Bluetooth serial port, so those
 * calls say so instead of pretending.
 */
export class SerialPort extends EventTarget {
    readonly #source: PortSource;
    readonly #handle: PortHandle;
    #connection: PortConnection | null = null;
    #readable: globalThis.ReadableStream<Uint8Array> | null = null;
    #writable: globalThis.WritableStream<Uint8Array> | null = null;
    #opening = false;
    #closing = false;
    #forgotten = false;
    #lost = false;
    onconnect: ((event: Event) => void) | null = null;
    ondisconnect: ((event: Event) => void) | null = null;

    constructor(source: PortSource, handle: PortHandle) {
        super();
        this.#source = source;
        this.#handle = handle;
    }

    get handle(): PortHandle {
        return this.#handle;
    }

    get connected(): boolean {
        return this.#connection !== null && !this.#lost && !this.#forgotten;
    }

    get readable(): globalThis.ReadableStream<Uint8Array> | null {
        return this.#readable;
    }

    get writable(): globalThis.WritableStream<Uint8Array> | null {
        return this.#writable;
    }

    getInfo(): SerialPortInfo {
        return { ...this.#handle.info };
    }

    async open(options: SerialOptions): Promise<void> {
        if (!options || !Number.isInteger(options.baudRate) || options.baudRate < 1) {
            throw new TypeError("Failed to execute 'open' on 'SerialPort': baudRate must be a positive integer.");
        }
        const bufferSize = options.bufferSize ?? DEFAULT_BUFFER;
        if (!Number.isInteger(bufferSize) || bufferSize < 1) {
            throw new TypeError("Failed to execute 'open' on 'SerialPort': bufferSize must be a positive integer.");
        }
        if (this.#opening || this.#connection || this.#closing) {
            throw serialError('InvalidStateError', 'The port is already open.');
        }
        this.#opening = true;
        try {
            this.#connection = await this.#source.open(this.#handle.id);
        } catch (cause) {
            throw asNetworkError('Failed to open serial port.', cause);
        } finally {
            this.#opening = false;
        }
        this.#createStreams(this.#connection);
    }

    #createStreams(connection: PortConnection): void {
        // The gjsify constructor types are looser than lib.dom's; the runtime shape is the standard one.
        this.#readable = new ReadableStream<Uint8Array>(
            {
                pull: async (controller) => {
                    try {
                        const chunk = await connection.read();
                        if (chunk === null) {
                            // close() ended the channel on purpose and has already dealt with the stream.
                            if (this.#closing) return;
                            this.#lost = true;
                            controller.error(serialError('NetworkError', 'The device has been lost.'));
                            this.#readable = null;
                            this.#writable = null;
                            return;
                        }
                        controller.enqueue(chunk);
                    } catch (cause) {
                        controller.error(asNetworkError('Read failed.', cause));
                        this.#readable = null;
                    }
                },
                cancel: async () => {
                    // Cancelling the reader discards the rest; the channel itself stays open until close().
                },
            },
            { highWaterMark: 0 },
        ) as unknown as globalThis.ReadableStream<Uint8Array>;
        this.#writable = new WritableStream<Uint8Array>(
            {
                write: async (chunk) => {
                    try {
                        await connection.write(chunk);
                    } catch (cause) {
                        throw asNetworkError('Write failed.', cause);
                    }
                },
            },
            { highWaterMark: 1 },
        ) as unknown as globalThis.WritableStream<Uint8Array>;
    }

    async close(): Promise<void> {
        if (!this.#connection) throw serialError('InvalidStateError', 'The port is already closed.');
        if (this.#readable?.locked || this.#writable?.locked) {
            throw new TypeError("Failed to execute 'close' on 'SerialPort': a locked stream cannot be closed.");
        }
        this.#closing = true;
        const connection = this.#connection;
        const readable = this.#readable;
        const writable = this.#writable;
        try {
            // Ending the channel first releases a read that is still pending inside the stream.
            await connection.close();
            await readable?.cancel().catch(() => undefined);
            await writable?.close().catch(() => undefined);
        } finally {
            this.#lost = false;
            this.#connection = null;
            this.#readable = null;
            this.#writable = null;
            this.#closing = false;
        }
    }

    async forget(): Promise<void> {
        if (this.#connection) await this.close().catch(() => undefined);
        this.#forgotten = true;
    }

    get forgotten(): boolean {
        return this.#forgotten;
    }

    async setSignals(_signals?: SerialOutputSignals): Promise<void> {
        throw serialError('NotSupportedError', 'A Bluetooth serial port has no control signals to set.');
    }

    async getSignals(): Promise<SerialInputSignals> {
        throw serialError('NotSupportedError', 'A Bluetooth serial port has no control signals to read.');
    }

    /** Internal: the transport reported the device gone. */
    _notifyDisconnect(): void {
        this.#lost = true;
        this.#readable = null;
        this.#writable = null;
        const event = new Event('disconnect', { bubbles: true });
        this.dispatchEvent(event);
        this.ondisconnect?.(event);
    }
}
