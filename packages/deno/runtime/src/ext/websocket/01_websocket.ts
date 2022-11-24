// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/websocket/01_websocket.js

"use strict";

/// <reference path="../../core/internal.d.ts" />

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import * as ops from '../../ops/index.js';
import { URL } from '../url/00_url.js';
import * as webidl from '../webidl/00_webidl.js';
import { HTTP_TOKEN_CODE_POINT_RE } from '../web/00_infra.js';
import { DOMException } from '../web/01_dom_exception.js';
import { Event, ErrorEvent, CloseEvent, MessageEvent, defineEventHandler, EventTarget } from '../web/02_event.js';
import { Blob, BlobPrototype } from '../web/09_file.js';

import type { TypedArray } from '../../types/index.js';

const {
  ArrayBufferPrototype,
  ArrayBufferIsView,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypeSome,
  ErrorPrototypeToString,
  ObjectDefineProperties,
  ObjectPrototypeIsPrototypeOf,
  PromisePrototypeThen,
  RegExpPrototypeTest,
  Set,
  StringPrototypeEndsWith,
  StringPrototypeToLowerCase,
  Symbol,
  SymbolIterator,
  PromisePrototypeCatch,
  queueMicrotask,
  SymbolFor,
  Uint8Array,
} = primordials;

webidl.converters["sequence<DOMString> or DOMString"] = (V, opts) => {
  // Union for (sequence<DOMString> or DOMString)
  if (webidl.type(V) === "Object" && V !== null) {
    if (V[SymbolIterator] !== undefined) {
      return webidl.converters["sequence<DOMString>"](V, opts);
    }
  }
  return webidl.converters.DOMString(V, opts);
};

webidl.converters["WebSocketSend"] = (V, opts) => {
  // Union for (Blob or ArrayBufferView or ArrayBuffer or USVString)
  if (ObjectPrototypeIsPrototypeOf(BlobPrototype, V)) {
    return webidl.converters["Blob"](V, opts);
  }
  if (typeof V === "object") {
    // TODO(littledivy): use primordial for SharedArrayBuffer
    if (
      ObjectPrototypeIsPrototypeOf(ArrayBufferPrototype, V) ||
      ObjectPrototypeIsPrototypeOf(SharedArrayBuffer.prototype, V)
    ) {
      return webidl.converters["ArrayBuffer"](V, opts);
    }
    if (ArrayBufferIsView(V)) {
      return webidl.converters["ArrayBufferView"](V, opts);
    }
  }
  return webidl.converters["USVString"](V, opts);
};

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

export const _readyState = Symbol("[[readyState]]");
const _url = Symbol("[[url]]");
export const _rid = Symbol("[[rid]]");
const _extensions = Symbol("[[extensions]]");
export const _protocol = Symbol("[[protocol]]");
const _binaryType = Symbol("[[binaryType]]");
const _bufferedAmount = Symbol("[[bufferedAmount]]");
export const _eventLoop = Symbol("[[eventLoop]]");

export const _server = Symbol("[[server]]");
export const _idleTimeoutDuration = Symbol("[[idleTimeout]]");
export const _idleTimeoutTimeout = Symbol("[[idleTimeoutTimeout]]");
export const _serverHandleIdleTimeout = Symbol("[[serverHandleIdleTimeout]]");

/**
 * Provides the API for creating and managing a WebSocket connection to a
 * server, as well as for sending and receiving data on the connection.
 *
 * If you are looking to create a WebSocket server, please take a look at
 * `Deno.upgradeWebSocket()`.
 *
 * @tags allow-net
 * @category Web Sockets
 */
export class WebSocket extends EventTarget {

