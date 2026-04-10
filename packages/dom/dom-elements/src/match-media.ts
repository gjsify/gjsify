// matchMedia stub for GJS — used by Excalibur and other libraries to monitor
// devicePixelRatio changes. Returns a minimal MediaQueryList-compatible object.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/Window/matchMedia
//
// NOTE: imports EventTarget directly from @gjsify/dom-events rather than
// using the global, because dom-elements/register runs BEFORE
// dom-events/register in the inject order — so `globalThis.EventTarget` may
// not yet exist when this class is defined at module load time.

import { EventTarget } from '@gjsify/dom-events';

export class MediaQueryList extends EventTarget {
    readonly media: string;
    readonly matches: boolean;
    onchange: ((this: MediaQueryList, ev: unknown) => unknown) | null = null;

    constructor(query: string) {
        super();
        this.media = query;
        this.matches = false;
    }

    /** @deprecated Use addEventListener('change', ...) */
    addListener(_listener: unknown): void {}

    /** @deprecated Use removeEventListener('change', ...) */
    removeListener(_listener: unknown): void {}
}

export function matchMedia(query: string): MediaQueryList {
    return new MediaQueryList(query);
}
