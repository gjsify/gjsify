// SPDX-License-Identifier: MIT
// @gjsify/node-gi — JS microtasks must not run while GDK's Wayland source holds
// libwayland's reader slot. A promise continuation that closes a window (GSK
// renderer unrealize -> wl_display_roundtrip) deadlocked the main thread when the
// drain ran from the uv source's prepare, after GDK's own prepare. See the drain
// source in src/loop.cc. Wayland-only and self-skipping, like
// wayland-prepare-check.test.mjs; NODE_GI_REQUIRE_WAYLAND=1 turns the skip into a
// failure. The child is a separate process because the failure is a hard block of
// the main thread inside GTK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireGi } from '../gi.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/wayland-microtask-close-app.mjs', import.meta.url));

function waylandSocket() {
    const display = process.env.WAYLAND_DISPLAY;
    if (!display) return null;
    if (isAbsolute(display)) return existsSync(display) ? display : null;
    const runtimeDir = process.env.XDG_RUNTIME_DIR;
    if (!runtimeDir) return null;
    const path = join(runtimeDir, display);
    return existsSync(path) ? path : null;
}

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

const NAME = 'a window closed from a microtask does not deadlock on the Wayland reader slot';

if (reason && process.env.NODE_GI_REQUIRE_WAYLAND === '1') {
    test(NAME, () => {
        assert.fail(`NODE_GI_REQUIRE_WAYLAND=1 but the test cannot run: ${reason}`);
    });
} else {
    test(NAME, { skip: reason ?? false, timeout: 90 * 1000 }, () => {
        const r = spawnSync(process.execPath, [FIXTURE], {
            encoding: 'utf8',
            timeout: 45 * 1000,
            env: { ...process.env, GDK_BACKEND: 'wayland' },
        });
        const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
        assert.match(out, /PRESENT_RETURNED/, `the window must present.\n${out}`);
        assert.notEqual(
            r.signal,
            'SIGTERM',
            `the application never exited after win.close() in a microtask: the microtask drain ran while GDK's Wayland source held the reader slot.\n${out}`,
        );
        assert.match(out, /RUN_RETURNED 0/, `the application must exit cleanly after the last window closes.\n${out}`);
        assert.equal(r.status, 0, `the fixture must exit 0.\n${out}`);
    });
}
