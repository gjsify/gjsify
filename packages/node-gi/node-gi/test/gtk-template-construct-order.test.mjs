// SPDX-License-Identifier: MIT
// @gjsify/node-gi — a templated widget's CONSTRUCT PROPERTIES are applied before its
// template children are surfaced on the instance, which is the order gjs produces.
//
// On gjs a construct property's setter runs inside g_object_new, where the template
// has not been built yet, so `this._child` is `undefined` in there; the children
// appear only once construction returns (measured on gjs 1.88.1:
// ['setter:undefined', 'after super:object']).
//
// node-gi builds the GObject in constructType and only then has a wrapper to attach
// USER_PROTO to, so BOTH halves happen in the base ctor afterwards (gi.js makeClass:
// assignTemplateChildren + flushPropertiesToJsSetters). It ran them children-first,
// which inverted the order: a construct-property setter saw a child gjs cannot have
// handed it yet, so a class whose setter guards on `if (this._child)` — the ordinary
// shape for "update the child when my property changes" — took the branch that
// touches the child at construction on node-gi and only on node-gi.
//
// SELF-SKIPPING like gtk-template.test.mjs: needs a display + the Gtk-4.0 typelib, so
// the headless `npm test` legs skip it; the `gtk-smoke` CI job runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';
import { haveDisplay } from './display-gate.mjs';

let GObject;
let Gtk;
let loadError = null;
if (haveDisplay) {
    try {
        GObject = requireGi('GObject', '2.0');
        Gtk = requireGi('Gtk', '4.0');
        Gtk.init();
    } catch (err) {
        loadError = err;
    }
}

const skip = !haveDisplay
    ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)'
    : loadError
      ? `Gtk-4.0 typelib unavailable: ${loadError.message}`
      : false;

const TEMPLATE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<interface>
  <template class="NodeGiOrderBox" parent="GtkBox">
    <child>
      <object class="GtkSwitch" id="sw"/>
    </child>
  </template>
</interface>`;

test('construct properties are applied before the template children', { skip }, () => {
    const log = [];
    const K = GObject.registerClass(
        {
            GTypeName: 'NodeGiOrderBox',
            Template: new TextEncoder().encode(TEMPLATE_XML),
            InternalChildren: ['sw'],
            Properties: {
                code: GObject.ParamSpec.string('code', '', '', GObject.ParamFlags.READWRITE, ''),
            },
        },
        class extends Gtk.Box {
            get code() {
                return this.stored;
            }
            set code(value) {
                log.push(`setter:${typeof this._sw}`);
                this.stored = value;
            }
            constructor(params) {
                super(params);
                log.push(`after super:${typeof this._sw}`);
            }
        },
    );

    const o = new K({ code: 'k' });
    assert.deepEqual(log, ['setter:undefined', 'after super:object'], 'the order gjs 1.88.1 produces');
    assert.equal(o.code, 'k', 'and the construct value did reach the JS setter');
    assert.equal(typeof o._sw, 'object', 'the child is bound by the time construction returns');
});
