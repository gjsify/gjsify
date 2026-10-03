import { run } from '@gjsify/unit';
// on('Gl', …) in these specs needs the GTK/GDK probe registered — see `@gjsify/unit/gl`.
import '@gjsify/unit/gl';
import engineBootSuite from './engine-boot.spec.js';
import canvasTextureSuite from './canvas-texture.spec.js';

run({ engineBootSuite, canvasTextureSuite });
