import type { PredefinedColorSpace } from './predefined-color-space.js';

/** The pixel data of an area of a `<canvas>`. */
export interface ImageData {
    readonly colorSpace: PredefinedColorSpace;
    /** One-dimensional, RGBA order, integers 0-255. */
    readonly data: Uint8ClampedArray<ArrayBuffer>;
    /** Pixels, not CSS units. */
    readonly height: number;
    /** Pixels, not CSS units. */
    readonly width: number;
}
