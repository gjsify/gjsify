// Only the real-GLArea HiDPI contract, so a harness can run it under a scale
// override (`GDK_SCALE=2` on X11) without putting the whole suite through it.
import { run } from '@gjsify/unit';
// on('Gl', …) in hidpi.spec.ts needs the GTK/GDK probe registered — see `@gjsify/unit/gl`.
import '@gjsify/unit/gl';
import hidpiSuite from './hidpi.spec.js';

run({ testSuite: hidpiSuite });
