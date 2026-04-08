
import { run } from '@gjsify/unit';

import canvasTextSuite from './canvas-text.spec.js';
import canvasTransformSuite from './canvas-transform.spec.js';
import canvasDrawimageSuite from './canvas-drawimage.spec.js';

run({ canvasTextSuite, canvasTransformSuite, canvasDrawimageSuite });
