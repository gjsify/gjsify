// Re-exports of MessagePort + MessageChannel from `@gjsify/message-channel`, plus the
// bridge-transport adapter that plugs the WebKit bridge into the standard port's
// transport hook. The `IFrame*` aliases are literal re-exports, not subclasses, kept for
// consumers that imported the iframe-local names these classes once had.
//
// The `/core` subpath, not the bare specifier: `@gjsify/message-channel` declares
// `node`/`browser`/`nativescript` as `native`, so ADR 0014 routing hands those targets the
// HOST's MessageChannel — which has no transport hook, no `_partner` and answers
// `Symbol.toStringTag` with `EventTarget`. `BridgePortTransport` needs all three, so on
// `--app node` the bare specifier made `_registerTransferredPort()` throw
// "partner missing" and `substitutePorts()` walk past every transferred port.

import { MessagePort, MessageChannel } from '@gjsify/message-channel/core';
import type { MessagePortTransport } from '@gjsify/message-channel/core';
import type { MessageBridge } from './message-bridge.js';

export { MessagePort, MessageChannel };

/** @deprecated Alias of `MessagePort`; use the standard name. */
export const IFrameMessagePort = MessagePort;
export type IFrameMessagePort = MessagePort;

/** @deprecated Alias of `MessageChannel`; use the standard name. */
export const IFrameMessageChannel = MessageChannel;
export type IFrameMessageChannel = MessageChannel;

/**
 * Routes a port's outbound messages through a `MessageBridge`. The bridge attaches one to
 * the PARTNER of every `MessagePort` it takes out of a `postMessage` transferList, so
 * that partner's `.postMessage` flows over the WebKit IPC instead of to the now-detached
 * in-process port.
 *
 * @internal
 */
export class BridgePortTransport implements MessagePortTransport {
    constructor(private _bridge: MessageBridge) {}

    send(portId: number, data: unknown): void {
        this._bridge._sendPortMessage(portId, data);
    }

    close(portId: number): void {
        this._bridge._closePort(portId);
    }
}
