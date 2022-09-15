// See deno_std/node/internal/event_target.mjs

import { EventTarget, Event } from '@gjsify/event-target';
import { warnNotImplemented } from '@gjsify/utils';
import { kEnumerableProperty,  } from '@gjsify/node-internal/lib/util';

export class NodeEventTarget<TEventMap extends Record<string, Event> = Record<string, Event>, TMode extends "standard" | "strict" = "standard"> extends EventTarget<TEventMap, TMode> {
    static defaultMaxListeners = 10;

    constructor() {
        super();
    }

    setMaxListeners(n: number) {
        warnNotImplemented('NodeEventTarget.setMaxListeners');
    }

    getMaxListeners(): number {
        warnNotImplemented('NodeEventTarget.getMaxListeners');
        return 0;
    }


    eventNames(): string[] {
        warnNotImplemented('NodeEventTarget.eventNames');
        return []
    }


    listenerCount(type: string): number {
        warnNotImplemented('NodeEventTarget.listenerCount');
        return 0;
    }

    off(type: string, listener: EventTarget.EventListener<this, TEventMap[string]> | null, options: {
        capture?: boolean;
    }) {
        this.removeEventListener(type, listener, options);
        return this;
    }


    removeListener(type: string, listener: EventTarget.EventListener<this, TEventMap[string]>, options: {
        capture?: boolean;
    }) {
        this.removeEventListener(type, listener, options);
        return this;
    }

    on(type: string, listener: EventTarget.EventListener<this, TEventMap[string]>) {
        this.addEventListener(type, listener);
        return this;
    }

    addListener(type: string, listener: EventTarget.EventListener<this, TEventMap[string]>) {
        this.addEventListener(type, listener);
        return this;
    }

    emit(type: string, arg: any): boolean {
        const hadListeners = this.listenerCount(type) > 0;
        warnNotImplemented('NodeEventTarget.emit');
        // this.dispatchEvent()
        return hadListeners;
    }

    once(type: string, listener: EventTarget.EventListener<this, TEventMap[string]>) {
        this.addEventListener(type, listener, {
            once: true,
        });
        return this;
    }

    removeAllListeners(type: string) {
        warnNotImplemented('NodeEventTarget.removeAllListeners');
        return this;
    }
}

Object.defineProperties(NodeEventTarget.prototype, {
    setMaxListeners: kEnumerableProperty,
    getMaxListeners: kEnumerableProperty,
    eventNames: kEnumerableProperty,
    listenerCount: kEnumerableProperty,
    off: kEnumerableProperty,
    removeListener: kEnumerableProperty,
    on: kEnumerableProperty,
    addListener: kEnumerableProperty,
    once: kEnumerableProperty,
    emit: kEnumerableProperty,
    removeAllListeners: kEnumerableProperty,
});