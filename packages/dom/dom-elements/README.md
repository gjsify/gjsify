# @gjsify/dom-elements

GJS implementation of DOM elements including Node, Element, HTMLElement, HTMLCanvasElement, HTMLImageElement, Document, and more. Backed by GdkPixbuf.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/dom-elements
# or
yarn add @gjsify/dom-elements
```

## Usage

```typescript
import '@gjsify/dom-elements';

// Registers globalThis.document, globalThis.Image, globalThis.HTMLCanvasElement
const img = new Image();
img.src = 'path/to/image.png';

const canvas = document.createElement('canvas');
canvas.width = 800;
canvas.height = 600;
```

## License

MIT
