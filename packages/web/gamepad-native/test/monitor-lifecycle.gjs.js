// The same zero-device lifecycle as monitor-lifecycle.c, but through the TYPELIB
// under gjs — the path @gjsify/gamepad takes. It proves what the C test cannot:
// that the GIR annotations hold (the constructor throws a GLib.Error rather than
// returning null, get_devices() is a JS array, the snapshot arrays have their
// W3C lengths) and that a GLib main loop drives the monitor's own timeout.
// Plain JS on purpose: meson runs it with the build directory on the typelib
// path, before any TypeScript of this repo is built.

import GLib from 'gi://GLib?version=2.0';
import GjsifyGamepad from 'gi://GjsifyGamepad?version=1.0';

const CYCLES = 20;
const expected = Number(GLib.getenv('GJSIFY_GAMEPAD_EXPECT_DEVICES') ?? '0');

function assert(condition, message) {
    if (!condition) throw new Error(`assertion failed: ${message}`);
}

function runLoopFor(ms) {
    const loop = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop.run();
}

for (let cycle = 0; cycle < CYCLES; cycle++) {
    const monitor = GjsifyGamepad.Monitor.new();
    let added = 0;
    monitor.connect('device-added', (_monitor, device) => {
        added++;
        assert(device.get_buttons().length === 17, 'a snapshot has 17 W3C buttons');
        assert(device.get_axes().length === 4, 'a snapshot has 4 W3C axes');
    });
    monitor.update();
    const devices = monitor.get_devices();
    assert(Array.isArray(devices), 'get_devices() is a JS array');
    assert(devices.length === expected, `${expected} device(s) enumerated, got ${devices.length}`);
    assert(added === expected, `${expected} device-added emission(s), got ${added}`);
    monitor.close();
    monitor.close();
}

// The monitor's own GLib timeout runs update() while a main loop spins. On a host
// with no controller that has no observable effect, so what this proves is that the
// timeout fires against a live monitor without fault and that close() afterwards
// removes it (a source left behind would fire on a closed monitor).
const monitor = GjsifyGamepad.Monitor.new();
runLoopFor(350);
monitor.close();

console.log(`monitor-lifecycle.gjs: ${CYCLES} cycles, ${expected} device(s), ok`);
