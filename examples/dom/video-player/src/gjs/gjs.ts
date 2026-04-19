// GJS entry — video player with play/pause, seek, and volume controls.
// Plays an HTTP video URL directly via GStreamer playbin → gtk4paintablesink.

import '@girs/gjs';
import '@girs/gtk-4.0';
import '@girs/adw-1';

import { runAdwApp } from '@gjsify/adw-app';
import { VideoBridge } from '@gjsify/video';

const VIDEO_URL = 'http://ftp.nluug.nl/pub/graphics/blender/demo/movies/Sintel.2010.720p.mkv';

runAdwApp({
    applicationId: 'io.gjsify.VideoPlayer',
    title: 'Video Player',
    defaultWidth: 900,
    defaultHeight: 560,
    build: ({ window }) =>
        new Promise((resolve) => {
            const videoBridge = new VideoBridge();
            videoBridge.showControls(true);
            videoBridge.onReady((video) => {
                window.set_title('Sintel (2010) — Video Player');
                video.src = VIDEO_URL;
                resolve(videoBridge);
            });
        }),
});
