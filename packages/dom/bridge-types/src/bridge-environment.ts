// BridgeEnvironment — isolated mini-browser environment for a single GTK-DOM bridge.
// Each bridge instance gets its own Document, body, and window so that multiple
// bridges can coexist without polluting a shared global state.

import { Document } from '@gjsify/dom-elements';

import { BridgeWindow } from './bridge-window.js';
import type { BridgeWindowHost } from './bridge-window.js';

/**
 * An isolated browser-like environment scoped to a single bridge instance.
 *
 * Contains its own `Document` (with a `body` element) and a `BridgeWindow`
 * that delegates animation frames, timing, and viewport dimensions back
 * to the owning GTK widget.
 */
export class BridgeEnvironment {
    readonly document: Document;
    readonly window: BridgeWindow;

    constructor(host: BridgeWindowHost) {
        this.document = new Document();
        this.window = new BridgeWindow(this, host);
    }

    get body() {
        return this.document.body;
    }

    get [Symbol.toStringTag](): string {
        return 'BridgeEnvironment';
    }
}
