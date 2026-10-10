// SPDX-License-Identifier: MIT
// A bare `gpointer` IN argument — `GI_TYPE_TAG_VOID` with is_pointer — accepts null.
//
// The incident: every call carrying a `user_data` pointer of its own failed outright with
// "Unsupported IN argument type tag 0 (milestone 1 supports numbers, booleans and strings)",
// because the IN switch in `src/marshal.cc` had no arm for the tag. `GLib.log_default_handler`
// is the one that mattered: it is the only introspectable way to make GLib write a message to
// file descriptor 1 or 2, and therefore the only way a JS caller can see the Android
// stdout/stderr → logcat redirect at all. Found while measuring exactly that on a device
// (ADR 0105 stage 0), where the probe died in the marshaller instead of printing.
//
// gjs installs `Arg::NullIn` for this tag and writes NULL (refs/gjs/gi/arg-cache.cpp,
// ArgsCache::build_normal_in_arg), so null is the gjs-compatible answer. node-gi refuses a
// non-null value rather than dropping it — see the comment on the arm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');

test('a null user_data marshals, so g_log_default_handler is callable', () => {
    // LEVEL_DEBUG so the message is dropped by g_log_writer_default's own filter (no
    // G_MESSAGES_DEBUG here) and this test stays silent; that the call REACHES GLib is what the
    // child process below proves.
    assert.doesNotThrow(() => {
        GLib.log_default_handler('node-gi-test', GLib.LogLevelFlags.LEVEL_DEBUG, 'quiet', null);
    });
});

test('undefined is accepted the same way — an omitted trailing user_data', () => {
    assert.doesNotThrow(() => {
        GLib.log_default_handler('node-gi-test', GLib.LogLevelFlags.LEVEL_DEBUG, 'quiet', undefined);
    });
});

test('a value that is not null is refused, naming the argument', () => {
    // The discriminator against "accept anything, write NULL": a caller that passes data means
    // it to arrive, and node-gi has no way to deliver it.
    assert.throws(
        () => GLib.log_default_handler('node-gi-test', GLib.LogLevelFlags.LEVEL_DEBUG, 'quiet', 42),
        (err) => {
            assert.ok(err instanceof TypeError, `expected a TypeError, got ${err}`);
            assert.match(err.message, /cannot marshal a JS value into a gpointer/);
            assert.match(err.message, /unused_data/, 'the message must name the argument');
            return true;
        },
    );
});

test('the message really reaches fd 1 and fd 2 — what the Android redirect forwards', () => {
    // In-process this cannot be observed: GLib writes to the descriptor, not through anything
    // JS can intercept. A child whose stdout/stderr are pipes can be read back, and those are
    // the descriptors Android's redirect taps (fd → pipe → logcat, src/android-log.cc).
    //
    // Which level lands where is GLib's, not ours: g_log_writer_standard_streams sends INFO and
    // DEBUG to stdout and everything else to stderr, and INFO is dropped unless its domain is
    // listed in G_MESSAGES_DEBUG. Both descriptors are asserted because the Android redirect
    // installs a separate pipe per descriptor, with a different logcat priority each.
    const source = [
        "import { requireGi } from './gi.js';",
        "const GLib = requireGi('GLib', '2.0');",
        "GLib.setenv('G_MESSAGES_DEBUG', 'node-gi-test', true);",
        "GLib.log_default_handler('node-gi-test', GLib.LogLevelFlags.LEVEL_INFO, 'VOID_ARG_ON_FD1', null);",
        "GLib.log_default_handler('node-gi-test', GLib.LogLevelFlags.LEVEL_MESSAGE, 'VOID_ARG_ON_FD2', null);",
    ].join('\n');
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
        cwd: new URL('..', import.meta.url),
        encoding: 'utf8',
    });
    assert.equal(child.status, 0, `child failed: ${child.stderr}`);
    assert.match(child.stdout, /VOID_ARG_ON_FD1/);
    assert.match(child.stderr, /VOID_ARG_ON_FD2/);
});
