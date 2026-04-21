// Registers XMLHttpRequest / XMLHttpRequestUpload on globalThis.
//
// The Blob → file:// URL chain required by Excalibur's ImageSource / FontFace
// is split across two packages:
//   - `@gjsify/fetch` XHR (this package): when responseType='blob', materialise
//     the response to a GLib temp file and attach `_tmpPath` to the returned
//     Blob.
//   - `@gjsify/url` URL class: `URL.createObjectURL(blob)` reads `_tmpPath`
//     and returns a `file://` URL that HTMLImageElement etc. can load.
//
// There is no URL monkey-patching here — URL owns createObjectURL natively.

import { XMLHttpRequest, XMLHttpRequestUpload } from '../xhr.js';

if (typeof globalThis.XMLHttpRequest === 'undefined') {
  globalThis.XMLHttpRequest = XMLHttpRequest as unknown as typeof globalThis.XMLHttpRequest;
}
if (typeof globalThis.XMLHttpRequestUpload === 'undefined') {
  globalThis.XMLHttpRequestUpload = XMLHttpRequestUpload as unknown as typeof globalThis.XMLHttpRequestUpload;
}
