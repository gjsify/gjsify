// WebTorrent player logic — platform-agnostic.
// Opens a torrent (file path or magnet URI), starts an HTTP streaming server,
// and reports the stream URL once the first video file is ready. The built-in
// HTTP server handles Range requests so GStreamer's playbin can seek while the
// file is still downloading.
//
// Reference: refs/webtorrent-desktop/src/renderer/pages/player-page.js

import WebTorrent from 'webtorrent';
import type WebTorrentNS from 'webtorrent';
import type { Torrent, TorrentFile } from 'webtorrent';

// @types/webtorrent's NodeServer lacks listen() — at runtime it's a Node.js
// http.Server. Filed upstream; for now patch the missing method onto the type.
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

    // Force the Node HTTP server (WebTorrent defaults to a BrowserServer when
    // `globalThis` exists — as in GJS — and that path requires the missing
    // ServiceWorkerRegistration API). The 'node' second arg is undocumented but
    // present in WebTorrent v2 source.
    const server = client.createServer({ hostname: '127.0.0.1' }, 'node') as unknown as NodeServerWithListen;
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    cb.onStatus('Adding torrent…');

    // skipVerify: without it WebTorrent reads every chunk of existing files at
    // /tmp/webtorrent/<name>/ and runs SHA1 over them before announcing the
    // torrent as ready. On GJS that hashing phase starves the GTK main loop
    // long enough for the window to never paint. The demo trusts cached data;
    // users can `rm -rf /tmp/webtorrent` to force re-verification.
    const torrent = await new Promise<Torrent>((resolve) => {
        client.add(torrentSource, { skipVerify: true }, (t) => resolve(t));
    });

    cb.onName(torrent.name ?? 'WebTorrent Player');
    cb.onStatus(`Connected — searching for peers…`);

    // Largest video file is usually the feature.
    const videoFile = (torrent.files as TorrentFile[])
        .filter((f) => VIDEO_EXTS.test(f.name))
        .sort((a, b) => b.length - a.length)[0];

    if (!videoFile) {
        cb.onStatus(`No playable video file found in ${torrent.name}`);
        return client;
    }

    const encodedPath = videoFile.path.split('/').map(encodeURIComponent).join('/');
    cb.onStreamUrl(`http://127.0.0.1:${port}/${torrent.infoHash}/${encodedPath}`);

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
