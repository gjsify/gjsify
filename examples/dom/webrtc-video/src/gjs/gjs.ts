// GJS entry — WebRTC video preview with Adwaita + VideoBridge.

import '@girs/gjs';
import '@girs/gtk-4.0';
import '@girs/adw-1';

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import { VideoBridge } from '@gjsify/video';

import { startVideo } from '../video-demo.js';

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
        try {
            await startVideo(video as any, log);
        } catch (err: any) {
            log(`getUserMedia failed: ${err?.message ?? err}`);
        }
    });

    win.present();

    const loop = GLib.MainLoop.new(null, false);
    win.connect('close-request', () => {
        loop.quit();
        return false;
    });
});

app.run([]);
