// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// https://github.com/denoland/deno/blob/main/ext/web/04_global_interfaces.js

"use strict";

// @ts-check
// <reference path="../../core/internal.d.ts" />
import { primordials } from '../../core/00_primordials.js';
import { EventTarget } from './02_event.js';
const {
  Symbol,
  SymbolToStringTag,
  TypeError,
} = primordials;

const illegalConstructorKey = Symbol("illegalConstructorKey");

export class Window extends EventTarget {
  constructor(key = null) {
    if (key !== illegalConstructorKey) {
      throw new TypeError("Illegal constructor.");
    }
    super();
  }

  get [SymbolToStringTag]() {
    return "Window";
  }
}

export class WorkerGlobalScope extends EventTarget {
  constructor(key = null) {
    if (key != illegalConstructorKey) {
      throw new TypeError("Illegal constructor.");
    }
    super();
  }

  get [SymbolToStringTag]() {
    return "WorkerGlobalScope";
  }
}

export class DedicatedWorkerGlobalScope extends WorkerGlobalScope {
  constructor(key = null) {
    if (key != illegalConstructorKey) {
      throw new TypeError("Illegal constructor.");
    }
    super();
  }

  get [SymbolToStringTag]() {
    return "DedicatedWorkerGlobalScope";
  }
}

export const dedicatedWorkerGlobalScopeConstructorDescriptor = {
  configurable: true,
  enumerable: false,
  value: DedicatedWorkerGlobalScope,
  writable: true,
};

export const windowConstructorDescriptor = {
  configurable: true,
  enumerable: false,
  value: Window,
  writable: true,
};

export const workerGlobalScopeConstructorDescriptor = {
  configurable: true,
  enumerable: false,
  value: WorkerGlobalScope,
  writable: true,
};
