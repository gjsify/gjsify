// SPDX-License-Identifier: MIT
// @gjsify/node-gi — Adw.Application smoke test (GTK layering milestone, PR2).
//
// Builds on the PR1 Gtk.Application proof: an UNCHANGED Libadwaita app runs on
// Node via the node-gi engine with PROPER Adwaita window chrome and a CSS
// provider — the breadth step that shows the marshalling foundation already
// supports a real Adw app, no engine changes.
//
// What it exercises (all through the existing marshalling paths):
//   - Adw.Application construction + connect('activate') + the libuv↔GLib bridge
//     (an Adw.Application drives g_application_run just like Gtk.Application; Adw
//     runs adw_init() in its startup vfunc, so widgets are styled).
//   - Adw.ApplicationWindow({ application: app }) — the object-typed construct
//     property (G_TYPE_OBJECT) marshalled by JsToGValue (the PR1 engine fix).
//   - Adwaita chrome: Adw.ToolbarView with an Adw.HeaderBar top bar (carrying an
//     Adw.WindowTitle) over an Adw.StatusPage content — object method arguments
//     (add_top_bar / set_content) routed by JsToGIArgument GI_TYPE_TAG_INTERFACE.
//   - CSS: a Gtk.CssProvider.load_from_string(css), Gdk.Display.get_default()
//     (static → object return), Gtk.StyleContext.add_provider_for_display(
//     display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION) (a static
//     method with two object args + a uint constant), then add_css_class() on a
//     widget — asserted to have taken effect via has_css_class().
//   - win.present() then quit from a GLib timeout running INSIDE the loop.
//
// SELF-SKIPPING: needs a display (DISPLAY / WAYLAND_DISPLAY) and the Adw-1 /
// Gtk-4.0 typelibs, so the fast headless `npm test` / `test:gc` legs skip it
// cleanly; the dedicated `gtk-smoke` CI job (Xvfb + GTK/Adw stack) runs it.
//
// run() is called at the TOP LEVEL of a synchronous test body (not inside an
// async scope) so the node-gtk #442 nested-microtask-checkpoint caveat does not
// bite; the quit is driven from a GLib timeout running INSIDE the loop.
//
// Reference: refs/gjs (g_application_run / adw_init semantics), refs/libadwaita
// (ToolbarView / HeaderBar / StatusPage), refs/node-gtk src/loop.cc (MIT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

const haveDisplay = !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

// Resolve the Adw + GTK stack up front: a missing Adw-1 / Gtk-4.0 typelib (a
// headless dev box without libadwaita-devel) must SKIP, not throw.
let Adw;
let Gtk;
let Gdk;
let Gio;
let GLib;
let loadError = null;
if (haveDisplay) {
  try {
    GLib = requireGi('GLib', '2.0');
    Gio = requireGi('Gio', '2.0');
    Gdk = requireGi('Gdk', '4.0');
    Gtk = requireGi('Gtk', '4.0');
    Adw = requireGi('Adw', '1');
  } catch (err) {
    loadError = err;
  }
}

const skip = !haveDisplay
  ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)'
  : loadError
    ? `Adw-1 / Gtk-4.0 typelib unavailable: ${loadError.message}`
    : false;

// The runtime running THIS file. Two INDEPENDENT properties are under test and
// must stay apart: the Adwaita half is portable (a blocking
// `Adw.Application.run()` is driven by GLib, not by the host loop), while the
// libuv co-pump is Node-only by design — Bun and Deno drive GLib from the
// portable `startMainContextPump`, so a blocking run() does not advance their
// loop. Asserting both at once reports a missing Node-only extra as a missing
// Adwaita capability.
const RUNTIME =
  typeof globalThis.Bun !== 'undefined' ? 'bun' : typeof globalThis.Deno !== 'undefined' ? 'deno' : 'node';
const EXPECT_UV_COPUMP = RUNTIME === 'node';

