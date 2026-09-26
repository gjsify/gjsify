// `navigator` is Node's DOM-less one (Node ≥21 has it bare), owned by @gjsify/node-globals; this
// subpath stays so existing imports keep working. `navigator.getGamepads` comes from
// @gjsify/gamepad/register, `navigator.mediaDevices` from @gjsify/webrtc.

import '@gjsify/node-globals/register/navigator';
