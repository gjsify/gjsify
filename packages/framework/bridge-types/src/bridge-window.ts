// BridgeWindow — window-like object scoped to a single GTK-DOM bridge instance.
// Provides requestAnimationFrame, performance.now(), event handling, and viewport
// dimensions sourced from the GTK widget allocation.

import { EventTarget } from '@gjsify/dom-events';

import type { BridgeEnvironment } from './bridge-environment.js';

export interface BridgeWindowHost {
    requestAnimationFrame?(cb: FrameRequestCallback): number;
    cancelAnimationFrame?(id: number): void;
    performanceNow(): number;
    getWidth(): number;
    getHeight(): number;
    getDevicePixelRatio(): number;
}

/**
 * A `window`-like object bound to a specific bridge instance.
 *
 * Libraries that access `window.innerWidth`, `window.requestAnimationFrame`,
 * or `window.addEventListener` will work when given this object (or when
 * `installGlobals()` aliases it onto `globalThis`).
 */
export class BridgeWindow extends EventTarget {
    private _host: BridgeWindowHost;
    private _environment: BridgeEnvironment;

    constructor(environment: BridgeEnvironment, host: BridgeWindowHost) {
        super();
        this._environment = environment;
        this._host = host;
    }

    get document() {
        return this._environment.document;
    }

    get innerWidth(): number {
        return this._host.getWidth();
    }

    get innerHeight(): number {
        return this._host.getHeight();
    }

    get devicePixelRatio(): number {
        return this._host.getDevicePixelRatio();
    }

    requestAnimationFrame(callback: FrameRequestCallback): number {
        if (this._host.requestAnimationFrame) {
            return this._host.requestAnimationFrame(callback);
        }
        throw new Error('requestAnimationFrame is not supported by this bridge');
    }

    cancelAnimationFrame(id: number): void {
        if (this._host.cancelAnimationFrame) {
            this._host.cancelAnimationFrame(id);
        }
    }

    get performance(): { now(): number } {
        const host = this._host;
        return {
            now() {
                return host.performanceNow();
            },
        };
    }

    getComputedStyle(_element: any): any {
        return {};
    }

    get [Symbol.toStringTag](): string {
        return 'BridgeWindow';
    }
}
