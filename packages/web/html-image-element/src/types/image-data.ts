import type { PredefinedColorSpace } from './predefined-color-space.js';

/** The underlying pixel data of an area of a <canvas> element. It is created using the ImageData() constructor or creator methods on the CanvasRenderingContext2D object associated with a canvas: createImageData() and getImageData(). It can also be used to set a part of the canvas by using putImageData(). */
export interface ImageData {
    readonly colorSpace: PredefinedColorSpace;
    /** Returns the one-dimensional array containing the data in RGBA order, as integers in the range 0 to 255. */
    readonly data: Uint8ClampedArray;
    /** Returns the actual dimensions of the data in the ImageData object, in pixels. */
    readonly height: number;
    /** Returns the actual dimensions of the data in the ImageData object, in pixels. */
    readonly width: number;
}