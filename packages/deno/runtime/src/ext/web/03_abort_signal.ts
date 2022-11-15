// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/web/03_abort_signal.js

"use strict";

// @ts-check
// <reference path="../../core/internal.d.ts" />

import { primordials } from '../../core/00_primordials.js';
import * as webidl from '../webidl/00_webidl.js';
import { Event, setIsTrusted, defineEventHandler, EventTarget, listenerCount } from './02_event.js';

const {
  Set,
  SetPrototypeAdd,
  SetPrototypeDelete,
  Symbol,
  TypeError,
} = primordials;

import { setTimeout, refTimer, unrefTimer } from './02_timers.js';

export const add = Symbol("[[add]]");
export const signalAbort = Symbol("[[signalAbort]]");
export const remove = Symbol("[[remove]]");
const abortReason = Symbol("[[abortReason]]");
const abortAlgos = Symbol("[[abortAlgos]]");
const signal = Symbol("[[signal]]");
const timerId = Symbol("[[timerId]]");

const illegalConstructorKey = Symbol("illegalConstructorKey");

export class AbortSignal extends EventTarget {
  static abort(reason = undefined) {
    if (reason !== undefined) {
      reason = webidl.converters.any(reason);
    }
    const signal = new AbortSignal(illegalConstructorKey);
    signal[signalAbort](reason);
    return signal;
  }

  static timeout(millis) {
    const prefix = "Failed to call 'AbortSignal.timeout'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    millis = webidl.converters["unsigned long long"](millis, {
      enforceRange: true,
    });

    const signal = new AbortSignal(illegalConstructorKey);
    signal[timerId] = setTimeout(
      () => {
        signal[timerId] = null;
        signal[signalAbort](
          new DOMException("Signal timed out.", "TimeoutError"),
        );
      },
      millis,
    );
    unrefTimer(signal[timerId]);
    return signal;
  }

  [add](algorithm) {
    if (this.aborted) {
      return;
    }
    if (this[abortAlgos] === null) {
      this[abortAlgos] = new Set();
    }
    SetPrototypeAdd(this[abortAlgos], algorithm);
  }

  [signalAbort](
    reason = new DOMException("The signal has been aborted", "AbortError"),
  ) {
    if (this.aborted) {
      return;
    }
    this[abortReason] = reason;
    if (this[abortAlgos] !== null) {
      for (const algorithm of this[abortAlgos]) {
        algorithm();
      }
      this[abortAlgos] = null;
    }
    const event = new Event("abort");
    setIsTrusted(event, true);
    this.dispatchEvent(event);
  }

  [remove](algorithm) {
    this[abortAlgos] && SetPrototypeDelete(this[abortAlgos], algorithm);
  }

  constructor(key = null) {
    if (key != illegalConstructorKey) {
      throw new TypeError("Illegal constructor.");
    }
    super();
    this[abortReason] = undefined;
    this[abortAlgos] = null;
    this[timerId] = null;
    this[webidl.brand] = webidl.brand;
  }

  get aborted() {
    webidl.assertBranded(this, AbortSignalPrototype);
    return this[abortReason] !== undefined;
  }

  get reason() {
    webidl.assertBranded(this, AbortSignalPrototype);
    return this[abortReason];
  }

  throwIfAborted() {
    webidl.assertBranded(this, AbortSignalPrototype);
    if (this[abortReason] !== undefined) {
      throw this[abortReason];
    }
  }

  // `addEventListener` and `removeEventListener` have to be overriden in
  // order to have the timer block the event loop while there are listeners.
  // `[add]` and `[remove]` don't ref and unref the timer because they can
  // only be used by Deno internals, which use it to essentially cancel async
  // ops which would block the event loop.
  addEventListener(...args: any[]) {
    // @ts-ignore
    super.addEventListener(...args);
    if (this[timerId] !== null && listenerCount(this, "abort") > 0) {
      refTimer(this[timerId]);
    }
  }

  removeEventListener(...args: any[]) {
    // @ts-ignore
    super.removeEventListener(...args);
    if (this[timerId] !== null && listenerCount(this, "abort") === 0) {
      unrefTimer(this[timerId]);
    }
  }
}
defineEventHandler(AbortSignal.prototype, "abort");

webidl.configurePrototype(AbortSignal);
export const AbortSignalPrototype = AbortSignal.prototype;

/** A controller object that allows you to abort one or more DOM requests as and
 * when desired.
 *
 * @category Web APIs
 */
export class AbortController {
  // @ts-ignore
  [signal] = new AbortSignal(illegalConstructorKey);

  constructor() {
    this[webidl.brand] = webidl.brand;
  }

  /** Returns the AbortSignal object associated with this object. */
  get signal(): AbortSignal {
    webidl.assertBranded(this, AbortControllerPrototype);
    return this[signal];
  }

  /** Invoking this method will set this object's AbortSignal's aborted flag and
   * signal to any observers that the associated activity is to be aborted. */
  abort(reason?: any): void {
    webidl.assertBranded(this, AbortControllerPrototype);
    this[signal][signalAbort](reason);
  }
}

webidl.configurePrototype(AbortController);
const AbortControllerPrototype = AbortController.prototype;

webidl.converters["AbortSignal"] = webidl.createInterfaceConverter(
  "AbortSignal",
  AbortSignal.prototype,
);

export function newSignal() {
  return new AbortSignal(illegalConstructorKey);
}

export function follow(followingSignal, parentSignal) {
  if (followingSignal.aborted) {
    return;
  }
  if (parentSignal.aborted) {
    followingSignal[signalAbort](parentSignal.reason);
  } else {
    parentSignal[add](() =>
      followingSignal[signalAbort](parentSignal.reason)
    );
  }
}
