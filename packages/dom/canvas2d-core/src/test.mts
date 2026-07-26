import { run } from '@gjsify/unit';

// The specs below exercise `getImageData` / `putImageData` / `drawImage` /
// `createPattern`, which go through the injected pixel-interop seam
// (`src/pixel-bridge.ts`). Install the GDK-backed implementation — the same
// module `@gjsify/dom-elements` and `@gjsify/canvas2d` pull in — so the core's
// own suite runs standalone without depending on either consumer.
import './gdk-pixel-bridge.js';

import canvasTextSuite from './canvas-text.spec.js';
import canvasTransformSuite from './canvas-transform.spec.js';
import canvasDrawimageSuite from './canvas-drawimage.spec.js';
import canvasStateSuite from './canvas-state.spec.js';
import canvasClearingSuite from './canvas-clearing.spec.js';
import canvasImagedataSuite from './canvas-imagedata.spec.js';
import canvasCompositeSuite from './canvas-composite.spec.js';
import canvasColorSuite from './canvas-color.spec.js';
import pixelBridgeSuite from './pixel-bridge.spec.js';

run({
    pixelBridgeSuite,
    canvasTextSuite,
    canvasTransformSuite,
    canvasDrawimageSuite,
    canvasStateSuite,
    canvasClearingSuite,
    canvasImagedataSuite,
    canvasCompositeSuite,
    canvasColorSuite,
});
