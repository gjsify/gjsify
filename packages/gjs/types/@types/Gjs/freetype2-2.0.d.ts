
/*
 * Type Definitions for Gjs (https://gjs.guide/)
 *
 * These type definitions are automatically generated, do not edit them by hand.
 * If you found a bug fix it in ts-for-gir itself or create a bug report on https://github.com/sammydre/ts-for-gjs
 */
/**
 * freetype2-2.0
 */

import type * as Gjs from './Gjs.js';
import type GObject from './GObject-2.0.js';

export namespace freetype2 {

function library_version(): void
interface Bitmap {
}

class Bitmap {

    // Own properties of freetype2-2.0.freetype2.Bitmap

    static name: string
}

interface Face {
}

class Face {

    // Own properties of freetype2-2.0.freetype2.Face

    static name: string
}

interface Library {
}

class Library {

    // Own properties of freetype2-2.0.freetype2.Library

    static name: string
}

    type Int32 = any
/**
 * Name of the imported GIR library
 * @see https://gitlab.gnome.org/GNOME/gjs/-/blob/master/gi/ns.cpp#L188
 */
const __name__: string
/**
 * Version of the imported GIR library
 * @see https://gitlab.gnome.org/GNOME/gjs/-/blob/master/gi/ns.cpp#L189
 */
const __version__: string
}
export default freetype2;