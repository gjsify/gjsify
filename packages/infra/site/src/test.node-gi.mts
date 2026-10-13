// Node-gi test entry — the image backend against REAL GdkPixbuf on Node, through
// `@gjsify/node-gi` (the sqlite/gamepad/adwaita-core pattern).
//
// HOW IT WIRES UP (`gjsify workspace @gjsify/site run test:gjs-on-node`):
//   • `src/build/image-backend.ts` imports `gi://GdkPixbuf?version=2.0` and nothing else.
//     `--app node` rewrites that literal to `@gjsify/node-gi/gi`'s
//     `requireGi('GdkPixbuf','2.0')`, so the SAME source that runs natively under GJS
//     decides what this host can decode and encode. No test seam, no injected backend.
//   • `requireGi` is imported here by name as well: `detectNodeGiModuleImports` counts a
//     STATIC import of `@gjsify/node-gi/*` as bridge-bound, which flips
//     `nodeGiGlobalsInject` without this entry needing the bare `print(…)` banner.
//
// Only the image suite is registered, NOT the four suites of `test.mts`: those touch no
// GI and already run on Node via `test:node`, so a second copy would measure nothing.
// What this leg adds is the claim ADR 0109 rests on — that ONE image backend really is
// one, byte-for-byte reachable from a runtime that is not GJS.
import { run } from '@gjsify/unit';
import requireGi from '@gjsify/node-gi/gi';

import imagesSuite from './build/images.gjs.spec.js';

void requireGi;

run({ imagesSuite });
