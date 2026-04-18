// GJS entry — WebTorrent video player with Adwaita UI.
// Opens a torrent file / magnet URI, streams via HTTP while downloading,
// plays with built-in controls.

import '@girs/gjs';
import '@girs/gtk-4.0';
import '@girs/adw-1';

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { VideoBridge } from '@gjsify/video';

import { runPlayer } from '../player-demo.js';

// WebTorrent's WebRTC peer exchange uses GStreamer-backed RTCPeerConnection and
// creates long-lived GLib sources whose GC racing has historically crashed the
// app. DHT (UDP) + HTTP trackers are sufficient for downloading; hide the
// globals before the webtorrent import so it falls back to non-WebRTC peers.
delete (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection;
delete (globalThis as { RTCSessionDescription?: unknown }).RTCSessionDescription;
delete (globalThis as { RTCIceCandidate?: unknown }).RTCIceCandidate;

// Sintel — the open-source Blender short film. See https://webtorrent.io/free-torrents.
const DEFAULT_TORRENT =
    'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent';

const torrentSource = (imports as { system?: { programArgs?: string[] } }).system?.programArgs?.[0]
    ?? DEFAULT_TORRENT;

const app = new Adw.Application({
    application_id: 'io.gjsify.WebtorrentPlayer',
});

app.connect('activate', () => {
    const win = new Adw.ApplicationWindow({ application: app });
    win.set_default_size(900, 580);
    win.set_title('WebTorrent Player');

    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(new Adw.HeaderBar());

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

    toolbarView.set_content(contentBox);
    win.set_content(toolbarView);
    win.present();

    let torrentClient: { destroy?: () => void } | null = null;

    videoBridge.onReady(async (video) => {
        try {
            torrentClient = await runPlayer(torrentSource, {
                onName: (name) => win.set_title(name),
                onStreamUrl: (url) => { video.src = url; },
                onProgress: (fraction) => progressBar.set_fraction(fraction),
                onStatus: (text) => statusLabel.set_label(text),
            });
        } catch (err) {
            statusLabel.set_label(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

    win.connect('close-request', () => {
        torrentClient?.destroy?.();
        return false;
    });

    app.connect('shutdown', () => torrentClient?.destroy?.());
});

app.run([]);
