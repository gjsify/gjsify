// SPDX-License-Identifier: MIT
//
// The widget-lifetime half of the platform layer. Barrel re-exports only.
//
// Separate from the root entry because it imports Gtk: the root declares itself
// headless and CI walks its import graph to hold that claim.

export { runInScope, signalScope, widgetScope, windowScope, type WidgetScope } from './gtk/scope.js';
export { propertyStream, signalStream, type SignalStreamOptions } from './gtk/signal.js';
