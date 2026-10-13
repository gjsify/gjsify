// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the OBJECT a GError is, measured against gjs 1.88.1.
//
// node-gi used to hand out TWO different JS objects for one GError: an L1 `Error`
// subclass for a thrown one (`.domain` the quark NAME string, the numeric quark on
// a `.domainQuark` that exists nowhere else), and a boxed handle over the real
// `GError*` for a marshalled one (`.domain` the numeric quark). gjs has ONE shape
// for both — a boxed `GError*` whose class is the error DOMAIN's class — so every
// cross-runtime source that touches an error had to branch on the runtime:
//   * `instanceof Error` was true here and is FALSE under gjs (`@gjsify/gtk-host`'s
//     font-map probe documents that, and `@gjsify/console` formats on it);
//   * `err.domain` was a string here and a number there, so one comparison cannot
//     serve both legs — `packages/node/sqlite`'s errors and the ADR 0100
//     file-chooser vectors each carried a node-gi-only arm;
//   * a caught error's CLASS was `GLib.Error` whatever the domain, so
//     `catch (e) { if (e instanceof Gio.IOErrorEnum) … }` — the gjs idiom — never
//     took the branch.
//
// Every expectation below was measured on this host with `gjs -m` first, and the
// one that looks like noise is the load-bearing one: whether an error carries the
// four own keys `stack`/`fileName`/`lineNumber`/`columnNumber` depends on BOTH how
// it was produced and whether its domain is a registered one.
//
//   produced by                                    known domain   unknown domain
//   thrown · new GLib.Error(…) · new Domain({…})    present        present
//   marshalled · copy() · IN arg · new_literal      ABSENT         present
//
// gjs's `gjs_define_error_properties` has exactly three call sites that explain
// it: the GError constructor, `gjs_throw_gerror` — and `gi/struct.cpp`, which an
// UNKNOWN domain reaches because `ErrorInstance::object_for_c_ptr` has no domain
// metadata to build a class from and falls back to wrapping the GError as a plain
// `GLib.Error` struct. Replicated with the asymmetry intact, because a suite
// comparing the two runtimes' own-key sets is what this file exists to serve.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');
const Gio = requireGi('Gio', '2.0');
const GObject = requireGi('GObject', '2.0');

// A private error domain, so no other test's quark can make an assertion pass.
const DOMAIN_NAME = 'node-gi-gerror-identity-test';
const DOMAIN = GLib.quark_from_string(DOMAIN_NAME);
const OTHER_DOMAIN = GLib.quark_from_string('node-gi-gerror-identity-test-other');

/** gjs's error-position properties, in the order `gjs_define_error_properties` defines them. */
const POSITION_KEYS = ['stack', 'fileName', 'lineNumber', 'columnNumber'];

/**
 * True when `value` carries the internal error slot — gjs spells this `Error.isError`,
 * but that landed in node 24 and this suite's CI job runs node 22, where it is not a
 * function. `Object.prototype.toString` has reported the same slot as `[object Error]`
 * since ES5, so it reads the brand on both.
 */
function hasErrorSlot(value) {
    return Object.prototype.toString.call(value) === '[object Error]';
}

/** The error `Gio.File.load_contents` throws for a missing path — the shape an application catches. */
function caughtIoError() {
    try {
        Gio.File.new_for_path(`/nonexistent-node-gi-gerror-identity-${process.pid}`).load_contents(null);
    } catch (error) {
        return error;
    }
    return null;
}

// ---- the brand: an Error that is not an Error subclass ----------------------

