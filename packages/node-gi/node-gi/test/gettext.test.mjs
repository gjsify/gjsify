// SPDX-License-Identifier: MIT
// @gjsify/node-gi/gettext — the GJS `Gettext` module on Node (standalone import).
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

test('lookups are a no-translation passthrough', () => {
  assert.equal(gettext('hello'), 'hello');
  assert.equal(dgettext('app', 'hello'), 'hello');
  assert.equal(dcgettext('app', 'hello', LocaleCategory.MESSAGES), 'hello');
  assert.equal(pgettext('menu', 'Open'), 'Open');
  assert.equal(dpgettext('app', 'menu', 'Open'), 'Open');
});

test('plural lookups pick singular for n===1, plural otherwise', () => {
  assert.equal(ngettext('one', 'many', 1), 'one');
  assert.equal(ngettext('one', 'many', 0), 'many');
  assert.equal(ngettext('one', 'many', 5), 'many');
  assert.equal(dngettext('app', 'one', 'many', 1), 'one');
  assert.equal(dngettext('app', 'one', 'many', 2), 'many');
});

test('domain() returns bound passthrough bindings', () => {
  const d = domain('app');
  assert.equal(d.gettext('x'), 'x');
  assert.equal(d.ngettext('one', 'many', 1), 'one');
  assert.equal(d.ngettext('one', 'many', 3), 'many');
  assert.equal(d.pgettext('ctx', 'y'), 'y');
});

test('locale/domain setters are no-ops returning null', () => {
  assert.equal(setlocale(LocaleCategory.ALL, 'C'), null);
  assert.equal(textdomain('app'), null);
  assert.equal(bindtextdomain('app', '/usr/share/locale'), null);
  assert.equal(bindtextdomainCodeset('app', 'UTF-8'), null);
});

test('LocaleCategory exposes the POSIX category constants', () => {
  assert.equal(LocaleCategory.CTYPE, 0);
  assert.equal(LocaleCategory.NUMERIC, 1);
  assert.equal(LocaleCategory.TIME, 2);
  assert.equal(LocaleCategory.COLLATE, 3);
  assert.equal(LocaleCategory.MONETARY, 4);
  assert.equal(LocaleCategory.MESSAGES, 5);
  assert.equal(LocaleCategory.ALL, 6);
});
