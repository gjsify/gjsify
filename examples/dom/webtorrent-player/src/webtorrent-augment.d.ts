// Type augmentations for @types/webtorrent@0.110.x — upstream lacks several
// runtime APIs that we rely on. All patches are kept in this single file so
// the demo code doesn't need inline `as TorrentFile & { … }` intersections.
//
// TODO(upstream): send a PR to DefinitelyTyped covering:
//   - NodeServer.listen (it's a Node http.Server at runtime)
//   - Torrent.critical / Torrent.bitfield / 'verified' event
//   - TorrentFile.offset / TorrentFile.on('stream', …)

import type { Instance as TorrentClient } from 'webtorrent';

declare module 'webtorrent' {
    // `client.createServer(opts, 'node')` returns a Node http.Server, but the
    // shipped type is a minimal `ServerBase` without `listen()`.
    interface NodeServer {
        listen(port: number, cb?: () => void): void;
    }

    // Torrent extras used for streaming playback.
    interface Torrent {
        /** Byte offset zero-filled sparse file layout; per piece index 0..pieces.length-1. */
        readonly bitfield: { get(index: number): boolean };
        /** Mark pieces as high-priority for peer requests. */
        critical(start: number, end: number): void;
        on(event: 'verified', listener: (index: number) => void): this;
        removeListener(event: 'verified', listener: (index: number) => void): this;
    }

    // TorrentFile extras used for HTTP streaming integration.
    interface TorrentFile {
        /** Byte offset of this file in the torrent's concatenated piece stream. */
        readonly offset: number;
        on(
            event: 'stream',
            listener: (args: { stream: AsyncIterable<Uint8Array> }, setTarget: (target: unknown) => void) => void,
        ): this;
    }
}

export type { TorrentClient };
