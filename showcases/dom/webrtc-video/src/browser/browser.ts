// Browser entry — WebRTC video preview with native <video> element.

import { startVideo } from '../video-demo.js';

const video = document.querySelector('video') as HTMLVideoElement;
const statusEl = document.getElementById('status')!;

function log(msg: string): void {
    statusEl.textContent = msg;
    console.log(`[webrtc-video] ${msg}`);
}

startVideo(video, log).catch((err) => {
    log(`Error: ${err?.message ?? err}`);
});
