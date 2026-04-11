// Catch-all side-effect module: registers ALL DOM globals on GJS.
// Prefer granular imports (e.g. '@gjsify/dom-elements/register/navigator')
// when only specific globals are needed — the --globals auto mode does this
// automatically.

import './register/document.js';
import './register/canvas.js';
import './register/image.js';
import './register/observers.js';
import './register/font-face.js';
import './register/match-media.js';
import './register/location.js';
import './register/navigator.js';
