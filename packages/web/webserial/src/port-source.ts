/**
 * The seam. The Web Serial classes speak the standard; a platform driver speaks whatever its
 * system does (BlueZ over D-Bus, a fake in tests) and is reduced to this vocabulary. Nothing above
 * this file knows which driver is underneath, which is what lets another platform come later
 * without touching the API surface.
 */

import type { SerialPortInfo } from './types.js';

/** A port the platform knows about and the user may use. `id` is stable across calls. */
export interface PortHandle {
    readonly id: string;
    /** Human-readable name for a chooser; not part of the Web Serial API. */
    readonly name: string;
    readonly info: SerialPortInfo;
}

/** An open byte channel. Raw bytes in and out; the streams are built on top of it. */
export interface PortConnection {
    /** Next bytes from the device, or `null` once the channel has ended. */
    read(): Promise<Uint8Array | null>;
    write(bytes: Uint8Array): Promise<void>;
    /** Idempotent. Resolves a pending `read()` with `null`. */
    close(): Promise<void>;
}

export interface PortChange {
    readonly type: 'connect' | 'disconnect';
    readonly handle: PortHandle;
}

export interface PortSource {
    /** A quiet capability test: `false` when the platform service is missing, never an exception. */
    available(): Promise<boolean>;
    /** The ports already allowed for use (for Bluetooth: bonded devices). */
    list(): Promise<PortHandle[]>;
    open(id: string): Promise<PortConnection>;
    /** Optional. Called lazily, on the first `connect`/`disconnect` listener. Returns the unsubscribe. */
    subscribe?(listener: (change: PortChange) => void): () => void;
}
