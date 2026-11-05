// SPDX-License-Identifier: MIT
// The Gio-free half of the channel: what a message LOOKS like on the wire, with
// no stream underneath. Runs on any runtime, so a spec can check the codec on
// Node too; `.` adds the Gio framing on top.

export { createDataCloneError, createErrorByName, decode, encode } from './structured-clone-wire.ts';
export {
    extractSharedBuffers,
    isSharedBuffer,
    isSharedBufferPlaceholder,
    materializeSharedBuffers,
} from './sab-transfer.ts';
export type { SharedBufferPlaceholder } from './sab-transfer.ts';
export {
    SubprocessPortTransport,
    isCrossProcessPortPlaceholder,
    nextChildPortId,
    nextParentPortId,
} from './subprocess-port-transport.ts';
export type { CrossProcessPortPlaceholder, CrossProcessPortRegistry, WireWriter } from './subprocess-port-transport.ts';
