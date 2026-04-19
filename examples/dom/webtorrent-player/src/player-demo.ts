// WebTorrent player logic — platform-agnostic.
// Opens a torrent (file path or magnet URI), spins up WebTorrent's built-in
// HTTP streaming server, and reports the stream URL. The server bridges
// playback: GStreamer's playbin issues Range requests and plays while the
// torrent is still downloading.
//
// Reference: refs/webtorrent-desktop/src/renderer/pages/player-page.js

import { PassThrough } from 'node:stream';
import WebTorrent from 'webtorrent';
import type WebTorrentNS from 'webtorrent';
import type { Torrent, TorrentFile } from 'webtorrent';

// @types/webtorrent's NodeServer lacks listen() — at runtime it's a Node.js
// http.Server. Filed upstream; patch the missing method onto the type.
type NodeServerWithListen = WebTorrentNS.NodeServer & { listen(port: number, cb?: () => void): void };

export interface PlayerCallbacks {
    /** Called when the torrent name / title is known. */
    onName(name: string): void;
    /** Called with a streaming URL once the video file is identified. */
    onStreamUrl(url: string): void;
    /** Called periodically with download progress [0..1]. */
    onProgress(fraction: number): void;
    /** Called periodically with a human-readable status line. */
    onStatus(text: string): void;
}

const VIDEO_EXTS = /\.(mp4|mkv|webm|avi|mov|m4v|ogv|ogg|ts)$/i;

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const formatSpeed = (bytesPerSec: number): string => `${formatBytes(bytesPerSec)}/s`;

/**
 * Start downloading/streaming a torrent and report events via callbacks.
 * Returns the WebTorrent client so the caller can destroy it on close.
 */
export async function runPlayer(
    torrentSource: string,
    cb: PlayerCallbacks,
): Promise<WebTorrent.Instance> {
    const client = new WebTorrent();

    // Force the Node HTTP server — WebTorrent defaults to a BrowserServer when
    // `globalThis` exists (as in GJS), and that path requires the missing
    // ServiceWorkerRegistration API. The 'node' second arg is undocumented but
    // present in WebTorrent v2 source.
    const server = client.createServer({ hostname: '127.0.0.1' }, 'node') as unknown as NodeServerWithListen;
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    cb.onStatus('Adding torrent…');

    const torrent = await new Promise<Torrent>((resolve) => {
        client.add(torrentSource, (t) => resolve(t));
    });

    cb.onName(torrent.name ?? 'WebTorrent Player');
    cb.onStatus('Connected — searching for peers…');

    const videoFile = (torrent.files as TorrentFile[])
        .filter((f) => VIDEO_EXTS.test(f.name))
        .sort((a, b) => b.length - a.length)[0];

    if (!videoFile) {
        cb.onStatus(`No playable video file found in ${torrent.name}`);
        return client;
    }

    // Swap the streamx Readable WebTorrent would pipe into res for a PassThrough
    // we control. `for await` is our documented working consumer of streamx; the
    // stock `body.pipe(res)` path never engages our Writable's `_write` under
    // GJS. setTarget(pt) tells ServerBase.serveFile to do `res.body = pt`, so
    // wrapRequest ends up running `pump(pt, res)` — one Node-classic stream
    // piping into another, both under our control and empirically working.
    type StreamHook = TorrentFile & {
        on(
            event: 'stream',
            listener: (args: { stream: AsyncIterable<Uint8Array> }, setTarget: (t: unknown) => void) => void,
        ): void;
    };
    (videoFile as StreamHook).on('stream', ({ stream }, setTarget) => {
        const pt = new PassThrough();
        (async () => {
            try {
                for await (const chunk of stream) {
                    if (!pt.write(chunk as Uint8Array)) {
                        await new Promise<void>((resolve) => pt.once('drain', resolve));
                    }
                }
                pt.end();
            } catch (err) {
                pt.destroy(err instanceof Error ? err : new Error(String(err)));
            }
        })();
        setTarget(pt);
    });

    const encodedPath = videoFile.path.split('/').map(encodeURIComponent).join('/');
    // WebTorrent v2 serves files under /webtorrent/<infoHash>/<path>; omitting
    // the /webtorrent prefix causes wrapRequest() to destroy the connection.
    const streamUrl = `http://127.0.0.1:${port}/webtorrent/${torrent.infoHash}/${encodedPath}`;

    // Prioritize the pieces at the *start* AND *end* of the video file and
    // wait for both before handing the URL to GStreamer:
    //  - start: MP4/Matroska header required to initialise qtdemux/matroskademux
    //  - end: MP4 'moov' atom is often stored at file end (no 'faststart'
    //    flag); qtdemux seeks there to find stream metadata and fails with
    //    "no known streams found" if those bytes are missing.
    // Without explicit critical() + wait, WebTorrent's rarest-first strategy
    // can leave either region undelivered when playbin starts.
    const fileOffset = (videoFile as TorrentFile & { offset: number }).offset;
    const lastByte = fileOffset + videoFile.length - 1;
    const firstPiece = Math.floor(fileOffset / torrent.pieceLength);
    const lastPiece = Math.floor(lastByte / torrent.pieceLength);
    const bufferPieces = 4;
    const headerRange = { from: firstPiece, to: Math.min(firstPiece + bufferPieces - 1, lastPiece) };
    const footerRange = { from: Math.max(lastPiece - bufferPieces + 1, headerRange.to + 1), to: lastPiece };
    torrent.critical(headerRange.from, headerRange.to);
    if (footerRange.from <= footerRange.to) torrent.critical(footerRange.from, footerRange.to);

    const wanted: number[] = [];
    for (let i = headerRange.from; i <= headerRange.to; i++) wanted.push(i);
    for (let i = footerRange.from; i <= footerRange.to; i++) wanted.push(i);

    cb.onStatus('Buffering…');
    await new Promise<void>((resolve) => {
        const haveAll = (): boolean => wanted.every((p) => torrent.bitfield.get(p));
        if (haveAll()) return resolve();
        const onVerified = (): void => {
            if (haveAll()) {
                torrent.removeListener('verified', onVerified);
                resolve();
            }
        };
        torrent.on('verified', onVerified);
    });
    cb.onStreamUrl(streamUrl);

    const statusTick = setInterval(() => {
        const peers = torrent.numPeers;
        const peerSuffix = peers !== 1 ? 's' : '';
        const ul = formatSpeed(torrent.uploadSpeed);

        if (torrent.done) {
            cb.onStatus(`Seeding ↑ ${ul}  ${peers} peer${peerSuffix}  ratio ${torrent.ratio.toFixed(2)}`);
            cb.onProgress(1);
            return;
        }
        const dl = formatSpeed(torrent.downloadSpeed);
        const etaSec = torrent.timeRemaining / 1000;
        const eta = isFinite(etaSec) ? ` ETA ${Math.round(etaSec)}s` : '';
        cb.onStatus(`${Math.round(torrent.progress * 100)}%  ↓ ${dl}  ↑ ${ul}  ${peers} peer${peerSuffix}${eta}`);
        cb.onProgress(torrent.progress);
    }, 500);

    torrent.on('done', () => {
        clearInterval(statusTick);
        cb.onProgress(1);
    });

    torrent.on('error', (err) => {
        clearInterval(statusTick);
        cb.onStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    });

    return client;
}
