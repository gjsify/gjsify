// Registers: addEventListener, removeEventListener, dispatchEvent on globalThis.
//
// GJS defines `window` itself — non-configurable, read-only, `=== globalThis` — so every
// `typeof window` check in a bundled library reports a browser and takes its browser branch.
// That branch calls `window.addEventListener` (@mtcute/web's 'beforeunload' exit hook), which
// threw `TypeError` on the bare GJS global. A window is an EventTarget; this makes GJS's one.

import { installWindowEventBus, type WindowEventBusHost } from '../window-event-bus.js';

installWindowEventBus(globalThis as WindowEventBusHost);
