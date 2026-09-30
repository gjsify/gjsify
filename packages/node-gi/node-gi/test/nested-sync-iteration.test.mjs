// SPDX-License-Identifier: MIT
// @gjsify/node-gi — a FOREIGN nested main-context iteration is governed by GLib.
//
// Many GI `*_sync` entry points do not block on a mutex: they nest a
// `g_main_context_iteration(default_ctx, TRUE)` loop and spin it until their own
// source completes (EDataServer.SourceRegistry.new_sync is the shape that
// prompted this test — its nested iteration dispatches unrelated default-context
// sources, measurably so). That loop is started by the LIBRARY, not by this
// addon: `g_in_uv_pump` is FALSE and `g_main_depth()` is 0 throughout its
// prepare/poll phase, so neither pump guard applies and the UvLoopSource
// prepares into it like any other source.
//
// The contract this pins: the nested wait ends when GLIB's deadline comes due,
// never when libuv's does. UvLoopSource::prepare reports `uv_backend_timeout()`
// as its poll timeout, and GLib composes a context's timeout as the MINIMUM over
// its sources — so a longer (or infinite) uv deadline can only ever be ignored,
// never extend the wait. A regression that let uv's deadline govern would stall
// every nested `*_sync` call behind Node's next timer, and stall it FOREVER when
// libuv is alive on I/O alone (`uv_backend_timeout() == -1`) — the shape that
// hangs a headless CI run rather than failing it.
//
// Measured in CHILD processes, as the other loop-state tests are: under the
// node:test runner libuv is never quiescent (the runner's own IPC and timers
// keep a deadline armed), which is exactly the state the assertion must be able
// to distinguish from. Each child gets a hard spawn timeout so a regression
// fails with a message instead of wedging the suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const giUrl = new URL('../gi.js', import.meta.url).href;

// How long the nested loop's own GLib source takes to come due, and the ceiling
// the measured wait must stay under. The gap is wide on purpose: the failure
// this guards against is a wait pinned to libuv's next deadline (1500 ms here)
// or to no deadline at all, not a few ms of scheduling noise.
const GLIB_DEADLINE_MS = 200;
const UV_DEADLINE_MS = 1500;
const CEILING_MS = 1000;

function childProgram(variant) {
    return `
import net from 'node:net';
import { requireGi } from ${JSON.stringify(giUrl)};

const GLib = requireGi('GLib', '2.0');
const Gio = requireGi('Gio', '2.0');

// An in-flight scope=async GI call: it refs the pump's uv prepare handle, which
// is what puts libuv in the "alive, with a deadline of its own" state the nested
// iteration then has to be independent of.
Gio.File.new_for_path('/etc/hostname').load_contents_async(null, () => {});

${
    variant === 'io'
        ? '// libuv alive on I/O ALONE — no timer, so uv may report no deadline at all.\nconst server = net.createServer();\nserver.listen(0);'
        : variant === 'uvtimer'
          ? `// libuv alive with a deadline far beyond GLib's.\nsetTimeout(() => {}, ${UV_DEADLINE_MS});`
          : '// Control: libuv has nothing of its own pending.'
}

// The nested iteration a *_sync GI call runs internally, waiting on a GLib source.
const ctx = GLib.MainContext.default();
let done = false;
GLib.timeout_add(GLib.PRIORITY_DEFAULT, ${GLIB_DEADLINE_MS}, () => {
    done = true;
    return GLib.SOURCE_REMOVE;
});

const t0 = process.hrtime.bigint();
while (!done) ctx.iteration(true);
console.log('NESTED_MS=' + (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1));
process.exit(0);
`;
}

function measureNestedWait(variant) {
    const dir = mkdtempSync(join(tmpdir(), 'node-gi-nested-sync-'));
    const file = join(dir, `${variant}.mjs`);
    writeFileSync(file, childProgram(variant));
    try {
        const r = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 20000 });
        // A hang is the headline regression, so name it before anything else:
        // spawnSync kills on timeout, which surfaces as a signal and no status.
        assert.equal(
            r.signal,
            null,
            `[${variant}] the nested iteration never returned (killed with ${r.signal}) — ` +
                `libuv's deadline is governing a GLib-owned wait\n${r.stderr ?? ''}`,
        );
        assert.equal(r.status, 0, `[${variant}] child exited ${r.status}\n${r.stderr ?? ''}`);
        const match = /NESTED_MS=([\d.]+)/.exec(r.stdout ?? '');
        assert.ok(match, `[${variant}] child printed no measurement\n${r.stdout}\n${r.stderr}`);
        return Number(match[1]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test("a nested main-context iteration ends on GLib's deadline, not libuv's", () => {
    const idle = measureNestedWait('idle');
    assert.ok(
        idle >= GLIB_DEADLINE_MS * 0.8 && idle < CEILING_MS,
        `nested wait was ${idle}ms — expected ~${GLIB_DEADLINE_MS}ms`,
    );
});

test('a pending Node timer does not extend a nested main-context iteration', () => {
    const measured = measureNestedWait('uvtimer');
    // Pinned to libuv instead of GLib, this would come back at ~UV_DEADLINE_MS.
    assert.ok(
        measured < CEILING_MS,
        `nested wait was ${measured}ms with a ${UV_DEADLINE_MS}ms Node timer pending — ` +
            `expected ~${GLIB_DEADLINE_MS}ms (libuv's deadline is governing the wait)`,
    );
});

test('libuv alive on I/O alone does not extend a nested main-context iteration', () => {
    const measured = measureNestedWait('io');
    // With no uv timer armed, uv_backend_timeout() can be -1 (block indefinitely);
    // taken as the poll deadline that is an unbounded hang, not a slow return.
    assert.ok(
        measured < CEILING_MS,
        `nested wait was ${measured}ms with only a listening socket pending — ` + `expected ~${GLIB_DEADLINE_MS}ms`,
    );
});
