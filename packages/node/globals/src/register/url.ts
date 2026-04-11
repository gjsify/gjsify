// Registers: URL, URLSearchParams (GLib.Uri-based)

import { URL, URLSearchParams } from '@gjsify/url';

if (typeof globalThis.URL !== 'function') {
  Object.defineProperty(globalThis, 'URL', {
    value: URL,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

if (typeof globalThis.URLSearchParams !== 'function') {
  Object.defineProperty(globalThis, 'URLSearchParams', {
    value: URLSearchParams,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}