test('a GError is an Error by BRAND but not by prototype chain, as on gjs', () => {
    const thrown = caughtIoError();
    assert.notEqual(thrown, null, 'the failing call must throw — otherwise this proves nothing');

    // The combination is gjs's and is not reachable with `class X extends Error`:
    // the internal error slot is there (so `Error.isError`, node's `util.inspect`
    // and `@gjsify/console` treat it as an error) while `Error.prototype` is NOT on
    // the chain. A `catch (e) { if (e instanceof Error) … }` written for gjs skips
    // a GError, and a test asserting that skip failed here.
    assert.equal(hasErrorSlot(thrown), true, 'the internal error slot must be set');
    assert.equal(thrown instanceof Error, false, 'gjs: a GError is NOT an Error subclass');
    assert.equal(Object.getPrototypeOf(thrown) === Error.prototype, false);
    if (typeof Error.isError === 'function') {
        assert.equal(Error.isError(thrown), true, 'and the gjs spelling agrees where it exists');
    }

    // The marshalled shape carries the same brand — ONE object for both paths.
    const marshalled = GLib.set_error_literal(DOMAIN, 7, 'marshalled');
    assert.equal(hasErrorSlot(marshalled), true, 'a marshalled GError is branded too');
    assert.equal(marshalled instanceof Error, false);
});

test('the CLASS of a GError is its error domain, so instanceof discriminates', () => {
    const thrown = caughtIoError();

    // The gjs idiom this unlocks: branch on the domain class, not on a string.
    assert.ok(thrown instanceof Gio.IOErrorEnum, 'a G_IO_ERROR is an instance of Gio.IOErrorEnum');
    assert.ok(thrown instanceof GLib.Error, 'and of the base class');
    assert.equal(thrown instanceof GLib.FileError, false, 'an unrelated domain must not match');
    assert.equal(thrown.constructor.name, 'Gio_IOErrorEnum', 'gjs spells the class Ns_Type');

    // An UNKNOWN domain (a quark no typelib registers) has no class of its own and
    // falls back to the base — gjs's ErrorInstance::object_for_c_ptr.
    const unknown = GLib.set_error_literal(DOMAIN, 1, 'private domain');
    assert.ok(unknown instanceof GLib.Error);
    assert.equal(unknown instanceof Gio.IOErrorEnum, false);
    assert.equal(unknown.constructor.name, 'GLib_Error');
});

// ---- the fields ------------------------------------------------------------

test('.domain is the NUMERIC GQuark on every shape, and .domainQuark is gone', () => {
    const thrown = caughtIoError();
    const marshalled = GLib.set_error_literal(DOMAIN, 7, 'marshalled');
    const constructed = new GLib.Error(DOMAIN, 3, 'three');

    assert.equal(thrown.domain, Gio.io_error_quark(), 'a THROWN error reports the quark, not its name');
    assert.equal(marshalled.domain, DOMAIN);
    assert.equal(constructed.domain, DOMAIN);

    // The node-gi-only property that forced every consumer to branch: a source
    // reading it got `undefined` under gjs and silently compared against nothing.
    assert.equal('domainQuark' in thrown, false, '.domainQuark does not exist on gjs');
    assert.equal(thrown.domainQuark, undefined);

    assert.equal(thrown.code, Gio.IOErrorEnum.NOT_FOUND);
    assert.equal(typeof thrown.message, 'string');
    assert.ok(thrown.message.length > 0, 'the reason must be readable');
});

test('domain/code/message are getter-only: a write throws, as on gjs', () => {
    const thrown = caughtIoError();
    // gjs reads them off the GError* through a prototype accessor, so there is no
    // slot to write. A consumer "normalising" an error by assigning `.domain` was
    // a silent no-op on one runtime and a real mutation on the other.
    assert.throws(() => {
        'use strict';
        thrown.message = 'rewritten';
    }, TypeError);
    assert.notEqual(thrown.message, 'rewritten');
});

test('.name is not set — the Error name slot stays unused', () => {
    // gjs leaves `name` null/undefined on every GError shape; node-gi set
    // `'GLib.Error'`, which is what `util.inspect` and any `${err.name}: ` log line
    // picks up, so the two runtimes printed different first words for one error.
    const thrown = caughtIoError();
    assert.ok(thrown.name === undefined || thrown.name === null, `name must be unset, got ${thrown.name}`);
});

// ---- the error-position properties -----------------------------------------

const KNOWN = () => Gio.io_error_quark();

