import type {
    Abortable,
    captureRejections as TCaptureRejections,
    defaultMaxListeners as TDefaultMaxListeners,
    on as TOn,
    getEventListeners as TGetEventListeners,
    once as TOnce,
    setMaxListeners as TSetMaxListeners,
} from 'events';

import { warnNotImplemented } from '@gjsify/utils';
import { EventEmitter } from './event-emitter.js';

import { NodeEventTarget } from './node-event-target.js';

interface DOMEventTarget {
    addEventListener(
        eventName: string,
        listener: (...args: any[]) => void,
        opts?: {
            once: boolean;
        }
    ): any;
}

interface StaticEventEmitterOptions {
    signal?: AbortSignal | undefined;
}

interface AsyncIterableIterator<T> extends AsyncIterator<T> {
    [Symbol.asyncIterator](): AsyncIterableIterator<T>;
}

export const captureRejectionSymbol: unique symbol = Symbol.for("nodejs.rejection");
export const errorMonitor: unique symbol = Symbol("events.errorMonitor");
export const captureRejections: typeof TCaptureRejections = false; // TODO getter / setter
export const defaultMaxListeners: typeof TDefaultMaxListeners = 10; // TODO getter / setter

export const on: typeof TOn = function(emitter: NodeJS.EventEmitter, eventName: string, options?: StaticEventEmitterOptions): any /*: AsyncIterableIterator<any>*/ {
    warnNotImplemented('events.on')
}

export const once: typeof TOnce = async function(...args: any[]): Promise<any[]> {
    warnNotImplemented('events.once');
    return[]
}

export const getEventListeners: typeof TGetEventListeners = function(emitter: DOMEventTarget | NodeJS.EventEmitter, name: string | symbol): Function[] {
    warnNotImplemented('events.getEventListeners');
    return []
}

export const setMaxListeners: typeof TSetMaxListeners = function(n?: number, ...eventTargets: Array<DOMEventTarget | NodeJS.EventEmitter>): void {
    warnNotImplemented('events.getEventListeners');
}

export { Abortable, EventEmitter, NodeEventTarget }
export default EventEmitter;