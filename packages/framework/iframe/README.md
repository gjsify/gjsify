# @gjsify/iframe

GJS implementation of HTMLIFrameElement using WebKit 6.0. Provides IFrameBridge extending WebKit.WebView with postMessage bridge.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/iframe

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/iframe
yarn add @gjsify/iframe
```

## Usage

```typescript
import { IFrameBridge } from '@gjsify/iframe';

const widget = new IFrameBridge();

widget.onReady((iframe) => {
  iframe.contentWindow?.addEventListener('message', (event) => {
    console.log(event.data);
  });
});

widget.iframeElement.srcdoc = '<h1>Hello</h1>';
window.set_child(widget);
```

## License

MIT