test("a thrown or CONSTRUCTED GError carries gjs's four position keys", () => {
    // The two paths that run through gjs_throw_gerror or the GError constructor,
    // which is where `gjs_define_error_properties` is called — so the domain makes
    // no difference here.
    for (const [what, err] of [
        ['thrown', caughtIoError()],
        ['new GLib.Error, known domain', new GLib.Error(KNOWN(), 1, 'x')],
        ['new GLib.Error, unknown domain', new GLib.Error(DOMAIN, 3, 'three')],
        ['new Gio.IOErrorEnum', new Gio.IOErrorEnum({ message: 'm', code: 2 })],
    ]) {
        assert.deepEqual(Object.keys(err), POSITION_KEYS, `${what}: the own ENUMERABLE keys, in gjs's order`);
        assert.equal(typeof err.stack, 'string', `${what}: stack is a string`);
        // Enumerable is the load-bearing half: V8's own `stack` is NOT, so a
        // `{...err}` spread or a structured log carried the frames on gjs and
        // nothing here. (The frame FORMAT stays V8's — a general engine
        // difference `@gjsify/console` already absorbs.)
        const descriptor = Object.getOwnPropertyDescriptor(err, 'stack');
        assert.equal(descriptor.enumerable, true, `${what}: stack must be enumerable`);
    }
});

test('wrapping an EXISTING GError* carries them only for an unknown domain', () => {
    // Four ways to reach a GError that already exists, each measured on both a
    // registered and a private domain. The split is not a quirk of one of them:
    // `ErrorInstance::object_for_c_ptr` can build a domain class for a known quark
    // and does nothing else, while an unknown quark falls back to wrapping the
    // GError as a plain struct — and `gi/struct.cpp` defines the position
    // properties. A suite diffing the two runtimes' own-key sets needs both arms.
    const wraps = [
        ['marshalled OUT', (d) => GLib.set_error_literal(d, 1, 'm')],
        ['copy()', (d) => GLib.set_error_literal(d, 1, 'm').copy()],
        ['GError IN arg', (d) => GLib.propagate_error(new GLib.Error(d, 1, 'm'))],
        ['new_literal', (d) => GLib.Error.new_literal(d, 1, 'm')],
    ];
    for (const [what, make] of wraps) {
        const known = make(KNOWN());
        assert.deepEqual(Object.keys(known), [], `${what}, known domain: no own enumerable keys`);
        assert.equal(known.stack, undefined, `${what}, known domain: no stack at all`);
        assert.equal(known.constructor.name, 'Gio_IOErrorEnum', `${what}: still a full error of its class`);
        assert.equal(known.message, 'm');

        const unknown = make(DOMAIN);
        assert.deepEqual(Object.keys(unknown), POSITION_KEYS, `${what}, unknown domain: the four keys`);
        assert.equal(typeof unknown.stack, 'string', `${what}, unknown domain: stack is a string`);
    }
});

// ---- toString --------------------------------------------------------------

test('toString names the DOMAIN CLASS, or the quark when there is none', () => {
    const thrown = caughtIoError();
    assert.match(String(thrown), /^Gio\.IOErrorEnum: /, 'a known domain prints its class name');

    // No class for this quark, so gjs prints the base class plus the quark's name.
    const unknown = GLib.set_error_literal(DOMAIN, 7, 'marshalled');
    assert.equal(String(unknown), `GLib.Error ${DOMAIN_NAME}: marshalled`);
    assert.equal(String(new GLib.Error(DOMAIN, 3, 'three')), `GLib.Error ${DOMAIN_NAME}: three`);
    assert.equal(String(new Gio.IOErrorEnum({ message: 'm', code: 2 })), 'Gio.IOErrorEnum: m');
});

// ---- matches() -------------------------------------------------------------

test('matches() discriminates on domain AND code', () => {
    const thrown = caughtIoError();
    assert.equal(thrown.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND), true, 'numeric quark');
    assert.equal(thrown.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND), true, 'the error-enum object');
    assert.equal(thrown.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS), false, 'a wrong code');
    assert.equal(thrown.matches(GLib.file_error_quark(), Gio.IOErrorEnum.NOT_FOUND), false, 'a wrong domain');
    assert.equal(thrown.matches(OTHER_DOMAIN, thrown.code), false);
});

