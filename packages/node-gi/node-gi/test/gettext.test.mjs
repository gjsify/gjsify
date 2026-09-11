// SPDX-License-Identifier: MIT
// @gjsify/node-gi/gettext — the GJS `Gettext` module on Node (standalone import).
//
// Surface and FALLBACK only. What the module does with a catalog bound, and the
// process locale every lookup depends on, are in locale.test.mjs — this file pins
// what holds while nothing has been bound, which is the state most programs
// importing the module are in.
import test from 'node:test';
import assert from 'node:assert/strict';

import Gettext, {
    gettext,
    dgettext,
    dcgettext,
    ngettext,
    dngettext,
    pgettext,
    dpgettext,
    domain,
    setlocale,
    textdomain,
    bindtextdomain,
    bindtextdomainCodeset,
    LocaleCategory,
} from '../gettext.js';

// A domain nothing has bound — GNU gettext answers with the msgid, so the
// assertions below describe that FALLBACK and not an absence of translation
// machinery. Before the locale fix they were indistinguishable.
const UNBOUND = 'nodegi-unbound-domain';

test('default export carries the full GJS Gettext surface', () => {
    for (const member of [
        'gettext',
        'dgettext',
        'dcgettext',
        'ngettext',
        'dngettext',
        'pgettext',
        'dpgettext',
        'domain',
        'setlocale',
        'textdomain',
        'bindtextdomain',
        'bindtextdomainCodeset',
        'LocaleCategory',
    ]) {
        assert.ok(member in Gettext, `Gettext.${member} missing`);
    }
});

test('an unbound domain falls back to the msgid', () => {
    assert.equal(dgettext(UNBOUND, 'hello'), 'hello');
    assert.equal(dcgettext(UNBOUND, 'hello', LocaleCategory.MESSAGES), 'hello');
    assert.equal(pgettext('menu', 'Open'), 'Open');
    assert.equal(dpgettext(UNBOUND, 'menu', 'Open'), 'Open');
    // With no textdomain() call, gettext() goes to the default domain ("messages"),
    // equally unbound here.
    assert.equal(gettext('hello'), 'hello');
});

test('plural fallback picks singular for n===1, plural otherwise', () => {
    assert.equal(ngettext('one', 'many', 1), 'one');
    assert.equal(ngettext('one', 'many', 0), 'many');
    assert.equal(ngettext('one', 'many', 5), 'many');
    assert.equal(dngettext(UNBOUND, 'one', 'many', 1), 'one');
    assert.equal(dngettext(UNBOUND, 'one', 'many', 2), 'many');
});

test('domain() returns bindings bound to that domain', () => {
    const d = domain(UNBOUND);
    assert.equal(d.gettext('x'), 'x');
    assert.equal(d.ngettext('one', 'many', 1), 'one');
    assert.equal(d.ngettext('one', 'many', 3), 'many');
    assert.equal(d.pgettext('ctx', 'y'), 'y');
});

test('bindtextdomain reports the directory it bound', () => {
    // The C function answers with the binding in effect AFTER the call, which is
    // how a caller tells a successful bind from the null these used to return
    // unconditionally.
    assert.equal(bindtextdomain(UNBOUND, '/usr/share/locale'), '/usr/share/locale');
    // Query form: a null location reports without rebinding.
    assert.equal(bindtextdomain(UNBOUND, null), '/usr/share/locale');
});

test('textdomain reports the default domain it set', () => {
    const previous = textdomain(null);
    assert.equal(typeof previous, 'string');
    assert.equal(textdomain(UNBOUND), UNBOUND);
    assert.equal(textdomain(null), UNBOUND);
    textdomain(previous);
});

test('setlocale answers null for a locale the host does not have', () => {
    // CTYPE, not MESSAGES: the MSVC CRT has no LC_MESSAGES category and answers
    // null for EVERY value there, valid or not, so asserting the rejection on that
    // category would pass on Windows without testing a rejection. CTYPE exists on
    // all three C libraries, so the null means what the test name says.
    assert.equal(setlocale(LocaleCategory.CTYPE, 'no-such-locale.invalid'), null);
});

test('bindtextdomainCodeset stays a no-op — bindtextdomain already pins UTF-8', () => {
    assert.equal(bindtextdomainCodeset('app', 'UTF-8'), null);
});

test("LocaleCategory carries the host C library's LC_* values", () => {
    // The VALUES are platform constants and deliberately not asserted (that would
    // restate <locale.h>). What must hold everywhere is that all seven categories
    // are present as DISTINCT integers — the property the old hardcoded glibc table
    // broke on darwin, where its MESSAGES addressed LC_TIME.
    const names = ['CTYPE', 'NUMERIC', 'TIME', 'COLLATE', 'MONETARY', 'MESSAGES', 'ALL'];
    for (const name of names) {
        assert.equal(typeof LocaleCategory[name], 'number', `LocaleCategory.${name} missing`);
    }
    const values = names.map((n) => LocaleCategory[n]);
    assert.equal(new Set(values).size, values.length, 'two categories share a value');
});
