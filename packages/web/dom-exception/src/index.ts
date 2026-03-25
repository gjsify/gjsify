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
export const DOMException: typeof globalThis.DOMException =
  typeof globalThis.DOMException !== 'undefined'
    ? globalThis.DOMException
    : _DOMExceptionPolyfill as any;

// Register as global on GJS if missing
if (typeof globalThis.DOMException === 'undefined') {
  (globalThis as any).DOMException = DOMException;
}

export default DOMException;
