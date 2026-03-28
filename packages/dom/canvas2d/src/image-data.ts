// ImageData implementation for Canvas 2D context
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/ImageData

/**
 * ImageData represents the pixel data of a canvas area.
 * Each pixel is 4 bytes: R, G, B, A (0-255 each).
 */
export class OurImageData {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace: PredefinedColorSpace = 'srgb';

    constructor(sw: number, sh: number);
    constructor(data: Uint8ClampedArray, sw: number, sh?: number);
    constructor(swOrData: number | Uint8ClampedArray, sh: number, maybeHeight?: number) {
        if (typeof swOrData === 'number') {
            // new ImageData(width, height)
            this.width = swOrData;
            this.height = sh;
            this.data = new Uint8ClampedArray(this.width * this.height * 4);
        } else {
            // new ImageData(data, width[, height])
            this.data = swOrData;
            this.width = sh;
            this.height = maybeHeight ?? (this.data.length / (4 * this.width));
            if (this.data.length !== this.width * this.height * 4) {
                throw new RangeError(
                    `Source data length ${this.data.length} is not a multiple of (4 * width=${this.width})`
                );
            }
        }
    }
}
