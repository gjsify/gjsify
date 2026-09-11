// SPDX-License-Identifier: MIT
// A custom GObject property's JS SETTER must run whenever the property is SET —
// gjs routes its set_property vfunc through the wrapper (refs/gjs/gi/gobject.cpp
// gjs_object_set_gproperty → jsobj_set_gproperty → JS_SetProperty), so a class that
// declares a property AND an accessor over a backing field sees the value land.
//
// node-gi only ever wrote its per-instance store, so the setter never ran for a
// plain READWRITE property. That is what left every Learn6502 tutorial code block
// empty on `--app node`: its SourceView takes `code`, `copyable` and `line-numbers`
// from a GtkBuilder template, and GtkBuilder applies a NON-construct property AFTER
// construction via g_object_set.
//
// Pinned here rather than only in node:test because the four columns are the point:
// the JS-setter round trip has to read identically on gjs and on all three Node-API
// runtimes. What the GtkBuilder end of it looks like needs a display and lives in
// test/custom-property-js-setter.test.mjs.
//
// The `untouched` case is the counterweight and is NOT decoration: a property nobody
// set must never have its setter run, or the setter fires against state the ctor body
// has not created yet (the Learn6502 SourceView `selectable` → `_signalHandlers`
// forEach crash).
import GObject from 'gi://GObject?version=2.0';

const Probe = GObject.registerClass(
    {
        GTypeName: 'ConfCustomPropSetter',
        Properties: {
            plain: GObject.ParamSpec.string('plain', 'Plain', '', GObject.ParamFlags.READWRITE, ''),
            'line-numbers': GObject.ParamSpec.boolean(
                'line-numbers',
                'Line numbers',
                '',
                GObject.ParamFlags.READWRITE,
                false,
            ),
            counted: GObject.ParamSpec.int(
                'counted',
                'Counted',
                '',
                GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
                0,
                100,
                7,
            ),
            untouched: GObject.ParamSpec.boolean('untouched', 'Untouched', '', GObject.ParamFlags.READWRITE, false),
        },
    },
    class Probe extends GObject.Object {
        constructor(params) {
            super(params);
            if (this._ran === undefined) this._ran = [];
        }
        get plain() {
            return this._plain ?? '<unset>';
        }
        set plain(v) {
            this._plain = v;
            print('setter plain=' + v);
        }
        set lineNumbers(v) {
            this._lineNumbers = v;
            print('setter lineNumbers=' + v);
        }
        get counted() {
            return this._counted ?? '<unset>';
        }
        set counted(v) {
            this._counted = v;
            print('setter counted=' + v);
        }
        set untouched(v) {
            // Only survivable once the ctor body has run.
            this._ran.push(v);
            print('setter untouched=' + v);
        }
    },
);

print('-- construct with no arguments (CONSTRUCT default only)');
const a = new Probe();
print('a.counted = ' + a.counted);
print('a.plain   = ' + a.plain);

print('-- set_property after construction');
a.set_property('plain', 'AFTER');
print('a.plain   = ' + a.plain);

print('-- compound name reaches the camelCase accessor');
a.set_property('line-numbers', true);

print('-- a property passed to the constructor');
const b = new Probe({ plain: 'AT-NEW' });
print('b.plain   = ' + b.plain);

print('-- a property nobody set never ran its setter');
print('a._ran = ' + JSON.stringify(a._ran));
