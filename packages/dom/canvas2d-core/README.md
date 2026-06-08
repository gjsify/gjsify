# @gjsify/canvas2d-core

Headless `CanvasRenderingContext2D` implementation backed by Cairo and PangoCairo, with no GTK dependency. Provides `CanvasRenderingContext2D`, `CanvasGradient`, `CanvasPattern`, `Path2D`, `ImageData`, and a color parser — usable in worker-like contexts. This is the portable core extracted from `@gjsify/canvas2d`; it is auto-registered as the `'2d'` context factory when `@gjsify/dom-elements` is imported.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/canvas2d-core

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/canvas2d-core
yarn add @gjsify/canvas2d-core
```

## Usage

```typescript
import { CanvasRenderingContext2D, ImageData } from '@gjsify/canvas2d-core';

// Create a 200×200 offscreen context backed by a Cairo ImageSurface
const ctx = new CanvasRenderingContext2D(200, 200);

ctx.fillStyle = '#3584e4';
ctx.fillRect(10, 10, 180, 180);

ctx.strokeStyle = '#ffffff';
ctx.lineWidth = 4;
ctx.strokeRect(20, 20, 160, 160);

// Read pixel data
const imageData = ctx.getImageData(0, 0, 200, 200);
console.log(imageData.width, imageData.height); // 200 200
```

## License

MIT
