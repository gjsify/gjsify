// SPDX-License-Identifier: MIT
//
// Effect's platform services over GNOME. Barrel re-exports only.
//
// This entry reaches GLib and GIO and NOTHING from the toolkit, which is what
// `package.json#gjsify.headless` declares and CI holds: a service layer that
// dragged in GTK could not be used from a daemon, a CLI or a test. The widget
// bridges live behind the `/gtk` subpath for that reason.

export { isIoError, reasonOf, toPlatformError } from './errors.js';
export { gioAsync } from './gio-async.js';
export { layer as fileSystemLayer, makeGioFileSystem } from './filesystem.js';
export { layer as pathLayer } from './path.js';
