// SPDX-License-Identifier: MIT
//
// The BROWSER platform entry. A page has no login and no background permission to ask for, so
// every call throws a structured ENOTSUP naming the module and the runtime.
//
// Slot: browser:"none" — a NAMED unsupported stub (resolve-npm/AGENTS.md, classification (C)).

import { BackgroundFlags, createStub } from './stub.js';

const stub = createStub('browser');

export { BackgroundFlags };
export const Portal = stub.Portal;
export const XdpGtk4 = stub.XdpGtk4;
export const requestBackground = stub.requestBackground;
export const setBackgroundStatus = stub.setBackgroundStatus;
