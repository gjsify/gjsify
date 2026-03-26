// GLib MainLoop management for GJS — original implementation
// Provides an implicit event loop analogous to Node.js's built-in event loop.

import type GLib from '@girs/glib-2.0';

/** Sentinel to prevent double-start (setMainLoopHook throws if called twice). */
let _started = false;

/** The singleton MainLoop instance, if created. */
let _loop: GLib.MainLoop | null = null;

/**
 * Ensure a GLib MainLoop is running for async I/O dispatch (Soup.Server,
 * Gio.SocketService, etc.). No-op on Node.js. Idempotent.
 *
 * - Called automatically by `http.Server.listen()`, `net.Server.listen()`,
 *   `dgram.Socket.bind()` etc.
 * - GTK apps should NOT call this — they use `Gtk.Application.runAsync()` instead.
 *
 * @returns The MainLoop instance on GJS, or `undefined` on Node.js.
 */
export function ensureMainLoop(): GLib.MainLoop | undefined {
  const gjsImports = (globalThis as any).imports;
  if (!gjsImports) return undefined; // Not GJS
  if (_started) return _loop!;

  const GLibModule = gjsImports.gi.GLib;
  _loop = new GLibModule.MainLoop(null, false);
  _started = true;

  try {
    (_loop as any).runAsync();
  } catch {
    // setMainLoopHook throws if Gtk.Application.runAsync() was called first.
    // In that case, the main loop is already running — no action needed.
  }

  return _loop;
}

/**
 * Quit the MainLoop created by `ensureMainLoop()`. Idempotent, no-op on Node.js.
 *
 * Calling `quit()` on a loop that hasn't started yet pre-quits it — when the
 * `setMainLoopHook` later fires and calls `run()`, it returns immediately.
 * This is used by `@gjsify/unit` to prevent the loop from blocking after tests.
 */
export function quitMainLoop(): void {
  if (_loop) {
    _loop.quit();
    _started = false;
    _loop = null;
  }
}