test('matches() with a domain NAME string THROWS, it does not answer false', () => {
    // The domain argument is a uint32 GQuark and gjs's uint32 marshaller refuses a
    // string outright — so the node-gi spelling `err.matches('g-io-error-quark', c)`
    // was not merely unportable, it was code gjs cannot run. Measured wording.
    const thrown = caughtIoError();
    assert.throws(
        () => thrown.matches('g-io-error-quark', Gio.IOErrorEnum.NOT_FOUND),
        /Argument domain: value is out of range for uint32/,
    );
});

test('Error.prototype.matches answers false, so a non-GError can be asked', () => {
    // gjs's GLib override installs this on the GLOBAL Error.prototype, which is
    // what makes `catch (e) { if (e.matches(domain, code)) … }` safe to write
    // without a type test first.
    const descriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'matches');
    assert.notEqual(descriptor, undefined, 'must be an OWN property of Error.prototype');
    assert.equal(typeof descriptor.value, 'function');
    assert.equal(new Error('plain').matches(DOMAIN, 1), false);
});

// ---- the prototypes --------------------------------------------------------

test('GLib.Error.prototype carries the shared surface, not per-instance copies', () => {
    // One set of accessors and methods on the prototype is how gjs does it, and
    // the difference is observable: a per-instance `matches` shows up in
    // `Object.keys`, and `@gjsify/console`'s formatter walks the prototype chain
    // for the accessors rather than the instance.
    const proto = GLib.Error.prototype;
    for (const name of ['copy', 'free', 'matches', 'toString']) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        assert.notEqual(descriptor, undefined, `${name} must live on the prototype`);
        assert.equal(typeof descriptor.value, 'function', `${name} is a method`);
        assert.equal(descriptor.enumerable, true, `${name} is enumerable on gjs`);
    }
    for (const name of ['domain', 'code', 'message']) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        assert.notEqual(descriptor, undefined, `${name} must live on the prototype`);
        assert.equal(typeof descriptor.get, 'function', `${name} is an ACCESSOR, not a value`);
        assert.equal(descriptor.set, undefined, `${name} is getter-only`);
        assert.equal(descriptor.enumerable, true);
    }
    assert.equal(GLib.Error.name, 'GLib_Error', 'gjs names the class Ns_Type');
});

