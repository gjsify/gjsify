// Catch-all side-effect module: registers ALL DOM Event classes as globals.
// Prefer granular imports when only specific events are needed.

import './register/event-target.js';
import './register/custom-events.js';
import './register/ui-events.js';