  static readonly CLOSED: number;
  static readonly CLOSING: number;
  static readonly CONNECTING: number;
  static readonly OPEN: number;

  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
  //@ts-ignore
  onerror: ((this: WebSocket, ev: Event | ErrorEvent) => any) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
  onopen: ((this: WebSocket, ev: Event) => any) | null = null;

  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    return super.addEventListener(type, listener, options);
  }
  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    return super.removeEventListener(type, listener, options);
  }

  // @ts-ignore
  [_rid]: number;
  // @ts-ignore
  [_readyState] = CONNECTING;

  /**
   * Returns the state of the WebSocket object's connection. It can have the values described below.
   */
  get readyState(): number {
    webidl.assertBranded(this, WebSocketPrototype);
    return this[_readyState];
  }

  get CONNECTING() {
    webidl.assertBranded(this, WebSocketPrototype);
    return CONNECTING;
  }
  get OPEN() {
    webidl.assertBranded(this, WebSocketPrototype);
    return OPEN;
  }
  get CLOSING() {
    webidl.assertBranded(this, WebSocketPrototype);
    return CLOSING;
  }
  get CLOSED() {
    webidl.assertBranded(this, WebSocketPrototype);
    return CLOSED;
  }

  // @ts-ignore
  [_extensions]: string = "";

  /**
   * Returns the extensions selected by the server, if any.
   */
  get extensions() {
    webidl.assertBranded(this, WebSocketPrototype);
    return this[_extensions];
  }

  // @ts-ignore
  [_protocol]: string = "";

  /**
   * Returns the subprotocol selected by the server, if any. It can be used in conjunction with the array form of the constructor's second argument to perform subprotocol negotiation.
   */
  get protocol(): string {
    webidl.assertBranded(this, WebSocketPrototype);
    return this[_protocol];
  }

  // @ts-ignore
  [_url]: string = "";

  /**
   * Returns the URL that was used to establish the WebSocket connection.
   */
  get url(): string {
    webidl.assertBranded(this, WebSocketPrototype);
    return this[_url];
  }

  // @ts-ignore
  [_binaryType]: "blob" | "arraybuffer" = "blob";

  /**
   * Returns a string that indicates how binary data from the WebSocket object is exposed to scripts:
   *
   * Can be set, to change how binary data is returned. The default is "blob".
   */
  get binaryType() {
    webidl.assertBranded(this, WebSocketPrototype);
    return this[_binaryType];
  }
  set binaryType(value) {
    webidl.assertBranded(this, WebSocketPrototype);
    // @ts-ignore
    value = webidl.converters.DOMString(value, {
      prefix: "Failed to set 'binaryType' on 'WebSocket'",
    });
    if (value === "blob" || value === "arraybuffer") {
      this[_binaryType] = value;
    }
  }

  // @ts-ignore
  [_bufferedAmount]: number = 0;

  /**
   * Returns the number of bytes of application data (UTF-8 text and binary data) that have been queued using send() but not yet been transmitted to the network.
   *
   * If the WebSocket connection is closed, this attribute's value will only increase with each call to the send() method. (The number does not reset to zero once the connection closes.)
   */
  get bufferedAmount() {
    webidl.assertBranded(this, WebSocketPrototype);
    return this[_bufferedAmount];
  }

  constructor(url: string | URL, protocols: string | string[] = []) {
    super();
    this[webidl.brand] = webidl.brand;
    const prefix = "Failed to construct 'WebSocket'";
    webidl.requiredArguments(arguments.length, 1, {
      prefix,
    });
    url = webidl.converters.USVString(url, {
      prefix,
      context: "Argument 1",
    });
    protocols = webidl.converters["sequence<DOMString> or DOMString"](
      protocols,
      {
        prefix,
        context: "Argument 2",
      },
    );

    let wsURL: URL;

    try {
      wsURL = new URL(url);
    } catch (e) {
      throw new DOMException(e.message, "SyntaxError");
    }

    if (wsURL.protocol !== "ws:" && wsURL.protocol !== "wss:") {
      throw new DOMException(
        "Only ws & wss schemes are allowed in a WebSocket URL.",
        "SyntaxError",
      );
    }

    if (wsURL.hash !== "" || StringPrototypeEndsWith(wsURL.href, "#")) {
      throw new DOMException(
        "Fragments are not allowed in a WebSocket URL.",
        "SyntaxError",
      );
    }

    this[_url] = wsURL.href;

    ops.op_ws_check_permission_and_cancel_handle(
      "WebSocket.abort()",
      this[_url],
      false,
    );

    if (typeof protocols === "string") {
      protocols = [protocols];
    }

    if (
      protocols.length !==
        new Set(
          ArrayPrototypeMap(protocols, (p) => StringPrototypeToLowerCase(p)),
        ).size
    ) {
      throw new DOMException(
        "Can't supply multiple times the same protocol.",
        "SyntaxError",
      );
    }

    if (
      ArrayPrototypeSome(
        protocols,
        (protocol) =>
          !RegExpPrototypeTest(HTTP_TOKEN_CODE_POINT_RE, protocol),
      )
    ) {
      throw new DOMException(
        "Invalid protocol value.",
        "SyntaxError",
      );
    }

    PromisePrototypeThen(
      core.opAsync(
        "op_ws_create",
        "new WebSocket()",
        wsURL.href,
        ArrayPrototypeJoin(protocols, ", "),
      ),
      (create) => {
        this[_rid] = create.rid;
        this[_extensions] = create.extensions;
        this[_protocol] = create.protocol;

        if (this[_readyState] === CLOSING) {
          PromisePrototypeThen(
            core.opAsync("op_ws_close", this[_rid]),
            () => {
              this[_readyState] = CLOSED;

              const errEvent = new ErrorEvent("error");
              this.dispatchEvent(errEvent);

              const event = new CloseEvent("close");
              this.dispatchEvent(event);
              core.tryClose(this[_rid]);
            },
          );
        } else {
          this[_readyState] = OPEN;
          const event = new Event("open");
          this.dispatchEvent(event);

          this[_eventLoop]();
        }
      },
      (err) => {
        this[_readyState] = CLOSED;

        const errorEv = new ErrorEvent(
          "error",
          { error: err, message: ErrorPrototypeToString(err) },
        );
        this.dispatchEvent(errorEv);

        const closeEv = new CloseEvent("close");
        this.dispatchEvent(closeEv);
      },
    );
  }

  /**
   * Transmits data using the WebSocket connection. data can be a string, a Blob, an ArrayBuffer, or an ArrayBufferView.
   */
   send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    webidl.assertBranded(this, WebSocketPrototype);
    const prefix = "Failed to execute 'send' on 'WebSocket'";

    webidl.requiredArguments(arguments.length, 1, {
      prefix,
    });
    data = webidl.converters.WebSocketSend(data, {
      prefix,
      context: "Argument 1",
    });

    if (this[_readyState] !== OPEN) {
      throw new DOMException("readyState not OPEN", "InvalidStateError");
    }

    if (typeof data === "string") {
      // try to send in one go!
      const d = core.byteLength(data);
      const sent = ops.op_ws_try_send_string(this[_rid], data);
      this[_bufferedAmount] += d;
      if (!sent) {
        PromisePrototypeThen(
          core.opAsync("op_ws_send_string", this[_rid], data),
          () => {
            this[_bufferedAmount] -= d;
          },
        );
      } else {
        // Spec expects data to be start flushing on next tick but oh well...
        // we already sent it so we can just decrement the bufferedAmount
        // on the next tick.
        queueMicrotask(() => {
          this[_bufferedAmount] -= d;
        });
      }
      return;
    }

    const sendTypedArray = (ta: TypedArray) => {
      // try to send in one go!
      const sent = ops.op_ws_try_send_binary(this[_rid], ta);
      this[_bufferedAmount] += ta.byteLength;
      if (!sent) {
        PromisePrototypeThen(
          core.opAsync("op_ws_send_binary", this[_rid], ta),
          () => {
            this[_bufferedAmount] -= ta.byteLength;
          },
        );
      } else {
        // Spec expects data to be start flushing on next tick but oh well...
        // we already sent it so we can just decrement the bufferedAmount
        // on the next tick.
        queueMicrotask(() => {
          this[_bufferedAmount] -= ta.byteLength;
        });
      }
    };

    if (ObjectPrototypeIsPrototypeOf(ArrayBufferPrototype, data)) {
      sendTypedArray(new Uint8Array(data as ArrayBuffer));
    } else if (ArrayBufferIsView(data)) {
      sendTypedArray(data);
    } else if (ObjectPrototypeIsPrototypeOf(BlobPrototype, data)) {
      PromisePrototypeThen(
        (data.slice(0) as Blob).arrayBuffer(),
        (ab) => sendTypedArray(new Uint8Array(ab)),
      );
    }
  }

  /**
   * Closes the WebSocket connection, optionally using code as the the WebSocket connection close code and reason as the the WebSocket connection close reason.
   */
   close(code?: number, reason?: string): void {
    webidl.assertBranded(this, WebSocketPrototype);
    const prefix = "Failed to execute 'close' on 'WebSocket'";

    if (code !== undefined) {
      code = webidl.converters["unsigned short"](code, {
        prefix,
        clamp: true,
        context: "Argument 1",
      });
    }

    if (reason !== undefined) {
      reason = webidl.converters.USVString(reason, {
        prefix,
        context: "Argument 2",
      });
    }

    if (!this[_server]) {
      if (
        code !== undefined &&
        !(code === 1000 || (3000 <= code && code < 5000))
      ) {
        throw new DOMException(
          "The close code must be either 1000 or in the range of 3000 to 4999.",
          "InvalidAccessError",
        );
      }
    }

    if (reason !== undefined && core.encode(reason).byteLength > 123) {
      throw new DOMException(
        "The close reason may not be longer than 123 bytes.",
        "SyntaxError",
      );
    }

    if (this[_readyState] === CONNECTING) {
      this[_readyState] = CLOSING;
    } else if (this[_readyState] === OPEN) {
      this[_readyState] = CLOSING;

      PromisePrototypeCatch(
        core.opAsync("op_ws_close", this[_rid], code, reason),
        (err) => {
          this[_readyState] = CLOSED;

          const errorEv = new ErrorEvent("error", {
            error: err,
            message: ErrorPrototypeToString(err),
          });
          this.dispatchEvent(errorEv);

          const closeEv = new CloseEvent("close");
          this.dispatchEvent(closeEv);
          core.tryClose(this[_rid]);
        },
      );
    }
  }

  async [_eventLoop]() {
    while (this[_readyState] !== CLOSED) {
      const { kind, value } = await core.opAsync(
        "op_ws_next_event",
        this[_rid],
      );

      switch (kind) {
        case "string": {
          this[_serverHandleIdleTimeout]();
          const event = new MessageEvent("message", {
            data: value,
            origin: this[_url],
          });
          this.dispatchEvent(event);
          break;
        }
        case "binary": {
          this[_serverHandleIdleTimeout]();
          let data;

          if (this.binaryType === "blob") {
            data = new Blob([value]);
          } else {
            data = value.buffer;
          }

          const event = new MessageEvent("message", {
            data,
            origin: this[_url],
          });
          this.dispatchEvent(event);
          break;
        }
        case "ping": {
          core.opAsync("op_ws_send", this[_rid], {
            kind: "pong",
          });
          break;
        }
        case "pong": {
          this[_serverHandleIdleTimeout]();
          break;
        }
        case "closed":
        case "close": {
          const prevState = this[_readyState];
          this[_readyState] = CLOSED;
          clearTimeout(this[_idleTimeoutTimeout]);

          if (prevState === OPEN) {
            try {
              await core.opAsync(
                "op_ws_close",
                this[_rid],
                value.code,
                value.reason,
              );
            } catch {
              // ignore failures
            }
          }

          const event = new CloseEvent("close", {
            wasClean: true,
            code: value.code,
            reason: value.reason,
          });
          this.dispatchEvent(event);
          core.tryClose(this[_rid]);
          break;
        }
        case "error": {
          this[_readyState] = CLOSED;

          const errorEv = new ErrorEvent("error", {
            message: value,
          });
          this.dispatchEvent(errorEv);

          const closeEv = new CloseEvent("close");
          this.dispatchEvent(closeEv);
          core.tryClose(this[_rid]);
          break;
        }
      }
    }
  }

  [_serverHandleIdleTimeout]() {
    if (this[_idleTimeoutDuration]) {
      clearTimeout(this[_idleTimeoutTimeout]);
      this[_idleTimeoutTimeout] = setTimeout(async () => {
        if (this[_readyState] === OPEN) {
          await core.opAsync("op_ws_send", this[_rid], {
            kind: "ping",
          });
          this[_idleTimeoutTimeout] = setTimeout(async () => {
            if (this[_readyState] === OPEN) {
              this[_readyState] = CLOSING;
              const reason = "No response from ping frame.";
              await core.opAsync("op_ws_close", this[_rid], 1001, reason);
              this[_readyState] = CLOSED;

              const errEvent = new ErrorEvent("error", {
                message: reason,
              });
              this.dispatchEvent(errEvent);

              const event = new CloseEvent("close", {
                wasClean: false,
                code: 1001,
                reason,
              });
              this.dispatchEvent(event);
              core.tryClose(this[_rid]);
            } else {
              clearTimeout(this[_idleTimeoutTimeout]);
            }
          }, (this[_idleTimeoutDuration] / 2) * 1000);
        } else {
          clearTimeout(this[_idleTimeoutTimeout]);
        }
      }, (this[_idleTimeoutDuration] / 2) * 1000);
    }
  }

  [SymbolFor("Deno.customInspect")](inspect) {
    return `${this.constructor.name} ${
      inspect({
        url: this.url,
        readyState: this.readyState,
        extensions: this.extensions,
        protocol: this.protocol,
        binaryType: this.binaryType,
        bufferedAmount: this.bufferedAmount,
      })
    }`;
  }
}

ObjectDefineProperties(WebSocket, {
  CONNECTING: {
    value: 0,
  },
  OPEN: {
    value: 1,
  },
  CLOSING: {
    value: 2,
  },
  CLOSED: {
    value: 3,
  },
});

defineEventHandler(WebSocket.prototype, "message");
defineEventHandler(WebSocket.prototype, "error");
defineEventHandler(WebSocket.prototype, "close");
defineEventHandler(WebSocket.prototype, "open");

webidl.configurePrototype(WebSocket);
export const WebSocketPrototype = WebSocket.prototype;
