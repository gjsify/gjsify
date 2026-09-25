// The shim through @gjsify/node-gi — how Windows reaches it, since there is no GJS
// for Windows (ADR 0024 § 4): Node is the runtime there and node-gi is its
// GObject path. The same zero-device lifecycle as monitor-lifecycle.gjs.js, so a
// pass means the typelib records a leaf that loads, the GIR annotations hold
// under node-gi's marshalling, and SDL starts and stops in a Node process.
//
// Run from the repository root with the prebuild directory on GI_TYPELIB_PATH and
// on the DLL search path (PATH on win32, LD_LIBRARY_PATH elsewhere):
//   node packages/web/gamepad-native/test/probe-node-gi.mjs

import { requireGi } from '../../../node-gi/node-gi/gi.js';

const CYCLES = 20;
const expected = Number(process.env.GJSIFY_GAMEPAD_EXPECT_DEVICES ?? '0');

function assert(condition, message) {
    if (!condition) throw new Error(`assertion failed: ${message}`);
}

const GjsifyGamepad = requireGi('GjsifyGamepad', '1.0');
assert(typeof GjsifyGamepad?.Monitor === 'function', 'gi://GjsifyGamepad exposes Monitor');

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

console.log(
    `probe-node-gi: gi://GjsifyGamepad under node ${process.version} (${process.platform}-${process.arch}), ` +
        `${CYCLES} cycles, ${expected} device(s), ok`,
);
