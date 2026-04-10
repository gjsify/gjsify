
import { run } from '@gjsify/unit';

import canvasTextSuite from './canvas-text.spec.js';
import canvasTransformSuite from './canvas-transform.spec.js';
import canvasDrawimageSuite from './canvas-drawimage.spec.js';
import canvasStateSuite from './canvas-state.spec.js';
import canvasClearingSuite from './canvas-clearing.spec.js';
import canvasImagedataSuite from './canvas-imagedata.spec.js';
import canvasCompositeSuite from './canvas-composite.spec.js';
import canvasColorSuite from './canvas-color.spec.js';

run({
    canvasTextSuite,
    canvasTransformSuite,
    canvasDrawimageSuite,
    canvasStateSuite,
    canvasClearingSuite,
    canvasImagedataSuite,
    canvasCompositeSuite,
    canvasColorSuite,
});
