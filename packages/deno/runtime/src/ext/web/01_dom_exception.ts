// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/web/01_dom_exception.js

// @ts-check
// <reference path="../../core/internal.d.ts" />
// <reference path="../../core/lib.deno_core.d.ts" />
// <reference path="../webidl/internal.d.ts" />
// <reference path="../web/internal.d.ts" />
// <reference path="../web/lib.deno_web.d.ts" />

"use strict";

import { primordials } from '@gjsify/deno_core';
import * as webidl from '../webidl/00_webidl.js';
import * as consoleInternal from '../console/02_console.js';

const {
  ArrayPrototypeSlice,
  Error,
  ErrorPrototype,
  ObjectDefineProperty,
  ObjectCreate,
  ObjectEntries,
  ObjectPrototypeIsPrototypeOf,
  ObjectSetPrototypeOf,
  Symbol,
  SymbolFor,
} = primordials;

const _name = Symbol("name");
const _message = Symbol("message");
const _code = Symbol("code");

// Defined in WebIDL 4.3.
// https://webidl.spec.whatwg.org/#idl-DOMException
const INDEX_SIZE_ERR = 1;
const DOMSTRING_SIZE_ERR = 2;
const HIERARCHY_REQUEST_ERR = 3;
const WRONG_DOCUMENT_ERR = 4;
const INVALID_CHARACTER_ERR = 5;
const NO_DATA_ALLOWED_ERR = 6;
const NO_MODIFICATION_ALLOWED_ERR = 7;
const NOT_FOUND_ERR = 8;
const NOT_SUPPORTED_ERR = 9;
const INUSE_ATTRIBUTE_ERR = 10;
const INVALID_STATE_ERR = 11;
const SYNTAX_ERR = 12;
const INVALID_MODIFICATION_ERR = 13;
const NAMESPACE_ERR = 14;
const INVALID_ACCESS_ERR = 15;
const VALIDATION_ERR = 16;
const TYPE_MISMATCH_ERR = 17;
const SECURITY_ERR = 18;
const NETWORK_ERR = 19;
const ABORT_ERR = 20;
const URL_MISMATCH_ERR = 21;
const QUOTA_EXCEEDED_ERR = 22;
const TIMEOUT_ERR = 23;
const INVALID_NODE_TYPE_ERR = 24;
const DATA_CLONE_ERR = 25;

// Defined in WebIDL 2.8.1.
// https://webidl.spec.whatwg.org/#dfn-error-names-table
/** @type {Record<string, number>} */
// the prototype should be null, to prevent user code from looking
// up Object.prototype properties, such as "toString"
const nameToCodeMapping = ObjectCreate(null, {
  IndexSizeError: { value: INDEX_SIZE_ERR },
  HierarchyRequestError: { value: HIERARCHY_REQUEST_ERR },
  WrongDocumentError: { value: WRONG_DOCUMENT_ERR },
  InvalidCharacterError: { value: INVALID_CHARACTER_ERR },
  NoModificationAllowedError: { value: NO_MODIFICATION_ALLOWED_ERR },
  NotFoundError: { value: NOT_FOUND_ERR },
  NotSupportedError: { value: NOT_SUPPORTED_ERR },
  InUseAttributeError: { value: INUSE_ATTRIBUTE_ERR },
  InvalidStateError: { value: INVALID_STATE_ERR },
  SyntaxError: { value: SYNTAX_ERR },
  InvalidModificationError: { value: INVALID_MODIFICATION_ERR },
  NamespaceError: { value: NAMESPACE_ERR },
  InvalidAccessError: { value: INVALID_ACCESS_ERR },
  TypeMismatchError: { value: TYPE_MISMATCH_ERR },
  SecurityError: { value: SECURITY_ERR },
  NetworkError: { value: NETWORK_ERR },
  AbortError: { value: ABORT_ERR },
  URLMismatchError: { value: URL_MISMATCH_ERR },
  QuotaExceededError: { value: QUOTA_EXCEEDED_ERR },
  TimeoutError: { value: TIMEOUT_ERR },
  InvalidNodeTypeError: { value: INVALID_NODE_TYPE_ERR },
  DataCloneError: { value: DATA_CLONE_ERR },
});

