// The GLib half of the vocabulary: the main-loop sources a GNOME app schedules work with —
// `idle_add`, `timeout_add`, `source_remove` and the `PRIORITY_*` / `SOURCE_*` constants. The
// behaviour lives once in `@gjsify/adwaita-core` (`glib-timers.ts`, which states where a host
// event loop cannot honour GLib); this file is the namespace door over the host's `setTimeout`.
//
// A TRUE SUBSET: everything else in GLib (`MainLoop`, `Source`, `timeout_add_seconds`, `Bytes`,
// `build_filenamev`, …) is absent, and the `gi://GLib` arm refuses it by name.

import { createGLibTimers } from '@gjsify/adwaita-core';

const glib = createGLibTimers();

export const PRIORITY_HIGH = glib.PRIORITY_HIGH;
export const PRIORITY_DEFAULT = glib.PRIORITY_DEFAULT;
export const PRIORITY_HIGH_IDLE = glib.PRIORITY_HIGH_IDLE;
export const PRIORITY_DEFAULT_IDLE = glib.PRIORITY_DEFAULT_IDLE;
export const PRIORITY_LOW = glib.PRIORITY_LOW;
export const SOURCE_REMOVE = glib.SOURCE_REMOVE;
export const SOURCE_CONTINUE = glib.SOURCE_CONTINUE;
export const idle_add = glib.idle_add;
export const timeout_add = glib.timeout_add;
export const source_remove = glib.source_remove;
