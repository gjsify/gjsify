# @gjsify/video

`HTMLVideoElement` implementation for GJS backed by a `VideoBridge` — a `Gtk.Picture` widget powered by GStreamer's `gtk4paintablesink`. Accepts a `MediaStream` from `getUserMedia` / WebRTC as `video.srcObject`, or a URI string via `video.src` (played through a `playbin` pipeline). Phase 1.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/video

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/video
yarn add @gjsify/video
```

Requires GStreamer 1.0 with `gtk4paintablesink` (`gstreamer1-plugins-good` + `gstreamer1-plugins-bad-free` on Fedora).

## Usage

```typescript
import { VideoBridge } from '@gjsify/video';

const bridge = new VideoBridge();

bridge.onReady(async (video) => {
    // Play a local file via URI
    video.src = 'file:///path/to/video.mp4';
    await video.play();
});

// Add to a GTK window as a standard widget
window.set_child(bridge);
```

Using a `MediaStream` (e.g. from `getUserMedia`):

```typescript
import { VideoBridge } from '@gjsify/video';

const bridge = new VideoBridge();

bridge.onReady(async (video) => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    await video.play();
});

window.set_child(bridge);
```

## License

MIT
