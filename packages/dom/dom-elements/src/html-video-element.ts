// HTMLVideoElement for GJS — video element stub.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement
// Reference: refs/happy-dom/packages/happy-dom/src/nodes/html-video-element/HTMLVideoElement.ts
//
// Pure DOM class — stores video dimensions and poster. The VideoBridge
// listens for 'srcobjectchange' / 'srcchange' events and handles GStreamer.

import { HTMLMediaElement } from './html-media-element.js';
import * as PropertySymbol from './property-symbol.js';
import { NamespaceURI } from './namespace-uri.js';

/**
 * HTML Video Element.
 *
 * Dispatches 'srcobjectchange' when srcObject is set (for bridge containers).
 * Dispatches 'srcchange' when src is set.
 */
export class HTMLVideoElement extends HTMLMediaElement {
    private _videoWidth = 0;
    private _videoHeight = 0;
    poster = '';

    constructor() {
        super();
        this[PropertySymbol.tagName] = 'VIDEO';
        this[PropertySymbol.localName] = 'video';
        this[PropertySymbol.namespaceURI] = NamespaceURI.html;
    }

    /** Intrinsic width of the video (set by the bridge when media metadata loads). */
    get videoWidth(): number {
        return this._videoWidth;
    }
    set videoWidth(value: number) {
        this._videoWidth = value;
    }

    /** Intrinsic height of the video (set by the bridge when media metadata loads). */
    get videoHeight(): number {
        return this._videoHeight;
    }
    set videoHeight(value: number) {
        this._videoHeight = value;
    }

    get [Symbol.toStringTag](): string {
        return 'HTMLVideoElement';
    }
}
