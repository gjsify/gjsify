import { run } from '@gjsify/unit';
import keyboardSuite from './keyboard.spec.js';
import fontRenderingSuite from './font-rendering.spec.js';
import engineBootSuite from './engine-boot.spec.js';

run({ keyboardSuite, fontRenderingSuite, engineBootSuite });
