// SPDX-License-Identifier: MIT
// A message channel between two GJS processes (ADR 0133): line framing over
// Gio streams, the structured-clone wire codec, SharedBuffer fd transfer and
// cross-process MessagePort routing. Knows nothing about workers or `fork`.

export { LineChannel } from './line-channel.ts';
export { setupNodeChannel, isInternalMessage } from './node-channel.ts';
export type { NodeChannelTarget, NodeChannelHandle, SendCallback } from './node-channel.ts';
export * from './wire.ts';
