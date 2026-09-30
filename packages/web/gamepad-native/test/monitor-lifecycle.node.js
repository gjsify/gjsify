// The same zero-device lifecycle as monitor-lifecycle.gjs.js, but under NODE on the
// @gjsify/node-gi reverse bridge — the runtime a `--app node` consumer and a Windows
// program reach `gi://` through (ADR 0075 Amendment 1, ADR 0024 § 4). It is the
// parallel leg of the gjs one, not a copy of it: the question it answers is what
// changes when girepository is the addon instead of GJS — the typelib resolves,
// `Monitor.new()`'s `GLib.Error`, `(transfer container)`/`(array)` returns, and a
// thread-default main context that only node-gi's uv pump ever drains.
//
// Plain JS, like the gjs leg: meson runs it with the build directory on the typelib
// path, before any TypeScript of this repo is built, and no bundler is involved.
//
// THE SPECIFIER IS RELATIVE, and it has to be. `@gjsify/node-gi` is NOT a workspace
// member (ADR 0005 — it ships its own CI and its own release), so nothing in a
// checked-out tree wires `node_modules/@gjsify/node-gi` for this package, and a bare
// specifier here would resolve in CI and fail on every contributor's laptop. What the
// test needs is the addon, and that is what meson checks before it registers this
// test at all (see `monitor-lifecycle-node` in meson.build) — `npm install` in
// packages/node-gi/node-gi is what builds it.

const CYCLES = 20;
const expected = Number(process.env.GJSIFY_GAMEPAD_EXPECT_DEVICES ?? '0');

/** One controller's snapshot shape, as the source relies on it. */
function assert(condition, message) {
    if (!condition) throw new Error(`assertion failed: ${message}`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resolved against THIS FILE, not the process's working directory: meson runs a test
// from the build directory, which sits one level below the package.
const { requireGi } = await import(new URL('../../../node-gi/node-gi/gi.js', import.meta.url).href);

const GjsifyGamepad = requireGi('GjsifyGamepad', '1.0');

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

// The monitor's own GLib timeout runs update() on the thread-default main context.
// There is no GLib.MainLoop here and none is needed: node-gi's non-blocking pump
// dispatches the context from libuv, so an ordinary timer is the equivalent wait. On
// a host with no controller that has no observable effect, so what this proves is
// that the timeout fires against a live monitor without fault and that close()
// afterwards removes it (a source left behind would fire on a closed monitor) —
// exactly the observable the gjs leg asserts.
const monitor = GjsifyGamepad.Monitor.new();
await sleep(350);
monitor.close();

console.log(`monitor-lifecycle.node: ${CYCLES} cycles, ${expected} device(s), ok`);
