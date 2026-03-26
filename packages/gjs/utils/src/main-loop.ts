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

  // Only call runAsync() if no mainloop is currently running on the default
  // context. If one is already running (e.g., test runner's mainloop.run()
  // or Gtk.Application.runAsync()), async I/O already works through the
  // shared default context — calling runAsync() would register a
  // setMainLoopHook whose loop.run() blocks forever after tests quit it
  // (g_main_loop_run resets the quit flag on entry).
  if (GLibModule.main_depth() === 0) {
    try {
      (_loop as any).runAsync();
    } catch {
      // setMainLoopHook throws if already called (e.g., Gtk.Application.runAsync()).
      // In that case, a main loop hook is already registered — no action needed.
    }
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
