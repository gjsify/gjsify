// SPDX-License-Identifier: MIT
// @gjsify/node-gi — a foreign "drain until nothing dispatches" loop must terminate.
//
// `while (g_main_context_iteration(ctx, FALSE));` is an ordinary GLib idiom for
// "run whatever is ready, then stop" — `e_source_registry_new_sync()` uses it in
// the dispose path it takes when no D-Bus is reachable. Its termination
// condition is an iteration that dispatches NOTHING, so any source that is
// perpetually ready turns it into an infinite loop, and the caller never returns.
//
// node-gi's UvLoopSource is ready whenever libuv's backend fd is readable, and
// the pump mirrors the GLib context's own poll fds into uv_poll watchers. uv_poll
// is LEVEL-triggered and the watcher callback reads nothing, so a GLib fd that
// stays ready pins uv's backend fd readable — which the UvLoopSource then reads
// as "Node has work". The context's wakeup eventfd is exactly such an fd, and it
// closes the loop on itself: GLib's `block_source()` re-signals it on every
// dispatch, including every dispatch of the UvLoopSource. The pump's own drain
// would clear the GLib side, but it no-ops at `g_main_depth() > 0` — which is
// where a foreign nested iteration runs.
//
// Measured before the fix (Fedora 44, glib 2.88.3), postbote's suite under
// `e_source_registry_new_sync` with both buses dead: 6.9 M UvLoopSource
// dispatches in 20 s at 100 % CPU, `uv_backend_timeout()` sitting at ~4.6 s the
// whole time — not once because Node actually had work. The consumer's CI hung
// 6 h on it. The fix makes the mirrored wake-up an EDGE (the watcher disarms
// itself on its fire; PumpArmWakeups re-arms it on the next libuv turn).
//
// Measured in CHILD processes: the loop is unbounded when it regresses, and the
// spawn timeout is what turns that into a message rather than a wedged runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const giUrl = new URL('../gi.js', import.meta.url).href;
const indexUrl = new URL('../index.js', import.meta.url).href;

// The cap only exists so a regressed child still terminates and can REPORT the
// runaway; it is three orders of magnitude above the handful of dispatches a
// healthy drain does.
const CAP = 50_000;

function childProgram({ alive }) {
    return `
import net from 'node:net';
import { requireGi } from ${JSON.stringify(giUrl)};
import native from ${JSON.stringify(indexUrl)};

const GLib = requireGi('GLib', '2.0');
const Gio = requireGi('Gio', '2.0');

${
    alive
        ? '// libuv alive: with a dead loop the UvLoopSource masks its backend fd out of\n// the poll set and the feedback path does not exist.\nconst server = net.createServer();\nserver.listen(0);'
        : '// Control: libuv has nothing pending.'
}

// Let the pump run a full libuv turn, so it has mirrored the context's poll fds
// (the wakeup eventfd among them) into uv_poll watchers.
await new Promise((resolve) => setTimeout(resolve, 20));
Gio.File.new_for_path('/etc/hostname').load_contents_async(null, () => {});
await new Promise((resolve) => setTimeout(resolve, 20));

// Signal the wakeup eventfd — what any cross-thread g_source_attach does — so
// the mirrored watcher has something to report.
GLib.MainContext.default().wakeup();

let n = 0;
while (native.iterateMainContext(false)) {
    if (++n >= ${CAP}) break;
}
console.log('DISPATCHES=' + n);
process.exit(0);
`;
}

function drainDispatches(variant) {
    const dir = mkdtempSync(join(tmpdir(), 'node-gi-foreign-drain-'));
    const file = join(dir, `${variant}.mjs`);
    writeFileSync(file, childProgram({ alive: variant === 'uv-alive' }));
    try {
        const r = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 20000 });
        assert.equal(
            r.signal,
            null,
            `[${variant}] the child never finished (killed with ${r.signal})\n${r.stderr ?? ''}`,
        );
        assert.equal(r.status, 0, `[${variant}] child exited ${r.status}\n${r.stderr ?? ''}`);
        const match = /DISPATCHES=(\d+)/.exec(r.stdout ?? '');
        assert.ok(match, `[${variant}] child printed no measurement\n${r.stdout}\n${r.stderr}`);
        return Number(match[1]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('a foreign drain loop terminates while libuv is alive', () => {
    const dispatches = drainDispatches('uv-alive');
    assert.ok(
        dispatches < CAP,
        `the drain loop still had work after ${dispatches} dispatches — the UvLoopSource is ` +
            `perpetually ready, so every caller of \`while (g_main_context_iteration(ctx, FALSE));\` hangs`,
    );
});

test('a foreign drain loop terminates with libuv idle', () => {
    const dispatches = drainDispatches('uv-idle');
    assert.ok(dispatches < CAP, `the drain loop dispatched ${dispatches} times with libuv idle`);
});
