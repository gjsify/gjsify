// WebRTC video preview — getUserMedia webcam rendered via VideoBridge.
//
// Demonstrates: navigator.mediaDevices.getUserMedia() → MediaStream →
// video.srcObject → VideoBridge (Gtk.Picture + gtk4paintablesink)
//
// Prerequisites:
//   - GStreamer >= 1.20 with gst-plugins-bad + gst-plugins-rs (gtk4paintablesink)
//   - A webcam (v4l2) or PipeWire video source
//   - Fedora: dnf install gstreamer1-plugin-gtk4 gstreamer1-plugins-bad-free
//   - Ubuntu: apt install gstreamer1.0-gtk4 gstreamer1.0-plugins-bad
//
// Run: yarn build && yarn start

import '@girs/gjs';
import '@girs/gtk-4.0';
import '@girs/adw-1';

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import { VideoBridge } from '@gjsify/video';

declare const print: ((msg: string) => void) | undefined;

function log(msg: string): void {
    if (typeof print === 'function') {
        print(`[webrtc-video] ${msg}`);
    } else {
        console.log(`[webrtc-video] ${msg}`);
    }
}

const app = new Adw.Application({
    application_id: 'gjsify.examples.webrtc-video',
});

app.connect('activate', () => {
    const win = new Adw.ApplicationWindow({ application: app });
    win.set_default_size(640, 480);
    win.set_title('WebRTC Video — Webcam Preview');

    const headerBar = new Adw.HeaderBar();
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);

    const videoBridge = new VideoBridge();
    toolbarView.set_content(videoBridge);
    win.set_content(toolbarView);

    videoBridge.onReady(async (video) => {
        log('VideoBridge ready, requesting webcam...');

        try {
            // getUserMedia is registered globally by @gjsify/webrtc/register
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false,
            });

            log(`Got MediaStream with ${stream.getVideoTracks().length} video track(s)`);
            video.srcObject = stream;
            log('Video playing');
        } catch (err) {
            log(`getUserMedia failed: ${err}`);
        }
    });

    win.present();

    // Keep the GLib main loop alive for GStreamer pipeline
    const loop = GLib.MainLoop.new(null, false);
    win.connect('close-request', () => {
        loop.quit();
        return false;
    });
});

app.run([]);