test('reading a field ON the prototype is refused, naming the prototype', () => {
    // The prototype has no GError* behind it. gjs answers with this exact
    // sentence, and the refusal is what keeps a prototype walk (util.inspect, a
    // formatter collecting accessors) from reading a wild pointer.
    assert.throws(() => GLib.Error.prototype.domain, /Can't get a field on GLib\.Error\.prototype; only on instances/);
});

test('an error-domain enum is a CLASS whose prototype answers its own domain', () => {
    // `Gio.IOErrorEnum` is both the enum (members, $gtype) and the class of its
    // errors: gjs puts the quark on the prototype's `domain` and a `valueOf` on the
    // class, so the enum coerces to its quark and `matches(Gio.IOErrorEnum, …)`
    // needs no registry lookup.
    assert.equal(typeof Gio.IOErrorEnum, 'function', 'an error-domain enum is class-like');
    assert.equal(Gio.IOErrorEnum.prototype.domain, Gio.io_error_quark());
    assert.equal(Number(Gio.IOErrorEnum), Gio.io_error_quark(), 'valueOf → the quark');
    assert.equal(Gio.IOErrorEnum.name, 'Gio_IOErrorEnum');
    assert.equal(Object.getPrototypeOf(Gio.IOErrorEnum.prototype), GLib.Error.prototype);

    // Still an enum — the members survive. The GType does NOT: being an Error class
    // wins over being an enum, so `$gtype` is G_TYPE_ERROR and the GIOErrorEnum GType
    // it shadows is as unreachable here as it is on gjs.
    assert.equal(Gio.IOErrorEnum.NOT_FOUND, 1);
    assert.equal(GObject.type_name(Gio.IOErrorEnum.$gtype), 'GError');
    assert.equal(GObject.type_name(GLib.Error.$gtype), 'GError');

    // A PLAIN enum is untouched — not a class, no prototype domain, own GType.
    assert.equal(typeof Gio.BusType, 'object', 'a non-error enum stays a frozen object');
    assert.equal(Gio.BusType.SYSTEM, 1);
    assert.equal(GObject.type_name(Gio.BusType.$gtype), 'GBusType');

    // The inherited methods are the base ones, not copies.
    const thrown = caughtIoError();
    assert.equal(thrown.matches, GLib.Error.prototype.matches);
    assert.equal(thrown.copy, GLib.Error.prototype.copy);
});

// ---- the constructors ------------------------------------------------------

test('new GLib.Error(domain, code, message) builds a base-class error', () => {
    const err = new GLib.Error(DOMAIN, 3, 'three');
    assert.equal(err.constructor.name, 'GLib_Error');
    assert.equal(err.domain, DOMAIN);
    assert.equal(err.code, 3);
    assert.equal(err.message, 'three');
    assert.equal(hasErrorSlot(err), true);
});

test('new GLib.Error({…}) is refused the way gjs refuses a boxed field write', () => {
    // `@girs/glib-2.0` types the constructor as `constructor(properties?)`, so this
    // is a spelling a cross-runtime source reaches for — and under gjs it dies in
    // the generic boxed-struct constructor, which cannot write a GError field.
    // Replicated verbatim so the failure reads the same on both legs.
    assert.throws(
        () => new GLib.Error({ domain: DOMAIN, code: 3, message: 'three' }),
        /Writing field GLib\.Error\.message is not supported/,
    );
});

test('new DomainClass({message, code}) builds an error of that domain', () => {
    const err = new Gio.IOErrorEnum({ message: 'm', code: Gio.IOErrorEnum.EXISTS });
    assert.equal(err.constructor.name, 'Gio_IOErrorEnum');
    assert.equal(err.domain, Gio.io_error_quark(), 'the domain comes from the CLASS, not the argument');
    assert.equal(err.code, Gio.IOErrorEnum.EXISTS);
    assert.equal(err.message, 'm');
    // Extra properties are ignored rather than refused (measured).
    assert.equal(new Gio.IOErrorEnum({ message: 'm', code: 1, extra: true }).message, 'm');
});

test("the domain-class constructor refuses a bad argument list by gjs's wording", () => {
    // The messages are the contract: a cross-runtime test asserting on a
    // constructor refusal compares the string, and `message` is checked BEFORE
    // `code` (so a call missing both names `message`).
    assert.throws(
        () => new Gio.IOErrorEnum('m', 1),
        /Invalid parameters passed to GError constructor, expected one object/,
    );
    assert.throws(() => new Gio.IOErrorEnum(), /Invalid parameters passed to GError constructor, expected one object/);
    assert.throws(
        () => new Gio.IOErrorEnum({ code: 1 }),
        /No property 'message' in GError constructor \(or it was not a string\)/,
    );
    assert.throws(
        () => new Gio.IOErrorEnum({ message: 'm' }),
        /No property 'code' in GError constructor \(or it was not a 32-bit integer\)/,
    );
    assert.throws(() => new Gio.IOErrorEnum({}), /No property 'message' in GError constructor/);
});

// ---- the round trip --------------------------------------------------------

test('a GError keeps its class through copy() and a GError IN arg', () => {
    const thrown = caughtIoError();

    const copy = thrown.copy();
    assert.notEqual(copy, thrown, 'copy() is a distinct object');
    assert.ok(copy instanceof Gio.IOErrorEnum, 'and keeps the domain class');
    assert.equal(copy.message, thrown.message);
    assert.equal(copy.code, thrown.code);

    // The hand-back direction, with the shape an application actually holds: ONE
    // object now, so the IN arm has one case rather than a rebuild-from-JS-fields
    // path beside it.
    const propagated = GLib.propagate_error(thrown);
    assert.ok(propagated instanceof Gio.IOErrorEnum, 'the class survives the round trip');
    assert.equal(propagated.domain, Gio.io_error_quark());
    assert.equal(propagated.code, thrown.code);
    assert.equal(propagated.message, thrown.message);

    // And for a constructed one, whose GError* used to not exist.
    const propagatedBuilt = GLib.propagate_error(new GLib.Error(DOMAIN, 9, 'built'));
    assert.equal(propagatedBuilt.domain, DOMAIN);
    assert.equal(propagatedBuilt.code, 9);
    assert.equal(propagatedBuilt.message, 'built');
});