// Defined in WebIDL 4.3.
// https://webidl.spec.whatwg.org/#idl-DOMException
/** @category DOM Events */
export class DOMException {
  // @ts-ignore
  [_message]: string;
  // @ts-ignore
  [_name]: string;
  // @ts-ignore
  [_code]: number;

  // https://webidl.spec.whatwg.org/#dom-domexception-domexception
  constructor(message: string = "", name: string = "Error") {
    message = webidl.converters.DOMString(message, {
      prefix: "Failed to construct 'DOMException'",
      context: "Argument 1",
    });
    name = webidl.converters.DOMString(name, {
      prefix: "Failed to construct 'DOMException'",
      context: "Argument 2",
    });
    const code = nameToCodeMapping[name] ?? 0;

    this[_message] = message;
    this[_name] = name;
    this[_code] = code;
    this[webidl.brand] = webidl.brand;

    const error = new Error(message);
    error.name = "DOMException";
    ObjectDefineProperty(this, "stack", {
      value: error.stack,
      writable: true,
      configurable: true,
    });

    // `DOMException` isn't a native error, so `Error.prepareStackTrace()` is
    // not called when accessing `.stack`, meaning our structured stack trace
    // hack doesn't apply. This patches it in.
    ObjectDefineProperty(this, "__callSiteEvals", {
      value: ArrayPrototypeSlice((error as any).__callSiteEvals, 1),
      configurable: true,
    });
  }

  get message(): string {
    webidl.assertBranded(this, DOMExceptionPrototype);
    return this[_message];
  }

  get name(): string {
    webidl.assertBranded(this, DOMExceptionPrototype);
    return this[_name];
  }

  get code(): number {
    webidl.assertBranded(this, DOMExceptionPrototype);
    return this[_code];
  }

  [SymbolFor("Deno.customInspect")](inspect) {
    if (ObjectPrototypeIsPrototypeOf(DOMExceptionPrototype, this)) {
      return `DOMException: ${this[_message]}`;
    } else {
      return inspect(consoleInternal.createFilteredInspectProxy({
        object: this,
        evaluate: false,
        keys: [
          "message",
          "name",
          "code",
        ],
      }));
    }
  }
}

ObjectSetPrototypeOf(DOMException.prototype, ErrorPrototype);

webidl.configurePrototype(DOMException);
const DOMExceptionPrototype = DOMException.prototype;

for (
  const [key, value] of ObjectEntries({
    INDEX_SIZE_ERR,
    DOMSTRING_SIZE_ERR,
    HIERARCHY_REQUEST_ERR,
    WRONG_DOCUMENT_ERR,
    INVALID_CHARACTER_ERR,
    NO_DATA_ALLOWED_ERR,
    NO_MODIFICATION_ALLOWED_ERR,
    NOT_FOUND_ERR,
    NOT_SUPPORTED_ERR,
    INUSE_ATTRIBUTE_ERR,
    INVALID_STATE_ERR,
    SYNTAX_ERR,
    INVALID_MODIFICATION_ERR,
    NAMESPACE_ERR,
    INVALID_ACCESS_ERR,
    VALIDATION_ERR,
    TYPE_MISMATCH_ERR,
    SECURITY_ERR,
    NETWORK_ERR,
    ABORT_ERR,
    URL_MISMATCH_ERR,
    QUOTA_EXCEEDED_ERR,
    TIMEOUT_ERR,
    INVALID_NODE_TYPE_ERR,
    DATA_CLONE_ERR,
  })
) {
  const desc = { value, enumerable: true };
  ObjectDefineProperty(DOMException, key, desc);
  ObjectDefineProperty(DOMException.prototype, key, desc);
}

