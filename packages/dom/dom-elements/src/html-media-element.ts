// HTMLMediaElement for GJS — base class for HTMLVideoElement and HTMLAudioElement.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement
// Reference: refs/happy-dom/packages/happy-dom/src/nodes/html-media-element/HTMLMediaElement.ts
//
// This is a pure DOM class — it stores media state and dispatches events but
// does NOT interact with GStreamer. The bridge container (VideoBridge etc.)
// listens for internal events and handles the actual pipeline.

import { Event } from '@gjsify/dom-events';

import { HTMLElement } from './html-element.js';

// Readiness states
export const HAVE_NOTHING = 0;
export const HAVE_METADATA = 1;
export const HAVE_CURRENT_DATA = 2;
export const HAVE_FUTURE_DATA = 3;
export const HAVE_ENOUGH_DATA = 4;

// Network states
export const NETWORK_EMPTY = 0;
export const NETWORK_IDLE = 1;
export const NETWORK_LOADING = 2;
export const NETWORK_NO_SOURCE = 3;

/**
 * Base class for media elements (video, audio).
 *
 * Stores media state and dispatches DOM events. Pipeline construction is
 * delegated to the bridge container via internal events.
 */
export class HTMLMediaElement extends HTMLElement {
    // -- Source --
    private _src = '';
    private _srcObject: any = null;

    // -- Playback state --
    currentTime = 0;
    duration = NaN;
    paused = true;
    ended = false;
    volume = 1;
    muted = false;
    defaultMuted = false;
    loop = false;
    autoplay = false;
    preload: '' | 'none' | 'metadata' | 'auto' = '';
    playbackRate = 1;
    defaultPlaybackRate = 1;

    // -- Readiness --
    readyState = HAVE_NOTHING;
    networkState = NETWORK_EMPTY;

    // -- Buffered/seekable stubs --
    get buffered(): { length: number; start(index: number): number; end(index: number): number } {
        return { length: 0, start: () => 0, end: () => 0 };
    }
    get seekable(): { length: number; start(index: number): number; end(index: number): number } {
        return { length: 0, start: () => 0, end: () => 0 };
    }
    get played(): { length: number; start(index: number): number; end(index: number): number } {
        return { length: 0, start: () => 0, end: () => 0 };
    }

    // -- src property --
    get src(): string {
        return this._src;
    }
    set src(value: string) {
        this._src = value;
        this._srcObject = null;
        this.dispatchEvent(new Event('srcchange'));
    }

    // -- srcObject property (MediaStream) --
    get srcObject(): any {
        return this._srcObject;
    }
    set srcObject(stream: any) {
        this._srcObject = stream;
        this._src = '';
        this.dispatchEvent(new Event('srcobjectchange'));
    }

    // -- Playback control --
    play(): Promise<void> {
        this.paused = false;
        this.ended = false;
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
    }

    pause(): void {
        this.paused = true;
        this.dispatchEvent(new Event('pause'));
    }

    load(): void {
        this.readyState = HAVE_NOTHING;
        this.networkState = NETWORK_LOADING;
        this.dispatchEvent(new Event('loadstart'));
    }

    canPlayType(_type: string): '' | 'maybe' | 'probably' {
        return '';
    }

    // -- Static constants --
    static readonly HAVE_NOTHING = HAVE_NOTHING;
    static readonly HAVE_METADATA = HAVE_METADATA;
    static readonly HAVE_CURRENT_DATA = HAVE_CURRENT_DATA;
    static readonly HAVE_FUTURE_DATA = HAVE_FUTURE_DATA;
    static readonly HAVE_ENOUGH_DATA = HAVE_ENOUGH_DATA;
    static readonly NETWORK_EMPTY = NETWORK_EMPTY;
    static readonly NETWORK_IDLE = NETWORK_IDLE;
    static readonly NETWORK_LOADING = NETWORK_LOADING;
    static readonly NETWORK_NO_SOURCE = NETWORK_NO_SOURCE;

    get [Symbol.toStringTag](): string {
        return 'HTMLMediaElement';
    }
}
