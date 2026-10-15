// An out-of-range integer written to a struct field or an object property is REFUSED
// like gjs does, instead of wrapping. The function-argument matrix lives in
// conformance/programs/integer-in-range.conf.mjs (golden = gjs output).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');
const Gio = requireGi('Gio', '2.0');

test('a struct field refuses a value outside its tag range', () => {
    const p = new GLib.PollFD();
    assert.throws(() => (p.events = 70000), /value 70000 is out of range for Field 'events' \(type uint16\)/);
    assert.throws(() => (p.events = -1), /value -1 is out of range for Field 'events' \(type uint16\)/);
    p.events = 5;
    assert.equal(p.events, 5);
});

test('a field of int32 still wraps, as in gjs', () => {
    const p = new GLib.PollFD();
    p.fd = 2 ** 31;
    assert.equal(p.fd, -(2 ** 31));
});

test('a uint property refuses a value outside uint32', () => {
    const c = new Gio.SocketClient();
    assert.throws(() => (c.timeout = -1), /value -1[.,]000000 is out of range for timeout \(type uint32\)/);
    assert.throws(() => (c.timeout = 2 ** 32), /is out of range for timeout \(type uint32\)/);
    c.timeout = NaN;
    assert.equal(c.timeout, 0);
});
