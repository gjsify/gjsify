/**
 * Module augmentation for @girs/gwebgl-0.1
 *
 * The npm package @girs/gwebgl-0.1@0.1.0-4.0.0-beta.43 predates the Vala
 * refactor (b5640b31) that moved bufferData, texImage2D, readPixels,
 * uniformMatrix* and related methods from WebGLRenderingContext into
 * WebGLRenderingContextBase so that both WebGL1 and WebGL2 GObjects expose
 * the full API surface.  Until a new version is published to npm this
 * augmentation makes those methods visible to TypeScript.
 */

import type GLib from '@girs/glib-2.0';

declare module '@girs/gwebgl-0.1' {
    namespace Gwebgl {
        interface WebGLRenderingContextBase {
            bufferData(target: number, variant: GLib.Variant, usage: number): void;
            bufferDataSizeOnly(target: number, size: number, usage: number): void;
            bufferSubData(target: number, offset: number, variant: GLib.Variant): void;
            compressedTexImage2D(
                target: number,
                level: number,
                internalFormat: number,
                width: number,
                height: number,
                border: number,
                variant: GLib.Variant,
            ): void;
            compressedTexSubImage2D(
                target: number,
                level: number,
                xoffset: number,
                yoffset: number,
                width: number,
                height: number,
                format: number,
                variant: GLib.Variant,
            ): void;
            readPixels(
                x: number,
                y: number,
                width: number,
                height: number,
                format: number,
                type: number,
                variant: GLib.Variant,
            ): Uint8Array;
            texImage2D(
                target: number,
                level: number,
                internalFormat: number,
                width: number,
                height: number,
                border: number,
                format: number,
                type: number,
                variant: GLib.Variant,
            ): void;
            texImage2DFromPixbuf(
                target: number,
                level: number,
                internalFormat: number,
                format: number,
                type: number,
                source?: any | null,
            ): void;
            texSubImage2D(
                target: number,
                level: number,
                xoffset: number,
                yoffset: number,
                width: number,
                height: number,
                format: number,
                type: number,
                variant: GLib.Variant,
            ): void;
            texSubImage2DFromPixbuf(
                target: number,
                level: number,
                xoffset: number,
                yoffset: number,
                format: number,
                type: number,
                source?: any | null,
            ): void;
            uniformMatrix2fv(location: number, transpose: boolean, value: number[]): void;
            uniformMatrix3fv(location: number, transpose: boolean, value: number[]): void;
            uniformMatrix4fv(location: number, transpose: boolean, value: number[]): void;
        }
    }
}
