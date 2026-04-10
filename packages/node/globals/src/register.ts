// Catch-all side-effect module: registers ALL Node.js globals on GJS.
// Prefer granular imports (e.g. '@gjsify/node-globals/register/process')
// when only specific globals are needed — the --globals auto mode does this
// automatically.

import './register/process.js';
import './register/buffer.js';
import './register/timers.js';
import './register/encoding.js';
import './register/url.js';
import './register/structured-clone.js';
import './register/microtask.js';
