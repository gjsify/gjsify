// DOMException polyfill for GJS
// Reference: WebIDL Living Standard (https://webidl.spec.whatwg.org/#idl-DOMException)
// Original implementation from @gjsify/dom-events, extracted for independent use.

/** Standard DOMException error code mapping per WebIDL spec */
const DOMExceptionCodes: Record<string, number> = {
    IndexSizeError: 1,
    HierarchyRequestError: 3,
    WrongDocumentError: 4,
    InvalidCharacterError: 5,
    NoModificationAllowedError: 7,
    NotFoundError: 8,
    NotSupportedError: 9,
    InUseAttributeError: 10,
    InvalidStateError: 11,
    SyntaxError: 12,
    InvalidModificationError: 13,
    NamespaceError: 14,
    InvalidAccessError: 15,
    TypeMismatchError: 17,
    SecurityError: 18,
    NetworkError: 19,
    AbortError: 20,
    URLMismatchError: 21,
    QuotaExceededError: 22,
    TimeoutError: 23,
    InvalidNodeTypeError: 24,
    DataCloneError: 25,
};

/** DOMException polyfill — extends Error with standard error codes */
class _DOMExceptionPolyfill extends Error {
    code: number;
    constructor(message?: string, name?: string) {
        super(message);
        this.name = name || 'Error';
        this.code = Object.hasOwn(DOMExceptionCodes, this.name) ? DOMExceptionCodes[this.name] : 0;
    }
}

/**
 * DOMException — uses native implementation if available, polyfill otherwise.
 * Native is available in Node.js 17+ and modern browsers.
 * On GJS, the polyfill is used.
 */
type DOMExceptionShape = Error & { readonly code: number };

// The DOM `DOMException` when the consumer loads `lib.dom`, the structural shape otherwise.
export type DOMException = typeof globalThis extends { DOMException: { prototype: infer T } } ? T : DOMExceptionShape;

export interface DOMExceptionConstructor {
    new (message?: string, name?: string): DOMException;
    readonly prototype: DOMException;
}

// Declared here rather than via `typeof globalThis.DOMException`: the shipped typings must resolve
// without `lib.dom.d.ts`, which a GJS program does not load.
const nativeDOMException = (globalThis as { DOMException?: DOMExceptionConstructor }).DOMException;

export const DOMException: DOMExceptionConstructor = (nativeDOMException ??
    _DOMExceptionPolyfill) as unknown as DOMExceptionConstructor;

// Note: globals are no longer registered at import time. Use the `/register`
// subpath (`import '@gjsify/dom-exception/register'`) if you need
// globalThis.DOMException to be set on GJS.

export default DOMException;
