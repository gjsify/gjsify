// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/webstorage/01_webstorage.js

// <reference path="../../core/internal.d.ts" />

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import * as ops from '../../ops/index.js';
import * as webidl from '../../ext/webidl/00_webidl.js';
const {
  SafeArrayIterator,
  Symbol,
  SymbolFor,
  ObjectDefineProperty,
  ObjectFromEntries,
  ObjectEntries,
  ReflectGet,
  ReflectHas,
  Proxy,
} = primordials;

const _persistent = Symbol("[[persistent]]");

/** This Web Storage API interface provides access to a particular domain's
 * session or local storage. It allows, for example, the addition, modification,
 * or deletion of stored data items.
 *
 * @category Web Storage API
 */
export class Storage {

  [name: string]: any;

  // @ts-ignore
  [_persistent]: {
    [key: string]: string;
  };

  constructor() {
    webidl.illegalConstructor();
  }

  /**
   * Returns the number of key/value pairs currently present in the list associated with the object.
   */
  get length(): number {
    webidl.assertBranded(this, StoragePrototype);
    // @ts-ignore
    const persistent = this[_persistent];
    return ops.op_webstorage_length(persistent);
  }

  /**
   * Returns the name of the nth key in the list, or null if n is greater than or equal to the number of key/value pairs in the object.
   */
  key(index: number): string | null {
    webidl.assertBranded(this, StoragePrototype);
    const prefix = "Failed to execute 'key' on 'Storage'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    index = webidl.converters["unsigned long"](index, {
      prefix,
      context: "Argument 1",
    });

    // @ts-ignore
    const persistent = this[_persistent];
    return ops.op_webstorage_key(index, persistent);
  }

  /**
   * Sets the value of the pair identified by key to value, creating a new key/value pair if none existed for key previously.
   *
   * Throws a "QuotaExceededError" DOMException exception if the new value couldn't be set. (Setting could fail if, e.g., the user has disabled storage for the site, or if the quota has been exceeded.)
   */
  setItem(key: string, value: string): void {
    webidl.assertBranded(this, StoragePrototype);
    const prefix = "Failed to execute 'setItem' on 'Storage'";
    webidl.requiredArguments(arguments.length, 2, { prefix });
    key = webidl.converters.DOMString(key, {
      prefix,
      context: "Argument 1",
    });
    value = webidl.converters.DOMString(value, {
      prefix,
      context: "Argument 2",
    });

    // @ts-ignore
    const persistent = this[_persistent];
    ops.op_webstorage_set(key, value, persistent);
  }

  /**
   * Returns the current value associated with the given key, or null if the given key does not exist in the list associated with the object.
   */
  getItem(key: string): string | null {
    webidl.assertBranded(this, StoragePrototype);
    const prefix = "Failed to execute 'getItem' on 'Storage'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    key = webidl.converters.DOMString(key, {
      prefix,
      context: "Argument 1",
    });

    // @ts-ignore
    const persistent = this[_persistent];
    return ops.op_webstorage_get(key, persistent);
  }

  /**
   * Removes the key/value pair with the given key from the list associated with the object, if a key/value pair with the given key exists.
   */
  removeItem(key: string): void {
    webidl.assertBranded(this, StoragePrototype);
    const prefix = "Failed to execute 'removeItem' on 'Storage'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    key = webidl.converters.DOMString(key, {
      prefix,
      context: "Argument 1",
    });

    // @ts-ignore
    const persistent = this[_persistent];
    ops.op_webstorage_remove(key, persistent);
  }

  /**
   * Empties the list associated with the object of all key/value pairs, if there are any.
   */
  clear(): void {
    webidl.assertBranded(this, StoragePrototype);

    // @ts-ignore
    const persistent = this[_persistent];
    ops.op_webstorage_clear(persistent);
  }
}

const StoragePrototype = Storage.prototype;

function createStorage(persistent: boolean) {
  const storage = webidl.createBranded(Storage);
  storage[_persistent] = persistent;

  const proxy = new Proxy(storage, {
    deleteProperty(target, key) {
      if (typeof key == "symbol") {
        delete target[key];
      } else {
        target.removeItem(key);
      }
      return true;
    },
    defineProperty(target, key, descriptor) {
      if (typeof key == "symbol") {
        ObjectDefineProperty(target, key, descriptor);
      } else {
        target.setItem(key, descriptor.value);
      }
      return true;
    },
    get(target, key) {
      if (typeof key == "symbol") return target[key];
      if (ReflectHas(target, key)) {
        // @ts-ignore
        return ReflectGet(...new SafeArrayIterator(arguments));
      } else {
        return target.getItem(key) ?? undefined;
      }
    },
    set(target, key, value) {
      if (typeof key == "symbol") {
        ObjectDefineProperty(target, key, {
          value,
          configurable: true,
        });
      } else {
        target.setItem(key, value);
      }
      return true;
    },
    has(target, p) {
      return p === SymbolFor("Deno.customInspect") ||
        (typeof target.getItem(p)) === "string";
    },
    ownKeys() {
      return ops.op_webstorage_iterate_keys(persistent);
    },
    getOwnPropertyDescriptor(target, key) {
      if (arguments.length === 1) {
        return undefined;
      }
      if (ReflectHas(target, key)) {
        return undefined;
      }
      const value = target.getItem(key);
      if (value === null) {
        return undefined;
      }
      return {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      };
    },
  });

  proxy[SymbolFor("Deno.customInspect")] = function (inspect) {
    return `${this.constructor.name} ${
      inspect({
        length: this.length,
        ...ObjectFromEntries(ObjectEntries(proxy)),
      })
    }`;
  };

  return proxy;
}

let _localStorage;
let _sessionStorage;

export function localStorage() {
  if (!localStorage) {
    _localStorage = createStorage(true);
  }
  return _localStorage;
}

export function sessionStorage() {
  if (!_sessionStorage) {
    _sessionStorage = createStorage(false);
  }
  return _sessionStorage;
}


