import type { PortChange, PortConnection, PortHandle, PortSource } from './port-source.js';

/** A scripted device for tests: what the host writes is recorded, replies are pushed by the test. */
export class FakeConnection implements PortConnection {
    readonly written: Uint8Array[] = [];
    closed = false;
    failWrites: Error | null = null;
    #queue: Array<Uint8Array | null> = [];
    #waiting: Array<(chunk: Uint8Array | null) => void> = [];

    /** The device sends bytes to the host. */
    push(bytes: Uint8Array): void {
        this.#deliver(bytes);
    }

    /** The device ends the channel (unplugged, powered off). */
    end(): void {
        this.#deliver(null);
    }

    #deliver(chunk: Uint8Array | null): void {
        const waiter = this.#waiting.shift();
        if (waiter) waiter(chunk);
        else this.#queue.push(chunk);
    }

    read(): Promise<Uint8Array | null> {
        if (this.#queue.length > 0) return Promise.resolve(this.#queue.shift() ?? null);
        if (this.closed) return Promise.resolve(null);
        return new Promise((resolve) => this.#waiting.push(resolve));
    }

    async write(bytes: Uint8Array): Promise<void> {
        if (this.closed) throw new Error('connection closed');
        if (this.failWrites) throw this.failWrites;
        this.written.push(bytes.slice());
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        for (const waiter of this.#waiting.splice(0)) waiter(null);
    }
}

export class FakeSource implements PortSource {
    readonly connections: FakeConnection[] = [];
    openCalls: string[] = [];
    isAvailable = true;
    #handles: PortHandle[];
    #listeners = new Set<(change: PortChange) => void>();
    subscribed = 0;

    constructor(handles: PortHandle[] = []) {
        this.#handles = [...handles];
    }

    async available(): Promise<boolean> {
        return this.isAvailable;
    }

    async list(): Promise<PortHandle[]> {
        return [...this.#handles];
    }

    async open(id: string): Promise<PortConnection> {
        this.openCalls.push(id);
        if (!this.#handles.some((h) => h.id === id)) throw new Error(`no such port: ${id}`);
        const connection = new FakeConnection();
        this.connections.push(connection);
        return connection;
    }

    subscribe(listener: (change: PortChange) => void): () => void {
        this.subscribed++;
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    get listenerCount(): number {
        return this.#listeners.size;
    }

    add(handle: PortHandle): void {
        this.#handles.push(handle);
        for (const l of this.#listeners) l({ type: 'connect', handle });
    }

    remove(id: string): void {
        const handle = this.#handles.find((h) => h.id === id);
        if (!handle) return;
        this.#handles = this.#handles.filter((h) => h.id !== id);
        for (const l of this.#listeners) l({ type: 'disconnect', handle });
    }
}
