// Registers XMLHttpRequest and XMLHttpRequestUpload on globalThis.
import { XMLHttpRequest, XMLHttpRequestUpload } from '../xhr.js';

if (typeof globalThis.XMLHttpRequest === 'undefined') {
  (globalThis as any).XMLHttpRequest = XMLHttpRequest;
}
if (typeof globalThis.XMLHttpRequestUpload === 'undefined') {
  (globalThis as any).XMLHttpRequestUpload = XMLHttpRequestUpload;
}
