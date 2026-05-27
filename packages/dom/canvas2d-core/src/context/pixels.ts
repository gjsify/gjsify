// Image-data (pixel ops) methods for CanvasRenderingContext2D.
// Reference: refs/node-canvas — Canvas 2D ImageData API.
// Original: see canvas-rendering-context-2d.ts pre-split.

import Cairo from 'cairo';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';

import type { CanvasRenderingContext2D } from '../canvas-rendering-context-2d.js';
import { OurImageData } from '../image-data.js';

export interface PixelMethods {
    createImageData(sw: number, sh: number): ImageData;
    createImageData(imagedata: ImageData): ImageData;
    getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
    putImageData(
        imageData: ImageData,
        dx: number,
        dy: number,
        dirtyX?: number,
        dirtyY?: number,
        dirtyWidth?: number,
        dirtyHeight?: number,
    ): void;
}

declare module '../canvas-rendering-context-2d.js' {
    interface CanvasRenderingContext2D extends PixelMethods {}
}

const pixelMethods: PixelMethods & ThisType<CanvasRenderingContext2D> = {
    createImageData(this: CanvasRenderingContext2D, swOrImageData: number | ImageData, sh?: number): ImageData {
        if (typeof swOrImageData === 'number') {
            return new OurImageData(Math.abs(swOrImageData), Math.abs(sh!)) as unknown as ImageData;
        }
        return new OurImageData(swOrImageData.width, swOrImageData.height) as unknown as ImageData;
    },

    getImageData(this: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number): ImageData {
        this._ensureSurface();
        this._surface.flush();

        // Use Gdk.pixbuf_get_from_surface to read pixels
        const pixbuf = Gdk.pixbuf_get_from_surface(this._surface, sx, sy, sw, sh);
        if (!pixbuf) {
            return new OurImageData(sw, sh) as unknown as ImageData;
        }

        const pixels = pixbuf.get_pixels();
        const hasAlpha = pixbuf.get_has_alpha();
        const rowstride = pixbuf.get_rowstride();
        const nChannels = pixbuf.get_n_channels();
        const out = new Uint8ClampedArray(sw * sh * 4);

        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                const srcIdx = y * rowstride + x * nChannels;
                const dstIdx = (y * sw + x) * 4;
                out[dstIdx] = pixels[srcIdx]; // R
                out[dstIdx + 1] = pixels[srcIdx + 1]; // G
                out[dstIdx + 2] = pixels[srcIdx + 2]; // B
                out[dstIdx + 3] = hasAlpha ? pixels[srcIdx + 3] : 255; // A
            }
        }

        return new OurImageData(out, sw, sh) as unknown as ImageData;
    },

    putImageData(
        this: CanvasRenderingContext2D,
        imageData: ImageData,
        dx: number,
        dy: number,
        dirtyX?: number,
        dirtyY?: number,
        dirtyWidth?: number,
        dirtyHeight?: number,
    ): void {
        this._ensureSurface();

        // Determine the dirty region
        const sx = dirtyX ?? 0;
        const sy = dirtyY ?? 0;
        const sw = dirtyWidth ?? imageData.width;
        const sh = dirtyHeight ?? imageData.height;

        // Create a GdkPixbuf from the ImageData RGBA
        const srcData = imageData.data;
        const srcWidth = imageData.width;

        // Create a temporary buffer for the dirty region (RGBA, no padding)
        const regionData = new Uint8Array(sw * sh * 4);
        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                const srcIdx = ((sy + y) * srcWidth + (sx + x)) * 4;
                const dstIdx = (y * sw + x) * 4;
                regionData[dstIdx] = srcData[srcIdx];
                regionData[dstIdx + 1] = srcData[srcIdx + 1];
                regionData[dstIdx + 2] = srcData[srcIdx + 2];
                regionData[dstIdx + 3] = srcData[srcIdx + 3];
            }
        }

        const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(
            regionData as unknown as import('@girs/glib-2.0').default.Bytes,
            GdkPixbuf.Colorspace.RGB,
            true, // has_alpha
            8, // bits_per_sample
            sw,
            sh,
            sw * 4, // rowstride
        );

        // putImageData per spec ignores compositing — always uses SOURCE operator
        this._ctx.save();
        this._ctx.setOperator(Cairo.Operator.SOURCE);
        Gdk.cairo_set_source_pixbuf(this._ctx, pixbuf, dx + sx, dy + sy);
        this._ctx.rectangle(dx + sx, dy + sy, sw, sh);
        this._ctx.fill();
        this._ctx.restore();
    },
};

/** Install pixel-ops (ImageData) methods on CanvasRenderingContext2D.prototype. */
export function installPixelMethods(proto: object): void {
    Object.assign(proto, pixelMethods);
}
