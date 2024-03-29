// https://github.com/stackgl/headless-gl/blob/master/src/javascript/utils.js
// import { gl } from './native-gl.js';
import { WebGLUniformLocation } from './webgl-uniform-location.js';
import { WebGLProgram } from './webgl-program.js';
import GLib from '@girs/glib-2.0';
import { HTMLImageElement as GjsifyHTMLImageElement } from "@gjsify/html-image-element";

import type Gwebgl from '@girs/gwebgl-0.1';
import type { GjsifyWebGLRenderingContext } from './webgl-rendering-context.js';
import type { TypedArray} from './types/index.js';

export function bindPublics(props: Array<keyof GjsifyWebGLRenderingContext>, wrapper: GjsifyWebGLRenderingContext, privateInstance: GjsifyWebGLRenderingContext, privateMethods: string[]) {
    for (let i = 0; i < props.length; i++) {
        const prop = props[i]
        const value = privateInstance[prop]
        if (typeof value === 'function') {
            if (privateMethods.indexOf(prop) === -1) {
                // @ts-ignore
                wrapper[prop] = value.bind(privateInstance)
            }
        } else {
            if (prop[0] === '_' ||
                prop[0] === '0' ||
                prop[0] === '1') {
                continue
            }
            // @ts-ignore
            wrapper[prop] = value
        }
    }
}

export function checkObject(object: any) {
    return typeof object === 'object' ||
        (object === undefined)
}

export function checkUniform(program: WebGLProgram, location: WebGLUniformLocation) {
    return location instanceof WebGLUniformLocation &&
        location._program === program &&
        location._linkCount === program._linkCount
}

export function isTypedArray(data: TypedArray) {
    return data instanceof Uint8Array ||
        data instanceof Uint8ClampedArray ||
        data instanceof Int8Array ||
        data instanceof Uint16Array ||
        data instanceof Int16Array ||
        data instanceof Uint32Array ||
        data instanceof Int32Array ||
        data instanceof Float32Array ||
        data instanceof Float64Array
}

