import { Event, EventTarget } from '@gjsify/dom-events';

import { serialError } from './errors.js';
import { applyFilters, validateFilters } from './filter.js';
import type { PortHandle, PortSource } from './port-source.js';
import { SerialPort } from './serial-port.js';
import type { SerialPortRequestOptions } from './types.js';

/**
 * Picks one port out of the candidates. The browser shows a chooser; a CLI or a GTK dialog
 * supplies its own. Returning `null` is "the user cancelled".
 */
export type PortChooser = (candidates: PortHandle[]) => Promise<PortHandle | null> | PortHandle | null;

const firstCandidate: PortChooser = (candidates) => candidates[0] ?? null;

export interface SerialOptionsInit {
    chooser?: PortChooser;
}

/** `navigator.serial`. Hands out one `SerialPort` object per port id, so identity comparisons hold. */
export class Serial extends EventTarget {
    readonly #source: PortSource;
    readonly #chooser: PortChooser;
    readonly #ports = new Map<string, SerialPort>();
    #unsubscribe: (() => void) | null = null;
    #onconnect: ((event: Event) => void) | null = null;
    #ondisconnect: ((event: Event) => void) | null = null;

    constructor(source: PortSource, init: SerialOptionsInit = {}) {
        super();
        this.#source = source;
        this.#chooser = init.chooser ?? firstCandidate;
    }

    // Assigning a handler listens to the platform just like `addEventListener` does.
    get onconnect(): ((event: Event) => void) | null {
        return this.#onconnect;
    }

    set onconnect(handler: ((event: Event) => void) | null) {
        if (handler) this.#watch();
        this.#onconnect = handler;
    }

    get ondisconnect(): ((event: Event) => void) | null {
        return this.#ondisconnect;
    }

    set ondisconnect(handler: ((event: Event) => void) | null) {
        if (handler) this.#watch();
        this.#ondisconnect = handler;
    }

    #portFor(handle: PortHandle): SerialPort {
        let port = this.#ports.get(handle.id);
        if (!port) {
            port = new SerialPort(this.#source, handle);
            this.#ports.set(handle.id, port);
        }
        return port;
    }

    async #listAvailable(): Promise<PortHandle[]> {
        if (!(await this.#source.available())) return [];
        return this.#source.list();
    }

    async getPorts(): Promise<SerialPort[]> {
        const handles = await this.#listAvailable();
        const live = new Set(handles.map((h) => h.id));
        for (const id of this.#ports.keys()) if (!live.has(id)) this.#ports.delete(id);
        return handles.map((h) => this.#portFor(h)).filter((p) => !p.forgotten);
    }

    async requestPort(options: SerialPortRequestOptions = {}): Promise<SerialPort> {
        validateFilters(options.filters);
        if (!(await this.#source.available())) {
            throw serialError('NotSupportedError', 'No serial port service is available on this system.');
        }
        const candidates = applyFilters(await this.#source.list(), options.filters);
        if (candidates.length === 0) throw serialError('NotFoundError', 'No port selected by the user.');
        const chosen = await this.#chooser(candidates);
        if (!chosen) throw serialError('NotFoundError', 'No port selected by the user.');
        return this.#portFor(chosen);
    }

    override addEventListener(...args: Parameters<EventTarget['addEventListener']>): void {
        this.#watch();
        super.addEventListener(...args);
    }

    #watch(): void {
        if (this.#unsubscribe || !this.#source.subscribe) return;
        this.#unsubscribe = this.#source.subscribe((change) => {
            const port = this.#portFor(change.handle);
            const event = new Event(change.type, { bubbles: true });
            if (change.type === 'disconnect') {
                port._notifyDisconnect();
                this.dispatchEvent(event);
                this.#ondisconnect?.(event);
            } else {
                this.dispatchEvent(event);
                this.#onconnect?.(event);
            }
        });
    }

    /** Not part of the spec: stop listening to the platform. */
    dispose(): void {
        this.#unsubscribe?.();
        this.#unsubscribe = null;
    }
}
