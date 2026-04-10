import { run } from '@gjsify/unit';
import engineBootSuite from './engine-boot.spec.js';
import canvasTextureSuite from './canvas-texture.spec.js';

run({ engineBootSuite, canvasTextureSuite });
