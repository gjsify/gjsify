// Registers: FontFace + patches document.fonts

import { FontFace, FontFaceSet } from '../font-face.js';
import { defineGlobalIfMissing } from './helpers.js';

/** Module-local typed view of the globals this file reads/writes. */
interface _FontFaceGlobals {
    FontFace?: typeof FontFace;
    document?: { fonts?: FontFaceSet };
}

const g = globalThis as unknown as _FontFaceGlobals;

defineGlobalIfMissing('FontFace', FontFace);
if (typeof g.FontFace === 'undefined') {
    g.FontFace = FontFace;
}
// Patch document.fonts stub onto the existing document object
const _doc = g.document;
if (_doc && typeof _doc.fonts === 'undefined') {
    Object.defineProperty(_doc, 'fonts', {
        value: new FontFaceSet(),
        configurable: true,
        writable: true,
    });
}
