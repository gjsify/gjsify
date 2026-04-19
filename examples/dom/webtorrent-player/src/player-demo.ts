// WebTorrent player logic — platform-agnostic.
// Opens a torrent (file path or magnet URI), spins up WebTorrent's built-in
// HTTP streaming server, and reports the stream URL. The server bridges
// playback: GStreamer's playbin issues Range requests and plays while the
// torrent is still downloading.
//
// Reference: refs/webtorrent-desktop/src/renderer/pages/player-page.js

import './webtorrent-augment.d.ts';
import { PassThrough } from 'node:stream';
import WebTorrent from 'webtorrent';
import type { Torrent, TorrentFile, NodeServer } from 'webtorrent';

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
    // 'node' selects NodeServer (Node http.Server) over BrowserServer, but the
    // TS return type is the union — narrow at the call site.
    const server = client.createServer({ hostname: '127.0.0.1' }, 'node') as NodeServer;
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

    // WebTorrent emits 'stream' per HTTP range request with a streamx Readable.
    // The stock `body.pipe(res)` path never engages our @gjsify/http Writable's
    // `_write` under GJS (streamx pipe protocol incompat — separate rabbit
    // hole), so consume the Readable with `for await` and forward chunks
    // through a Node-classic PassThrough we own. setTarget(pt) makes
    // ServerBase.serveFile do `res.body = pt`, and wrapRequest then runs
    // `pump(pt, res)` — both Node streams under our control.
    videoFile.on('stream', ({ stream }, setTarget) => {
        const pt = new PassThrough();
        (async () => {
            try {
                for await (const chunk of stream) {
                    if (!pt.write(chunk)) {
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

    // Prioritize the pieces covering the start of the video file and wait for
    // them before handing the URL to GStreamer. Without this, rarest-first
    // piece selection can leave byte 0 undelivered when playbin starts and
    // qtdemux/matroskademux reject the stream with "no known streams found".
    // For non-faststart MP4 qtdemux seeks to the end once the start is parsed;
    // WebTorrent's FileIterator transparently marks those end pieces critical
    // and blocks on 'verified', so we don't prefetch the tail upfront.
    const fileOffset = videoFile.offset;
    const lastByte = fileOffset + videoFile.length - 1;
    const firstPiece = Math.floor(fileOffset / torrent.pieceLength);
    const lastPiece = Math.floor(lastByte / torrent.pieceLength);
    const headerEnd = Math.min(firstPiece + 3, lastPiece);
    const headerCount = headerEnd - firstPiece + 1;
    torrent.critical(firstPiece, headerEnd);

    const headerReady = (): number => {
        let n = 0;
        for (let p = firstPiece; p <= headerEnd; p++) {
            if (torrent.bitfield.get(p)) n++;
        }
        return n;
    };

    // Status ticker — started before the buffering wait so the user sees peer
    // count, speeds, and the "buffering X/N" header chunks arriving instead of
    // a static "Buffering…" during the wait.
    let streamOpened = false;
    const statusTick = setInterval(() => {
        const peers = torrent.numPeers;
        const peerSuffix = peers !== 1 ? 's' : '';
        const ul = formatSpeed(torrent.uploadSpeed);
        const dl = formatSpeed(torrent.downloadSpeed);

        if (torrent.done) {
            cb.onStatus(`Seeding ↑ ${ul}  ${peers} peer${peerSuffix}  ratio ${torrent.ratio.toFixed(2)}`);
            cb.onProgress(1);
            return;
        }
        if (!streamOpened) {
            cb.onStatus(`Buffering ${headerReady()}/${headerCount} chunks  ↓ ${dl}  ${peers} peer${peerSuffix}`);
            cb.onProgress(torrent.progress);
            return;
        }
        const etaSec = torrent.timeRemaining / 1000;
        const eta = isFinite(etaSec) ? ` ETA ${Math.round(etaSec)}s` : '';
        cb.onStatus(`${Math.round(torrent.progress * 100)}%  ↓ ${dl}  ↑ ${ul}  ${peers} peer${peerSuffix}${eta}`);
        cb.onProgress(torrent.progress);
    }, 500);

    await new Promise<void>((resolve) => {
        if (headerReady() === headerCount) return resolve();
        const onVerified = (): void => {
            if (headerReady() === headerCount) {
                torrent.removeListener('verified', onVerified);
                resolve();
            }
        };
        torrent.on('verified', onVerified);
    });
    streamOpened = true;
    cb.onStreamUrl(streamUrl);

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
