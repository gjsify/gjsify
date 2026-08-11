// matchMedia stub for GJS — libraries such as Excalibur use it to watch devicePixelRatio changes.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/Window/matchMedia
//
// EventTarget comes from the @gjsify/dom-events package rather than `globalThis`: the register that
// installs the global need not have run when this module is evaluated, and the class is defined at
// module-load time.

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
