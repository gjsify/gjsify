// GJS entry — WebTorrent video player with Adwaita UI.
// Opens a torrent file / magnet URI, streams via HTTP while downloading,
// plays with built-in controls.

import '@girs/gjs';
import '@girs/gtk-4.0';
import '@girs/adw-1';

import Gtk from 'gi://Gtk?version=4.0';
import { runAdwApp } from '@gjsify/adw-app';
import { VideoBridge } from '@gjsify/video';

import { runPlayer } from '../player-demo.js';

// WebTorrent's WebRTC peer exchange uses GStreamer-backed RTCPeerConnection and
// creates long-lived GLib sources whose GC racing has historically crashed the
// app. DHT (UDP) + HTTP trackers are sufficient for downloading; hide the
// globals before the webtorrent import so it falls back to non-WebRTC peers.
delete (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection;
delete (globalThis as { RTCSessionDescription?: unknown }).RTCSessionDescription;
delete (globalThis as { RTCIceCandidate?: unknown }).RTCIceCandidate;

// Big Buck Bunny — open-source Blender short; the MP4 has `faststart` so the
// `moov` metadata atom sits at the start of the file, letting playbin open
// the stream after just the header pieces are downloaded (no long wait for
// rarest-first end-of-file pieces). See https://webtorrent.io/free-torrents.
const DEFAULT_TORRENT =
    'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fbig-buck-bunny.torrent';

const torrentSource = (imports as { system?: { programArgs?: string[] } }).system?.programArgs?.[0]
    ?? DEFAULT_TORRENT;

runAdwApp({
    applicationId: 'io.gjsify.WebtorrentPlayer',
    title: 'WebTorrent Player',
    defaultWidth: 900,
    defaultHeight: 580,
    build: ({ app, window }) => {
        const contentBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });

        const videoBridge = new VideoBridge();
        videoBridge.set_hexpand(true);
        videoBridge.set_vexpand(true);
        videoBridge.showControls(true);
        contentBox.append(videoBridge);

        const progressBar = new Gtk.ProgressBar({
            margin_start: 8,
            margin_end: 8,
            margin_top: 4,
        });
        contentBox.append(progressBar);

        const statusLabel = new Gtk.Label({
            label: 'Starting…',
            xalign: 0,
            margin_start: 8,
            margin_end: 8,
            margin_bottom: 6,
            use_markup: false,
        });
        contentBox.append(statusLabel);

        let torrentClient: { destroy?: () => void } | null = null;

        videoBridge.onReady(async (video) => {
            try {
                torrentClient = await runPlayer(torrentSource, {
                    onName: (name) => window.set_title(name),
                    onStreamUrl: (url) => { video.src = url; },
                    onProgress: (fraction) => progressBar.set_fraction(fraction),
                    onStatus: (text) => statusLabel.set_label(text),
                });
            } catch (err) {
                statusLabel.set_label(`Error: ${err instanceof Error ? err.message : String(err)}`);
            }
        });

        window.connect('close-request', () => {
            torrentClient?.destroy?.();
            return false;
        });

        app.connect('shutdown', () => torrentClient?.destroy?.());

        return contentBox;
    },
});
