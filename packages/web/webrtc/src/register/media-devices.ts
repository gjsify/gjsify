// Register navigator.mediaDevices on globalThis for GJS.

import { MediaDevices } from '../media-devices.js';

/** Module-local typed view of the navigator namespace this file writes. */
interface _NavigatorGlobals {
    navigator?: { mediaDevices?: MediaDevices };
}

const g = globalThis as unknown as _NavigatorGlobals;

if (typeof g.navigator === 'undefined') {
    g.navigator = {};
}
if (typeof g.navigator!.mediaDevices === 'undefined') {
    g.navigator!.mediaDevices = new MediaDevices();
}