test('Adw.Application runs Adwaita chrome + CSS', { skip }, () => {
  const app = new Adw.Application({
    application_id: 'eu.jumplink.NodeGiAdw',
    flags: Gio.ApplicationFlags.NON_UNIQUE, // no session-bus uniqueness round-trip
  });

  let activated = false;
  let cssClassApplied = false;
  let activateError = null;

  // Scheduled on libuv BEFORE the blocking run(). Fires only if the Adw loop
  // co-pumps Node's event loop during g_application_run.
  global.__adwUvTimerFired = false;
  setTimeout(() => {
    global.__adwUvTimerFired = true;
  }, 10);

  app.connect('activate', () => {
    try {
      activated = true;

      // Object-typed construct property (G_TYPE_OBJECT) — the PR1 JsToGValue fix.
      const win = new Adw.ApplicationWindow({ application: app });
      win.set_default_size(320, 200);

      // Adwaita window chrome: HeaderBar (with a WindowTitle) inside a ToolbarView
      // above an StatusPage content.
      const headerBar = new Adw.HeaderBar();
      const title = new Adw.WindowTitle({ title: 'node-gi', subtitle: 'Adwaita on Node' });
      headerBar.set_title_widget(title); // object method argument

      const status = new Adw.StatusPage({
        title: 'Hello from node-gi',
        description: 'An unchanged Libadwaita app on Node.js',
      });

      const toolbar = new Adw.ToolbarView();
      toolbar.add_top_bar(headerBar); // object method argument
      toolbar.set_content(status); // object method argument
      win.set_content(toolbar); // object method argument

      // CSS provider applied display-wide, then a class added to a widget.
      const provider = new Gtk.CssProvider();
      provider.load_from_string('.node-gi-card { padding: 12px; background: #3584e4; }');
      const display = Gdk.Display.get_default(); // static → Gdk.Display object
      Gtk.StyleContext.add_provider_for_display(
        display,
        provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION, // uint constant
      );
      status.add_css_class('node-gi-card');
      cssClassApplied = status.has_css_class('node-gi-card'); // proof the class stuck

      win.present();

      // Quit from a timeout running INSIDE the Adw loop → run() returns
      // cleanly. Quit once the libuv timer has been OBSERVED (the co-pump
      // proof), with a bounded cap so a genuinely-starved loop still exits and
      // fails the assert instead of hanging. A fixed 50 ms quit used to race:
      // the uv co-pump source sits BELOW GDK_PRIORITY_REDRAW (loop.cc — GTK
      // rendering outranks Node timers, browser-like), so the 10 ms timer is
      // legitimately delayed past the window's first paint cycles.
      //
      // Off Node there is no co-pump to wait for, so waiting for the flag would
      // burn the full cap on every run for a timer that by design never fires —
      // quit as soon as the widget work is done instead.
      let waitedMs = 0;
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
        waitedMs += 50;
        if (!EXPECT_UV_COPUMP || global.__adwUvTimerFired || waitedMs >= 2000) {
          app.quit();
          return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
      });
    } catch (err) {
      activateError = err;
      app.quit();
    }
  });

  const status = app.run([]); // top-level blocking run (no async wrapper)

  try {
    assert.equal(activateError, null, `activate handler threw: ${activateError && activateError.stack}`);
    assert.equal(status, 0, 'app.run([]) should exit 0');
    assert.equal(activated, true, 'the activate signal handler should have run');
    assert.equal(cssClassApplied, true, 'add_css_class should take effect (has_css_class true)');

    // Node-only: the uv-nesting bridge co-pumps libuv during the blocking GLib
    // loop. On bun/deno the portable pump is not active while run() blocks, so
    // this timer legitimately does not fire — assert the DIFFERENCE rather than
    // skipping, so a regression in either direction is caught.
    assert.equal(
      global.__adwUvTimerFired,
      EXPECT_UV_COPUMP,
      EXPECT_UV_COPUMP
        ? 'libuv must advance (setTimeout fires) during the blocking g_application_run'
        : `${RUNTIME}: a blocking run() is not expected to advance the runtime loop (no uv co-pump)`,
    );
  } finally {
    delete global.__adwUvTimerFired;
  }
});
