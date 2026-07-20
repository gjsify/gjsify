// SPDX-License-Identifier: MIT
//
// GTK-GUI-on-node-gi proof — a MINIMAL Libadwaita application whose SINGLE source
// builds AND runs on both GJS and Node.js, rendering a REAL top-level window:
//
//   gjsify build src/app.ts --app gjs   → gjs  -m dist/app.gjs.mjs   (native gi://)
//   gjsify build src/app.ts --app node  → node    dist/app.node.mjs  (@gjsify/node-gi)
//
// It is the GUI capstone of the node-gi reverse bridge: an UNCHANGED
// `Adw.Application` + `Adw.ApplicationWindow` (HeaderBar / WindowTitle / StatusPage)
// realizes + renders through the GdkWayland/GdkX11 (or GdkWin32) backend under
// Node.js exactly as under GJS — beyond the display-free conformance.
//
// SELF-VERIFYING over DBus. `installDevtools(app)` embeds the `@gjsify/devtools`
// control plane (`org.gjsify.Devtools`): launch with `GJSIFY_DEVTOOLS=1` and a tool
// (e.g. `tools/shoot.js`, `gjsify debug`) can `Screenshot`/`DumpTree` the LIVE
// window over the session bus — proving @gjsify/devtools' in-process GSK-renderer
// capture (Gtk.WidgetPaintable → Gsk.Renderer.render_texture → Gdk.Texture PNG)
// works on node-gi against a real toplevel. `installDevtools` is a no-op unless
// `GJSIFY_DEVTOOLS` is truthy, so it is safe to leave wired in.
//
// runAsync — NOT sync run(). A gjsify GTK/Adwaita app MUST run via
// `Adw.Application.runAsync()`: sync `run()` hangs synchronous view loads on their
// spinner under node-gi/gjsify (the promise-job-queue class). node-gi provides the
// GJS-shaped `runAsync` override (defers the blocking run() to a macrotask). The
// `print` global (ambient under GJS, injected by `--globals auto` via the
// `@gjsify/node-gi/globals` shim for the node build) triggers the reverse bridge's
// `@girs/*`-body resolution so `@gjsify/devtools` keeps its real code under
// `--app node`.
//
// Reference: refs/gjs (g_application_run / adw_init), refs/libadwaita
// (ToolbarView / HeaderBar / StatusPage). Copyright (c) GNOME contributors, MIT/LGPL.

import Adw from 'gi://Adw?version=1';
import { installDevtools } from '@gjsify/devtools';

const app = new Adw.Application({ application_id: 'eu.jumplink.NodeGiWindow' });

app.connect('startup', () => {
    // Session bus + object path only exist after the app registers, so wire the
    // devtools control plane from `startup`. No-op returning null unless
    // GJSIFY_DEVTOOLS is truthy — prod-safe.
    installDevtools(app);
});

app.connect('activate', () => {
    const win = new Adw.ApplicationWindow({ application: app });
    win.set_default_size(480, 320);

    const header = new Adw.HeaderBar();
    header.set_title_widget(new Adw.WindowTitle({ title: 'node-gi', subtitle: 'Adwaita on Node.js' }));

    const status = new Adw.StatusPage({
        icon_name: 'application-x-executable-symbolic',
        title: 'Hello from node-gi',
        description: 'A real Adw.ApplicationWindow rendered by @gjsify/node-gi',
    });

    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(header);
    toolbar.set_content(status);
    win.set_content(toolbar);

    win.present();
    print('node-gi-window: presented');
});

print('node-gi-window: start');
await app.runAsync([]);
print('node-gi-window: done');
