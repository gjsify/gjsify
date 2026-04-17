// Register navigator.mediaDevices on globalThis for GJS.

import { MediaDevices } from '../media-devices.js';

if (typeof (globalThis as any).navigator === 'undefined') {
    (globalThis as any).navigator = {} as any;
}
if (typeof (globalThis as any).navigator.mediaDevices === 'undefined') {
    (globalThis as any).navigator.mediaDevices = new MediaDevices();
}
