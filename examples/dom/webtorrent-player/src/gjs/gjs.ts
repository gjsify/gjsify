// GJS entry — WebTorrent video player with Adwaita UI.
// Opens sintel.torrent, streams via HTTP while downloading, plays with controls.

import '@girs/gjs';
import '@girs/gtk-4.0';
import '@girs/adw-1';

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { VideoBridge } from '@gjsify/video';

import { runPlayer } from '../player-demo.js';

// ---- Crash diagnostics ----
// "gjs exited with code null" means a native signal (SIGSEGV/SIGABRT) terminated
// the process — no JS-level trace is emitted. These handlers at least log the
// last JS-visible state so we can tell how far the app got before dying.

function logDiag(tag: string, msg: string): void {
    printerr(`[player-diag ${new Date().toISOString()}] ${tag}: ${msg}`);
}

process.on?.('uncaughtException', (err: Error) => {
    logDiag('uncaughtException', `${err?.stack ?? err}`);
});
process.on?.('unhandledRejection', (reason: unknown) => {
    logDiag('unhandledRejection', `${(reason as Error)?.stack ?? reason}`);
});
process.on?.('exit', (code: number | null) => {
    logDiag('exit', `code=${code}`);
});

logDiag('boot', `gjs starting, argv=${JSON.stringify((imports as any).system?.programArgs ?? [])}`);

// WebTorrent's WebRTC peer exchange uses GStreamer-backed RTCPeerConnection which can cause
// GLib source GC issues. DHT (UDP) + HTTP trackers are sufficient for downloading.
// Prevent WebTorrent from using WebRTC by hiding the global before import.
if (typeof globalThis !== 'undefined') {
    delete (globalThis as any).RTCPeerConnection;
    delete (globalThis as any).RTCSessionDescription;
    delete (globalThis as any).RTCIceCandidate;
}

// Default torrent — Sintel, the open-source Blender short film.
// See: https://webtorrent.io/free-torrents
const DEFAULT_TORRENT = '/home/jumplink/Downloads/sintel.torrent';
const torrentSource = (typeof imports !== 'undefined' && (imports as any).system?.programArgs?.[0])
    ?? DEFAULT_TORRENT;

const app = new Adw.Application({
    application_id: 'io.gjsify.WebtorrentPlayer',
});

app.connect('activate', () => {
    const win = new Adw.ApplicationWindow({ application: app });
    win.set_default_size(900, 580);
    win.set_title('WebTorrent Player');

    const headerBar = new Adw.HeaderBar();
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);

    // Main content: video + status bar
    const contentBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
    });

    const videoBridge = new VideoBridge();
    videoBridge.set_hexpand(true);
    videoBridge.set_vexpand(true);
    videoBridge.showControls(true);
    contentBox.append(videoBridge);

    // Download progress bar
    const progressBar = new Gtk.ProgressBar();
    progressBar.set_margin_start(8);
    progressBar.set_margin_end(8);
    progressBar.set_margin_top(4);
    contentBox.append(progressBar);

    // Status label: speed, peers, ETA
    const statusLabel = new Gtk.Label({
        label: 'Starting…',
        xalign: 0,
        margin_start: 8,
        margin_end: 8,
        margin_bottom: 6,
    });
    (statusLabel as any).use_markup = false;
    contentBox.append(statusLabel);

    toolbarView.set_content(contentBox);
    win.set_content(toolbarView);
    win.present();

    let torrentClient: any = null;

    videoBridge.onReady(async (video) => {
        try {
            torrentClient = await runPlayer(torrentSource, {
                onName: (name) => {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        win.set_title(name);
                        return GLib.SOURCE_REMOVE;
                    });
                },
                onStreamUrl: (url) => {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        video.src = url;
                        return GLib.SOURCE_REMOVE;
                    });
                },
                onProgress: (fraction) => {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        progressBar.set_fraction(fraction);
                        return GLib.SOURCE_REMOVE;
                    });
                },
                onStatus: (text) => {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        statusLabel.set_label(text);
                        return GLib.SOURCE_REMOVE;
                    });
                },
            });
        } catch (err: any) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                statusLabel.set_label(`Error: ${err?.message ?? err}`);
                return GLib.SOURCE_REMOVE;
            });
        }
    });

    const mainLoop = GLib.MainLoop.new(null, false);
    win.connect('close-request', () => {
        torrentClient?.destroy?.();
        mainLoop.quit();
        return false;
    });

    app.connect('shutdown', () => {
        torrentClient?.destroy?.();
    });
});

app.run([]);