// Don't allow: ", $, `, @, \, ', \0
export function isValidString(str: string) {
    // Remove comments first
    const c = str.replace(/(?:\/\*(?:[\s\S]*?)\*\/)|(?:([\s;])+\/\/(?:.*)$)/gm, '')
    return !(/["$`@\\'\0]/.test(c))
}

export function vertexCount(gl: GjsifyWebGLRenderingContext, primitive: GLenum, count: number) {
    switch (primitive) {
        case gl.TRIANGLES:
            return count - (count % 3)
        case gl.LINES:
            return count - (count % 2)
        case gl.LINE_LOOP:
        case gl.POINTS:
            return count
        case gl.TRIANGLE_FAN:
        case gl.LINE_STRIP:
            if (count < 2) {
                return 0
            }
            return count
        case gl.TRIANGLE_STRIP:
            if (count < 3) {
                return 0
            }
            return count
        default:
            return -1
    }
}

export function typeSize(gl: GjsifyWebGLRenderingContext, type: GLenum) {
    switch (type) {
        case gl.UNSIGNED_BYTE:
        case gl.BYTE:
            return 1
        case gl.UNSIGNED_SHORT:
        case gl.SHORT:
            return 2
        case gl.UNSIGNED_INT:
        case gl.INT:
        case gl.FLOAT:
            return 4
    }
    return 0
}

export function uniformTypeSize(gl: GjsifyWebGLRenderingContext, type: GLenum) {
    switch (type) {
        case gl.BOOL_VEC4:
        case gl.INT_VEC4:
        case gl.FLOAT_VEC4:
            return 4

        case gl.BOOL_VEC3:
        case gl.INT_VEC3:
        case gl.FLOAT_VEC3:
            return 3

        case gl.BOOL_VEC2:
        case gl.INT_VEC2:
        case gl.FLOAT_VEC2:
            return 2

        case gl.BOOL:
        case gl.INT:
        case gl.FLOAT:
        case gl.SAMPLER_2D:
        case gl.SAMPLER_CUBE:
            return 1

        default:
            return 0
    }
}

export const listToArray = (values: Float32List) => {
    const array: number[] = [];
    for (const value of values.values()) {
        array.push(value)
    }
    return array;
}

export function arrayToUint8Array(array: TypedArray | Float32List | Array<number> | ArrayBuffer | DataView) {

    if(isTypedArray(array as TypedArray | DataView)) {
        return (new Uint8Array((array as TypedArray | DataView).buffer)).subarray(
            (array as TypedArray | DataView).byteOffset,
            (array as TypedArray | DataView).byteLength + (array as TypedArray | DataView).byteOffset)
    }

    if(Array.isArray(array) || array instanceof ArrayBuffer) {
        return new Uint8Array(array);
    }

    if(typeof (array as Float32List).values === 'function') {
        return new Uint8Array(listToArray(array as Float32List))
    }

    throw new Error("Can't unpack typed array!");
}

export function Uint8ArrayToVariant(array: Uint8Array | null) {
    const variant = new GLib.Variant("ay", Array.from(array || []));
    return variant
}

/**
 * Converts an ArrayBufferView to an array of bools. gjs returns
 * Uint8Array, but the elements are actually 4 bytes each.
 * @param array 
 * @returns 
 */
export function boolArray(array: ArrayBufferView) {
    return Array.from(new Int32Array(array.buffer)).map(
        a => a ? true : false);
}

export const extractImageData = (pixels: TexImageSource | GjsifyHTMLImageElement): ImageData | null => {
    const width = (pixels as any).width as number | undefined;
    const height = (pixels as any).height as number | undefined;
    if (typeof pixels === 'object' && typeof width !== 'undefined' && typeof height !== 'undefined') {
        if (typeof (pixels as ImageData).data !== 'undefined') {
            return pixels as ImageData
        }

        let context = null

        if (typeof (pixels as HTMLCanvasElement).getContext === 'function') {
            context = (pixels as HTMLCanvasElement).getContext('2d')
        } else if (typeof (pixels as GjsifyHTMLImageElement).isPixbuf()) {
            return (pixels as GjsifyHTMLImageElement).getImageData();
        } else if (typeof (pixels as HTMLImageElement).src !== 'undefined' && typeof document === 'object' && typeof document.createElement === 'function') {
            const canvas = document.createElement('canvas')

            if (typeof canvas === 'object' && typeof canvas.getContext === 'function') {
                canvas.width = width
                canvas.height = height
                context = canvas.getContext('2d')

                if (context !== null) {
                    context.drawImage(pixels as CanvasImageSource, 0, 0)
                }
            }
        }

        if (context !== null) {
            return context.getImageData(0, 0, width, height)
        }
    }

    return null
}

export function formatSize(gl: GjsifyWebGLRenderingContext, internalFormat: number) {
    switch (internalFormat) {
        case gl.ALPHA:
        case gl.LUMINANCE:
            return 1
        case gl.LUMINANCE_ALPHA:
            return 2
        case gl.RGB:
            return 3
        case gl.RGBA:
            return 4
    }
    return 0
}

export function convertPixels(pixels: ArrayBuffer | Uint8Array | Uint16Array | Uint8ClampedArray | Float32Array | Buffer | ArrayBufferView | null) {
    if (typeof pixels === 'object' && pixels !== null) {
        if (pixels instanceof ArrayBuffer) {
            return new Uint8Array(pixels)
        } else if (pixels instanceof Uint8Array ||
            pixels instanceof Uint16Array ||
            pixels instanceof Uint8ClampedArray ||
            pixels instanceof Float32Array) {
            return arrayToUint8Array(pixels)
        } else if ((pixels as Buffer) instanceof Buffer) {
            return new Uint8Array(pixels as Buffer)
        }
    }
    return null
}

export function checkFormat(gl: GjsifyWebGLRenderingContext, format: GLenum) {
    return (
        format === gl.ALPHA ||
        format === gl.LUMINANCE_ALPHA ||
        format === gl.LUMINANCE ||
        format === gl.RGB ||
        format === gl.RGBA)
}

export function validCubeTarget(gl: GjsifyWebGLRenderingContext, target: GLenum) {
    return target === gl.TEXTURE_CUBE_MAP_POSITIVE_X ||
        target === gl.TEXTURE_CUBE_MAP_NEGATIVE_X ||
        target === gl.TEXTURE_CUBE_MAP_POSITIVE_Y ||
        target === gl.TEXTURE_CUBE_MAP_NEGATIVE_Y ||
        target === gl.TEXTURE_CUBE_MAP_POSITIVE_Z ||
        target === gl.TEXTURE_CUBE_MAP_NEGATIVE_Z
}

export function flag<T = Gwebgl.WebGLRenderingContext.ConstructorProperties> (options: T, name: keyof T, dflt: boolean) {
    if (!options || !(typeof options === 'object') || !(name in options)) {
      return dflt
    }
    return !!options[name]
}