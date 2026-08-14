// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the uv pump must never leave the GMainContext prepared.
//
// REGRESSION GUARD for gjsify #1145. The uv-driven pump arms libuv's wake-ups by
// running `g_main_context_prepare()` + `g_main_context_query()` on the default
// context; for its whole life it stopped there, on the reasoning that "the next
// iteration simply re-prepares". A GSource may hold a LOCK across that pair, and
// GDK's Wayland event source does: its prepare() takes libwayland's designated-
// reader slot and only its check() gives it back. So the pass leaked the reader
// slot, and the next `wl_display_roundtrip` — inside `gtk_window_present()`, where
// GTK realizes the GSK renderer — blocked the main thread forever.
//
// What it LOOKED like is why this test is worth its gates: the process stayed
// alive, its GDBus worker thread kept answering Peer.Ping and Introspect, and every
// @gjsify/devtools method timed out. That was read as "devtools hangs when the bus
// name is the application id" and produced a wrong NO_WINDOW verdict for a working
// showcase in the 0.38.0 cross-OS matrix. Nothing about DBus was involved, which is
// why the fixture owns no bus name at all.
//
// SELF-SKIPPING, and it states its own gate rather than reusing `haveDisplay`:
// only a WAYLAND session can show this (GdkX11's event source holds nothing across
// prepare/check, so the same program is green under Xvfb — the CI gtk-smoke job
// pins GDK_BACKEND=x11). Set NODE_GI_REQUIRE_WAYLAND=1 to turn the skip into a
// failure, so a leg that provisioned a compositor cannot pass by skipping.
//
// The child runs in its own process because the pre-fix failure is a hard block of
// the main thread inside GTK: node:test's own timeout cannot reclaim a thread that
// is parked in `pthread_cond_wait` under libffi, so the whole runner would wedge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireGi } from '../gi.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/wayland-prepare-check-app.mjs', import.meta.url));

/** The compositor socket `GDK_BACKEND=wayland` will dial, or null. */
function waylandSocket() {
    const display = process.env.WAYLAND_DISPLAY;
    if (!display) return null;
    if (isAbsolute(display)) return existsSync(display) ? display : null;
    const runtimeDir = process.env.XDG_RUNTIME_DIR;
    if (!runtimeDir) return null;
    const path = join(runtimeDir, display);
    return existsSync(path) ? path : null;
}

/** Does the Gtk-4.0 typelib load? A dev box without gtk4-devel must skip, not fail. */
function haveGtk() {
    try {
        requireGi('Gtk', '4.0');
        return true;
    } catch {
        return false;
    }
}

const socket = process.platform === 'linux' ? waylandSocket() : null;
const reason = !socket
    ? 'no Wayland session (WAYLAND_DISPLAY + its socket): GdkX11 cannot reproduce this'
    : !haveGtk()
      ? 'the Gtk-4.0 typelib does not load'
      : null;

if (reason && process.env.NODE_GI_REQUIRE_WAYLAND === '1') {
    // The leg asked for this proof, so its absence is a failure, not silence.
    test('the uv pump leaves no GSource prepared across a Wayland roundtrip', () => {
        assert.fail(`NODE_GI_REQUIRE_WAYLAND=1 but the test cannot run: ${reason}`);
    });
} else {
    test(
        'the uv pump leaves no GSource prepared across a Wayland roundtrip',
        { skip: reason ?? false, timeout: 90 * 1000 },
        () => {
            const r = spawnSync(process.execPath, [FIXTURE], {
                encoding: 'utf8',
                timeout: 45 * 1000,
                env: { ...process.env, GDK_BACKEND: 'wayland' },
            });
            const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
            // The child prints REGISTERED before the window, so a missing
            // PRESENT_RETURNED after a present REGISTERED is the deadlock itself
            // rather than a compositor that refused the connection.
            assert.match(out, /REGISTERED/, `the fixture must reach GApplication.register().\n${out}`);
            assert.notEqual(
                r.signal,
                'SIGTERM',
                'gtk_window_present() never returned: the uv pump left the default GMainContext ' +
                    "prepared, so GDK's Wayland source still holds libwayland's reader slot and the " +
                    `GSK renderer's roundtrip deadlocks (gjsify #1145).\n${out}`,
            );
            assert.match(out, /PRESENT_RETURNED/, `gtk_window_present() must return.\n${out}`);
            assert.match(out, /RUN_RETURNED 0/, `the application must run and quit cleanly.\n${out}`);
            assert.equal(r.status, 0, `the fixture must exit 0.\n${out}`);
        },
    );
}
