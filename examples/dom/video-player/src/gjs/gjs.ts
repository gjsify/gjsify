// GJS entry — video player with play/pause, seek, and volume controls.
// Plays an HTTP video URL directly via GStreamer playbin → gtk4paintablesink.

import '@girs/gjs';
import '@girs/gtk-4.0';
import '@girs/adw-1';

import Adw from 'gi://Adw?version=1';
import { VideoBridge } from '@gjsify/video';

const VIDEO_URL = 'http://ftp.nluug.nl/pub/graphics/blender/demo/movies/Sintel.2010.720p.mkv';

const app = new Adw.Application({ application_id: 'io.gjsify.VideoPlayer' });

app.connect('activate', () => {
    const win = new Adw.ApplicationWindow({ application: app });
    win.set_default_size(900, 560);
    win.set_title('Video Player');

    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(new Adw.HeaderBar());

    const videoBridge = new VideoBridge();
    videoBridge.showControls(true);
    toolbarView.set_content(videoBridge);
    win.set_content(toolbarView);

    videoBridge.onReady((video) => {
        win.set_title('Sintel (2010) — Video Player');
        video.src = VIDEO_URL;
    });

    win.present();
});

app.run([]);
