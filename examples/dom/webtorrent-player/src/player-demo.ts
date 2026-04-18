// WebTorrent player logic — platform-agnostic.
// Opens a torrent (file path or magnet URI), downloads via WebTorrent, and
// reports a file:// URL once the video file is fully downloaded. Playback
// happens directly from disk via GStreamer's playbin + filesrc.
//
// A previous version attempted to stream via WebTorrent's built-in HTTP server
// (`client.createServer()` + a streamx-based response body). On GJS, streamx's
// Readable never pumps data through our @gjsify/http ServerResponse — the pipe
// protocol between streamx and Node-style Writables doesn't engage our write
// path. Fixing that pipe compat is a separate, larger investigation; in the
// meantime the demo falls back to file:// after the download is complete,
// which exercises the full torrent download + playback path.
//
// Reference: refs/webtorrent-desktop/src/renderer/pages/player-page.js

import { join, isAbsolute, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, statSync } from 'node:fs';
import WebTorrent from 'webtorrent';
import type { Torrent, TorrentFile } from 'webtorrent';

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
const DOWNLOAD_ROOT = join(tmpdir(), 'webtorrent');

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const formatSpeed = (bytesPerSec: number): string => `${formatBytes(bytesPerSec)}/s`;

/** RFC 3986 path-segment encoding, preserving '/' separators. */
function toFileUri(absPath: string): string {
    const encoded = absPath.split('/').map(encodeURIComponent).join('/');
    return `file://${encoded.startsWith('/') ? encoded : `/${encoded}`}`;
}

/**
 * Start downloading a torrent and report events via callbacks. Returns the
 * WebTorrent client so the caller can destroy it on close. Emits the stream
 * URL (file:// to the video on disk) once the torrent finishes downloading.
 */
export async function runPlayer(
    torrentSource: string,
    cb: PlayerCallbacks,
): Promise<WebTorrent.Instance> {
    const client = new WebTorrent();

    cb.onStatus('Adding torrent…');

    // skipVerify is only safe when the cached file on disk is complete; if it
    // is, we trust it and jump straight to playback without the hashing phase
    // (which takes minutes on a large video even with our Gio-backed fs). If
    // there is no cached file, let WebTorrent download it normally.
    const cachedComplete = (path: string, expectedLen: number): boolean => {
        try { return existsSync(path) && statSync(path).size === expectedLen; }
        catch { return false; }
    };

    // client.add accepts opts before the torrent metadata is known; we don't
    // have the file length yet. Add first with verify, then decide.
    const torrent = await new Promise<Torrent>((resolve) => {
        client.add(torrentSource, { path: DOWNLOAD_ROOT }, (t) => resolve(t));
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

    const fileDiskPath = isAbsolute(videoFile.path)
        ? videoFile.path
        : resolve(DOWNLOAD_ROOT, videoFile.path);

    let streamUrlEmitted = false;
    const maybeEmitStreamUrl = (): void => {
        if (streamUrlEmitted) return;
        if (!cachedComplete(fileDiskPath, videoFile.length)) return;
        streamUrlEmitted = true;
        cb.onStreamUrl(toFileUri(fileDiskPath));
    };

    // Fast path: file already on disk, full size — start playback immediately.
    maybeEmitStreamUrl();

    const statusTick = setInterval(() => {
        const peers = torrent.numPeers;
        const peerSuffix = peers !== 1 ? 's' : '';
        const ul = formatSpeed(torrent.uploadSpeed);

        if (torrent.done) {
            cb.onStatus(`Seeding ↑ ${ul}  ${peers} peer${peerSuffix}  ratio ${torrent.ratio.toFixed(2)}`);
            cb.onProgress(1);
            maybeEmitStreamUrl();
            return;
        }
        const dl = formatSpeed(torrent.downloadSpeed);
        const etaSec = torrent.timeRemaining / 1000;
        const eta = isFinite(etaSec) ? ` ETA ${Math.round(etaSec)}s` : '';
        cb.onStatus(`${Math.round(torrent.progress * 100)}%  ↓ ${dl}  ↑ ${ul}  ${peers} peer${peerSuffix}${eta}`);
        cb.onProgress(torrent.progress);
    }, 500);

    torrent.on('done', () => {
        cb.onProgress(1);
        maybeEmitStreamUrl();
    });

    torrent.on('error', (err) => {
        clearInterval(statusTick);
        cb.onStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    });

    return client;
}
