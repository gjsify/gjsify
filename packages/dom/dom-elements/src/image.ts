import { HTMLImageElement } from './html-image-element.js';

/**
 * The `Image` constructor form of HTMLImageElement.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/Image
 */
export default class Image extends HTMLImageElement {
    constructor(width: number | null = null, height: number | null = null) {
        super();

        if (width !== null) {
            this.width = width;
        }

        if (height !== null) {
            this.height = height;
        }
    }
}

export { HTMLImageElement, Image };
