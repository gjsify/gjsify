// Registers: FontFace + patches document.fonts

import { FontFace, FontFaceSet } from '../font-face.js';
import { defineGlobalIfMissing } from './helpers.js';

defineGlobalIfMissing('FontFace', FontFace);
if (typeof (globalThis as any).FontFace === 'undefined') {
    (globalThis as any).FontFace = FontFace;
}
// Patch document.fonts stub onto the existing document object
const _doc = (globalThis as any).document;
if (_doc && typeof _doc.fonts === 'undefined') {
    Object.defineProperty(_doc, 'fonts', {
        value: new FontFaceSet(),
        configurable: true,
        writable: true,
    });
}
