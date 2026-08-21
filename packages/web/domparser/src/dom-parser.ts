// The WHATWG DOMParser entry point.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/DOMParser

import type { DOMDocument } from './dom/document.js';
import { parseXml } from './xml/parse-xml.js';

export class DOMParser {
    parseFromString(string: string, _mimeType: string): DOMDocument {
        return parseXml(string);
    }
}
