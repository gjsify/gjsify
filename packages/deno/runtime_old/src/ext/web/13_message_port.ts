// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/web/13_message_port.js

// @ts-check
// <reference path="../../core/lib.deno_core.d.ts" />
// <reference path="../webidl/internal.d.ts" />
// <reference path="./internal.d.ts" />
// <reference path="./lib.deno_web.d.ts" />

"use strict";
import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import * as ops from '../../ops/index.js';
const { InterruptedPrototype } = core;
import * as webidl from '../webidl/00_webidl.js';
import { EventTarget, setEventTargetData, MessageEvent, defineEventHandler } from './02_event.js';
import { DOMException } from './01_dom_exception.js';
import { messagePort } from '../../types/index.js';
const {
  ArrayBufferPrototype,
  ArrayPrototypeFilter,
  ArrayPrototypeIncludes,
  ArrayPrototypePush,
  ObjectPrototypeIsPrototypeOf,
  ObjectSetPrototypeOf,
  Symbol,
  SymbolFor,
  SymbolIterator,
  TypeError,
} = primordials;

/** The MessageChannel interface of the Channel Messaging API allows us to
 * create a new message channel and send data through it via its two MessagePort
 * properties.
 *
 * @category DOM APIs
 */
export class MessageChannel {
  #port1: MessagePort;
  #port2: MessagePort;

  constructor() {
    this[webidl.brand] = webidl.brand;
    const [port1Id, port2Id] = opCreateEntangledMessagePort();
    const port1 = createMessagePort(port1Id);
    const port2 = createMessagePort(port2Id);
    this.#port1 = port1;
    this.#port2 = port2;
  }

  get port1(): MessagePort {
    webidl.assertBranded(this, MessageChannelPrototype);
    return this.#port1;
  }

  get port2(): MessagePort {
    webidl.assertBranded(this, MessageChannelPrototype);
    return this.#port2;
  }

  [SymbolFor("Deno.inspect")](inspect) {
    return `MessageChannel ${
      inspect({ port1: this.port1, port2: this.port2 })
    }`;
  }
}

webidl.configurePrototype(MessageChannel);
const MessageChannelPrototype = MessageChannel.prototype;

const _id = Symbol("id");
const _enabled = Symbol("enabled");

function createMessagePort(id: number): MessagePort {
  const port = core.createHostObject();
  ObjectSetPrototypeOf(port, MessagePortPrototype);
  port[webidl.brand] = webidl.brand;
  setEventTargetData(port);
  port[_id] = id;
  return port as MessagePort;
}

/** The MessagePort interface of the Channel Messaging API represents one of the
 * two ports of a MessageChannel, allowing messages to be sent from one port and
 * listening out for them arriving at the other.
 *
 * @category DOM APIs
 */
export class MessagePort extends EventTarget {
  // @ts-ignore
  [_id]: number | null = null;
  // @ts-ignore
  [_enabled]: boolean = false;

  onmessage: ((this: MessagePort, ev: MessageEvent) => any) | null;
  onmessageerror: ((this: MessagePort, ev: MessageEvent) => any) | null;

