// SPDX-License-Identifier: MIT
// Function-call / value-marshalling tests for @gjsify/node-gi (milestone 1).
// Exercises the GIArgument <-> JS boundary through real GLib functions:
// number args/returns, string (utf8/filename) args/returns with transfer-full
// free, and boolean returns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostname } from 'node:os';

import { callFunction, requireNamespace } from '../index.js';

test('string return, no args: GLib.get_host_name()', () => {
    requireNamespace('GLib', '2.0');
    const name = callFunction('GLib', 'get_host_name');
    assert.equal(typeof name, 'string');
    assert.ok(name.length > 0);
    assert.equal(name, hostname());
});

test('int args + int return: GLib.random_int_range(5, 6) === 5', () => {
    // [begin, end) with begin=5, end=6 deterministically yields 5.
    const n = callFunction('GLib', 'random_int_range', [5, 6]);
    assert.equal(n, 5);
});

test('filename arg + transfer-full filename return: GLib.path_get_basename', () => {
    const base = callFunction('GLib', 'path_get_basename', ['/foo/bar/baz.txt']);
    assert.equal(base, 'baz.txt');
});

test('utf8 args + boolean return: GLib.str_has_prefix', () => {
    assert.equal(callFunction('GLib', 'str_has_prefix', ['hello', 'he']), true);
    assert.equal(callFunction('GLib', 'str_has_prefix', ['hello', 'xy']), false);
});

test('clear error for a non-function symbol', () => {
    assert.throws(() => callFunction('GLib', 'MainLoop'), /is not a function/);
});

test('clear error for a missing symbol', () => {
    assert.throws(() => callFunction('GLib', 'no_such_function_xyz'), /No such symbol/);
});
