import type { HTMLElement } from '@gjsify/dom-elements';

/**
 * HTML Image Element.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement
 */
export interface IHTMLImageElement extends HTMLElement {
    alt: string;
    readonly complete: boolean;
    crossOrigin: string | null;
    readonly currentSrc: string;
    decoding: string;
    height: number;
    isMap: boolean;
    loading: string;
    readonly naturalHeight: number;
    readonly naturalWidth: number;
    referrerPolicy: string;
    sizes: string;
    src: string;
    srcset: string;
    useMap: string;
    width: number;
    readonly x: number;
    readonly y: number;

    /** Resolves once the image is decoded and safe to append to the DOM. */
    decode(): Promise<void>;

    /** @override */
    cloneNode(deep?: boolean): IHTMLImageElement;
}
