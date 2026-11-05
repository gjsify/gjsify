// The child end of `fork`'s IPC channel (ADR 0133). A parent that forks us —
// GJS or Node — hands over a connected stream socket and names its fd in
// `NODE_CHANNEL_FD`. Opened at startup, as Node does, so `process.send` exists
// before the first line of user code runs.

import { setupNodeChannel, type NodeChannelTarget } from '@gjsify/ipc-channel/node-channel';
import { isGjsHost } from './env.js';

interface IpcProcess extends NodeChannelTarget {
    env: Record<string, string | undefined>;
    emitWarning(warning: string, name?: string): void;
}

export function connectParentChannel(process: IpcProcess): void {
    if (!isGjsHost()) return;
    const fdText = process.env.NODE_CHANNEL_FD;
    if (fdText === undefined) return;
    const mode = process.env.NODE_CHANNEL_SERIALIZATION_MODE ?? 'json';
    // Node removes both, so a grandchild never mistakes our channel for its own.
    delete process.env.NODE_CHANNEL_FD;
    delete process.env.NODE_CHANNEL_SERIALIZATION_MODE;

    const fd = Number.parseInt(fdText, 10);
    if (!Number.isInteger(fd) || fd < 0) return;
    if (mode !== 'json') {
        process.emitWarning(
            `IPC serialization '${mode}' is not supported under GJS yet; no channel to the parent`,
            'ExperimentalWarning',
        );
        return;
    }
    try {
        setupNodeChannel(process, fd);
    } catch (e) {
        process.emitWarning(`Could not open the IPC channel to the parent: ${(e as Error).message}`);
    }
}
