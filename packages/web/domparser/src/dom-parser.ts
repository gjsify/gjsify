// The WHATWG DOMParser entry point.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/DOMParser

import type { DOMDocument } from './dom/document.js';
import { parseHtml } from './html/tree-builder.js';
import { parseXml } from './xml/parse-xml.js';

/** The WebIDL `DOMParserSupportedType` enum, in the order the spec lists it. */
const SUPPORTED_TYPES = ['text/html', 'text/xml', 'application/xml', 'application/xhtml+xml', 'image/svg+xml'];

export class DOMParser {
    /**
     * The second argument is READ. It used to be ignored, and every call ran the
     * XML scanner whatever it said — including on HTML, where that produces a tree
     * with `<li>` items nested inside one another and `<script>` contents spilled
     * into the document text.
     *
     * An unsupported type THROWS rather than falling back to XML: a caller who
     * passes the wrong type is told once, at the call, instead of receiving a
     * plausible wrong tree (ADR 0026 § Decision 3).
     */
    parseFromString(string: string, mimeType: string): DOMDocument {
        if (mimeType === 'text/html') return parseHtml(string);
        if (SUPPORTED_TYPES.includes(mimeType)) return parseXml(string);
        throw new TypeError(
            "Failed to execute 'parseFromString' on 'DOMParser': the provided value '" +
                mimeType +
                "' is not a valid enum value of type DOMParserSupportedType (" +
                SUPPORTED_TYPES.join(', ') +
                ')',
        );
    }
}