  addEventListener<K extends keyof MessagePortEventMap>(
    type: K,
    listener: (this: MessagePort, ev: MessagePortEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }
  removeEventListener<K extends keyof MessagePortEventMap>(
    type: K,
    listener: (this: MessagePort, ev: MessagePortEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
  }

  constructor() {
    super();
    webidl.illegalConstructor();
  }

  /**
   * Posts a message through the channel. Objects listed in transfer are
   * transferred, not just cloned, meaning that they are no longer usable on the
   * sending side.
   *
   * Throws a "DataCloneError" DOMException if transfer contains duplicate
   * objects or port, or if message could not be cloned.
   */
  postMessage(message: any, transfer: Transferable[]): void;
  postMessage(message: any, options?: StructuredSerializeOptions): void;
  postMessage(message: any, transferOrOptions: object[] | StructuredSerializeOptions = {}) {
    webidl.assertBranded(this, MessagePortPrototype);
    const prefix = "Failed to execute 'postMessage' on 'MessagePort'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    message = webidl.converters.any(message);
    let options;
    if (
      webidl.type(transferOrOptions) === "Object" &&
      transferOrOptions !== undefined &&
      transferOrOptions[SymbolIterator] !== undefined
    ) {
      const transfer = webidl.converters["sequence<object>"](
        transferOrOptions,
        { prefix, context: "Argument 2" },
      );
      options = { transfer };
    } else {
      options = webidl.converters.StructuredSerializeOptions(
        transferOrOptions,
        {
          prefix,
          context: "Argument 2",
        },
      );
    }
    const { transfer } = options;
    if (ArrayPrototypeIncludes(transfer, this)) {
      throw new DOMException("Can not tranfer self", "DataCloneError");
    }
    const data = serializeJsMessageData(message, transfer);
    if (this[_id] === null) return;
    ops.op_message_port_post_message(this[_id], data);
  }

  /**
   * Begins dispatching messages received on the port. This is implicitly called
   * when assigning a value to `this.onmessage`.
   */
  start(): void {
    webidl.assertBranded(this, MessagePortPrototype);
    if (this[_enabled]) return;
    (async () => {
      this[_enabled] = true;
      while (true) {
        if (this[_id] === null) break;
        let data;
        try {
          data = await core.opAsync(
            "op_message_port_recv_message",
            this[_id],
          );
        } catch (err) {
          if (ObjectPrototypeIsPrototypeOf(InterruptedPrototype, err)) break;
          throw err;
        }
        if (data === null) break;
        let message, transferables;
        try {
          const v = deserializeJsMessageData(data);
          message = v[0];
          transferables = v[1];
        } catch (err) {
          const event = new MessageEvent("messageerror", { data: err });
          this.dispatchEvent(event);
          return;
        }
        const event = new MessageEvent("message", {
          data: message,
          ports: ArrayPrototypeFilter(
            transferables,
            (t) => ObjectPrototypeIsPrototypeOf(MessagePortPrototype, t),
          ),
        });
        this.dispatchEvent(event);
      }
      this[_enabled] = false;
    })();
  }

  /**
   * Disconnects the port, so that it is no longer active.
   */
  close(): void {
    webidl.assertBranded(this, MessagePortPrototype);
    if (this[_id] !== null) {
      core.close(this[_id]);
      this[_id] = null;
    }
  }
}

defineEventHandler(MessagePort.prototype, "message", function (self) {
  self.start();
});
defineEventHandler(MessagePort.prototype, "messageerror");

webidl.configurePrototype(MessagePort);
export const MessagePortPrototype = MessagePort.prototype;

function opCreateEntangledMessagePort(): [number, number] {
  return ops.op_message_port_create_entangled();
}

export function deserializeJsMessageData(messageData: messagePort.MessageData): [any, object[]] {
  /** @type {object[]} */
  const transferables = [];
  const hostObjects = [];
  const arrayBufferIdsInTransferables = [];
  const transferredArrayBuffers = [];

  for (const transferable of messageData.transferables) {
    switch (transferable.kind) {
      case "messagePort": {
        const port = createMessagePort(transferable.data);
        ArrayPrototypePush(transferables, port);
        ArrayPrototypePush(hostObjects, port);
        break;
      }
      case "arrayBuffer": {
        ArrayPrototypePush(transferredArrayBuffers, transferable.data);
        const i = ArrayPrototypePush(transferables, null);
        ArrayPrototypePush(arrayBufferIdsInTransferables, i);
        break;
      }
      default:
        throw new TypeError("Unreachable");
    }
  }

  const data = core.deserialize(messageData.data, {
    hostObjects,
    transferredArrayBuffers,
  });

  for (const i in arrayBufferIdsInTransferables) {
    const id = arrayBufferIdsInTransferables[i];
    transferables[id] = transferredArrayBuffers[i];
  }

  return [data, transferables];
}

export function serializeJsMessageData(data: any, transferables: object[]): messagePort.MessageData {
  const transferredArrayBuffers = [];
  for (let i = 0, j = 0; i < transferables.length; i++) {
    const ab = transferables[i];
    if (ObjectPrototypeIsPrototypeOf(ArrayBufferPrototype, ab)) {
      if ((ab as ArrayBuffer).byteLength === 0 && ops.op_arraybuffer_was_detached(ab as ArrayBuffer)) {
        throw new DOMException(
          `ArrayBuffer at index ${j} is already detached`,
          "DataCloneError",
        );
      }
      j++;
      transferredArrayBuffers.push(ab);
    }
  }

  const serializedData = core.serialize(data, {
    hostObjects: ArrayPrototypeFilter(
      transferables,
      (a) => ObjectPrototypeIsPrototypeOf(MessagePortPrototype, a),
    ),
    transferredArrayBuffers,
  }, (err) => {
    throw new DOMException(err, "DataCloneError");
  });

  const serializedTransferables: messagePort.Transferable[] = [];

  let arrayBufferI = 0;
  for (const transferable of transferables) {
    if (ObjectPrototypeIsPrototypeOf(MessagePortPrototype, transferable)) {
      webidl.assertBranded(transferable, MessagePortPrototype);
      const id = transferable[_id];
      if (id === null) {
        throw new DOMException(
          "Can not transfer disentangled message port",
          "DataCloneError",
        );
      }
      transferable[_id] = null;
      ArrayPrototypePush(serializedTransferables, {
        kind: "messagePort",
        data: id,
      });
    } else if (
      ObjectPrototypeIsPrototypeOf(ArrayBufferPrototype, transferable)
    ) {
      ArrayPrototypePush(serializedTransferables, {
        kind: "arrayBuffer",
        data: transferredArrayBuffers[arrayBufferI],
      });
      arrayBufferI++;
    } else {
      throw new DOMException("Value not transferable", "DataCloneError");
    }
  }

  return {
    data: serializedData,
    transferables: serializedTransferables,
  };
}

webidl.converters.StructuredSerializeOptions = webidl
  .createDictionaryConverter(
    "StructuredSerializeOptions",
    [
      {
        key: "transfer",
        converter: webidl.converters["sequence<object>"],
        get defaultValue() {
          return [];
        },
      },
    ],
  );

// TODO see also packages/deno/runtime/src/ext/web/02_structured_clone.ts
/**
 * Creates a deep copy of a given value using the structured clone algorithm.
 *
 * Unlike a shallow copy, a deep copy does not hold the same references as the
 * source object, meaning its properties can be changed without affecting the
 * source. For more details, see
 * [MDN](https://developer.mozilla.org/en-US/docs/Glossary/Deep_copy).
 *
 * Throws a `DataCloneError` if any part of the input value is not
 * serializable.
 *
 * @example
 * ```ts
 * const object = { x: 0, y: 1 };
 *
 * const deepCopy = structuredClone(object);
 * deepCopy.x = 1;
 * console.log(deepCopy.x, object.x); // 1 0
 *
 * const shallowCopy = object;
 * shallowCopy.x = 1;
 * // shallowCopy.x is pointing to the same location in memory as object.x
 * console.log(shallowCopy.x, object.x); // 1 1
 * ```
 *
 * @category DOM APIs
 */
export function structuredClone(value: any, options?: StructuredSerializeOptions) {
  const prefix = "Failed to execute 'structuredClone'";
  webidl.requiredArguments(arguments.length, 1, { prefix });
  options = webidl.converters.StructuredSerializeOptions(options, {
    prefix,
    context: "Argument 2",
  });
  const messageData = serializeJsMessageData(value, options.transfer);
  const [data] = deserializeJsMessageData(messageData);
  return data;
}
