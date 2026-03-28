# @gjsify/canvas2d

GJS implementation of CanvasRenderingContext2D using Cairo and PangoCairo. Provides Canvas2DWidget extending Gtk.DrawingArea.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/canvas2d
# or
yarn add @gjsify/canvas2d
```

## Usage

```typescript
import { Canvas2DWidget } from '@gjsify/canvas2d';

const widget = new Canvas2DWidget();
widget.installGlobals();

widget.onReady((canvas, ctx) => {
  ctx.fillStyle = 'red';
  ctx.fillRect(0, 0, 100, 100);
});

window.set_child(widget);
```

## License

MIT
