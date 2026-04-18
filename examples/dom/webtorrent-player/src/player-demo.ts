// WebTorrent player logic — platform-agnostic.
// Opens a torrent (file path or magnet URI), starts an HTTP streaming server,
// and reports the stream URL once the first video file is ready.
//
// WebTorrent's built-in HTTP server handles Range requests so GStreamer's
// playbin can seek during streaming. Playback starts as soon as the first
// pieces are available — no need to wait for a full download.
//
// Reference: refs/webtorrent-desktop/src/renderer/pages/player-page.js

import WebTorrent from 'webtorrent';
import type { Torrent, TorrentFile } from 'webtorrent';
import type { AddressInfo } from 'net';

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
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSpeed(bytesPerSec: number): string {
    return `${formatBytes(bytesPerSec)}/s`;
}

/**
 * Start downloading/streaming a torrent and report events via callbacks.
 *
 * Both WebRTC (browser peers via WebSocket trackers) and TCP (native peers via
 * DHT/BitTorrent trackers) are enabled so the client connects to as many peers
 * as possible.
 *
 * Returns the WebTorrent client so the caller can destroy it on close.
 */
export async function runPlayer(
    torrentSource: string,
    cb: PlayerCallbacks,
): Promise<WebTorrent.Instance> {
    const client = new WebTorrent();

    // Start the built-in HTTP streaming server on a random port.
    // The server serves each torrent file at:
    //   http://127.0.0.1:<port>/<infoHash>/<encodedPath>
    // and supports Range requests so GStreamer can seek while the file is
    // still downloading.
    // Force NodeServer: WebTorrent defaults to BrowserServer when globalThis exists (as in GJS),
    // which requires ServiceWorkerRegistration. Pass 'node' to use the HTTP streaming server.
    // The second 'node' argument is undocumented but present in WebTorrent v2 source.
    const server = (client.createServer as (opts: object, force: string) => import('net').Server)(
        { hostname: '127.0.0.1' },
        'node',
    );
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    cb.onStatus('Adding torrent…');

    const torrent = await new Promise<Torrent>((resolve) => {
        client.add(torrentSource, (t) => resolve(t));
    });

    cb.onName(torrent.name ?? 'WebTorrent Player');
    cb.onStatus(`Connected — searching for peers…`);

    // Find the largest video file (most likely the feature film).
    const videoFile = (torrent.files as TorrentFile[])
        .filter((f) => VIDEO_EXTS.test(f.name))
        .sort((a, b) => b.length - a.length)[0];

    if (!videoFile) {
        cb.onStatus(`No playable video file found in ${torrent.name}`);
        return client;
    }

    // Build the streaming URL. WebTorrent's server resolves the file by infoHash
    // + file path, URL-encoding each path segment.
    const encodedPath = videoFile.path
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');
    const streamUrl = `http://127.0.0.1:${port}/${(torrent as any).infoHash}/${encodedPath}`;

    cb.onStreamUrl(streamUrl);

    // Periodic status updates — WebTorrent emits 'download'/'upload' events but
    // polling is simpler for the UI ticker.
    const statusTick = setInterval(() => {
        const pct = Math.round(torrent.progress * 100);
        const dl = formatSpeed(torrent.downloadSpeed);
        const ul = formatSpeed(torrent.uploadSpeed);
        const peers = torrent.numPeers;
        const ratio = (torrent as any).ratio?.toFixed(2) ?? '0.00';

        if (torrent.done) {
            cb.onStatus(`Seeding ↑ ${ul}  ${peers} peer${peers !== 1 ? 's' : ''}  ratio ${ratio}`);
            cb.onProgress(1);
        } else {
            const etaSec = torrent.timeRemaining / 1000;
            const eta = isFinite(etaSec) ? ` ETA ${Math.round(etaSec)}s` : '';
            cb.onStatus(`${pct}%  ↓ ${dl}  ↑ ${ul}  ${peers} peer${peers !== 1 ? 's' : ''}${eta}`);
            cb.onProgress(torrent.progress);
        }
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
