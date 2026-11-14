// SPDX-License-Identifier: MIT
//
// The NATIVESCRIPT platform entry: the same named throwing stub as `./browser`, naming this runtime.
// Slot: nativescript:"none".

import { BackgroundFlags, createStub } from './stub.js';

const stub = createStub('nativescript');

export { BackgroundFlags };
export const Portal = stub.Portal;
export const XdpGtk4 = stub.XdpGtk4;
export const requestBackground = stub.requestBackground;
export const setBackgroundStatus = stub.setBackgroundStatus;
