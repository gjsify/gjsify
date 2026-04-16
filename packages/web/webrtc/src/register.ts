// Catch-all side-effect module: registers all WebRTC globals on GJS.
// Prefer granular imports (e.g. '@gjsify/webrtc/register/data-channel')
// when only specific globals are needed — the --globals auto mode does this
// automatically.

import './register/peer-connection.js';
import './register/data-channel.js';
import './register/error.js';
