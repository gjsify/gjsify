// Backward-compatibility re-exports of MessagePort + MessageChannel from
// the shared @gjsify/message-channel package, plus a bridge-transport
// adapter that lets the WebKit bridge plug into the standard port's
// pluggable transport hook.
//
// History: this file used to define iframe-local IFrameMessagePort /
// IFrameMessageChannel classes (PR #195). With PR #196 they were lifted
// into the standalone @gjsify/message-channel Web pillar package so the
// classes can serve as proper browser globals AND back the
// transport-pluggable WebKit-bridge path here. The aliases below stay
// exported for any external consumer that imported the iframe-local
// names; they're literal re-exports, not subclasses.

import { MessagePort, MessageChannel } from '@gjsify/message-channel';
import type { MessagePortTransport } from '@gjsify/message-channel';
import type { MessageBridge } from './message-bridge.js';

export { MessagePort, MessageChannel };

/** @deprecated Re-exported alias of `MessagePort` from
 *  `@gjsify/message-channel`. Use the standard name. */
export const IFrameMessagePort = MessagePort;
export type IFrameMessagePort = MessagePort;

/** @deprecated Re-exported alias of `MessageChannel` from
 *  `@gjsify/message-channel`. Use the standard name. */
export const IFrameMessageChannel = MessageChannel;
export type IFrameMessageChannel = MessageChannel;

/**
 * MessagePortTransport adapter that routes a port's outbound messages
 * through a `MessageBridge` instance. Used internally by the bridge
 * when it picks up `MessagePort` instances from a `postMessage`
 * transferList — the transferred port's partner is attached to a
 * `BridgePortTransport` so its `.postMessage` flows over the WebKit
 * IPC instead of the in-process partner (which has been detached).
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
