// GJS entry — WebRTC video preview with Adwaita + VideoBridge.

import '@girs/gjs';
import '@girs/gtk-4.0';
import '@girs/adw-1';

import { runAdwApp } from '@gjsify/adw-app';
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

runAdwApp({
    applicationId: 'gjsify.examples.webrtc-video',
    title: 'WebRTC Video — Webcam Preview',
    defaultWidth: 640,
    defaultHeight: 480,
    build: () => {
        const videoBridge = new VideoBridge();
        videoBridge.onReady(async (video) => {
            try {
                await startVideo(video as any, log);
            } catch (err: any) {
                log(`getUserMedia failed: ${err?.message ?? err}`);
            }
        });
        return videoBridge;
    },
});
