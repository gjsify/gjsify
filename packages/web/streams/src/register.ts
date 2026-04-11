// Catch-all side-effect module: registers ALL WHATWG Stream globals.
// Prefer granular imports when only specific streams are needed.

import './register/readable.js';
import './register/writable.js';
import './register/transform.js';
import './register/text-streams.js';
import './register/queuing.js';
