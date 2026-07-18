// SPDX-License-Identifier: MIT OR LGPL-2.0-or-later
// SPDX-FileCopyrightText: 2012 Giovanni Campagna <scampa.giovanni@gmail.com>
//
// Adapted from GJS (refs/gjs/modules/script/mainloop.js). Copyright (c) 2012
// Giovanni Campagna. MIT OR LGPL-2.0-or-later.
// Modifications: the legacy `imports.mainloop` — a thin convenience layer over
// GLib.MainLoop — ported to @gjsify/node-gi. GJS builds the idle/timeout sources
// via GObject.source_set_closure; this port routes through GLib.idle_add /
// GLib.timeout_add directly instead (equivalent behavior, one less indirection —
// the engine marshals JS functions both as GI callbacks and as GClosures, see
// test/gclosure-in-args.test.mjs), keeping the same `imports.mainloop.*` surface.

const DEFAULT_IDLE_PRIORITY = 200; // GLib.PRIORITY_DEFAULT_IDLE

/**
 * Build the `imports.mainloop` object bound to the L1 GLib namespace.
 * @param {Record<string, any>} GLib
 * @returns {{ run(name?: string): void, quit(name?: string): void, idle_add: Function, timeout_add: Function, timeout_add_seconds: Function, source_remove: Function }}
 */
export function createMainloop(GLib) {
  const _mainLoops = Object.create(null);

  function run(name = '') {
    if (!_mainLoops[name]) _mainLoops[name] = GLib.MainLoop.new(null, false);
    _mainLoops[name].run();
  }

  function quit(name = '') {
    if (!_mainLoops[name]) throw new Error('No main loop with this id');

    const loop = _mainLoops[name];
    _mainLoops[name] = null;

    if (!loop.is_running()) throw new Error('Main loop was stopped already');

    loop.quit();
  }

  // GJS signature is `idle_add(handler, priority)` — handler first — whereas the
  // introspected GLib.idle_add is `(priority, handler)`; bridge the argument order.
  function idle_add(handler, priority = DEFAULT_IDLE_PRIORITY) {
    return GLib.idle_add(priority, handler);
  }

  function timeout_add(timeout, handler, priority = GLib.PRIORITY_DEFAULT) {
    return GLib.timeout_add(priority, timeout, handler);
  }

  function timeout_add_seconds(timeout, handler, priority = GLib.PRIORITY_DEFAULT) {
    return GLib.timeout_add_seconds(priority, timeout, handler);
  }

  function source_remove(id) {
    return GLib.source_remove(id);
  }

  return { run, quit, idle_add, timeout_add, timeout_add_seconds, source_remove };
}

export default createMainloop;
