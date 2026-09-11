// SPDX-License-Identifier: MIT
// @gjsify/node-gi — a custom GObject property's JS SETTER runs whenever the property
// is set, not only when it is CONSTRUCT-flagged.
//
// The wall this guards (Learn6502's tutorial on `--app node`, macOS + Windows): its
// `SourceView` declares `code`, `copyable` and `line-numbers` as plain READWRITE
// properties with JS setters, and the tutorial sets all three from a GtkBuilder
// template. GtkBuilder applies a NON-construct property AFTER construction via
// g_object_set, and node-gi's set_property vfunc only ever wrote the engine's
// per-instance store — so every code block rendered empty and the copy button never
// appeared, while the identical source worked on gjs. gjs routes the vfunc through
// the wrapper's JS setter (refs/gjs/gi/gobject.cpp gjs_object_set_gproperty →
// jsobj_set_gproperty → JS_SetProperty); node-gi now does the same.
//
// TWO TIMES, ONE RULE — do not collapse them: a set that lands BEFORE the wrapper
// exists (construct properties, g_object_new) has nothing to call into and is
// replayed by the flush in the base ctor; a set that lands after (GtkBuilder, a
// binding, set_property) delegates immediately. The construct-time half is exactly
// where a setter must NOT fire for a property nobody set — see the `untouched` case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';
import { haveDisplay } from './display-gate.mjs';

const GObject = requireGi('GObject', '2.0');

const Widget = GObject.registerClass(
    {
        GTypeName: 'NodeGiCustomPropSetter',
        Properties: {
            plain: GObject.ParamSpec.string(
                'plain',
                'Plain',
                'A plain READWRITE string with a JS accessor',
                GObject.ParamFlags.READWRITE,
                '',
            ),
            // A COMPOUND name: gjs mirrors a declared accessor onto the dash, underscore
            // AND camelCase spellings (_checkAccessors in refs/gjs/modules/core/_common.js),
            // so a `line-numbers` property reaches a `lineNumbers` setter. Learn6502's
            // SourceView is exactly this shape.
            'line-numbers': GObject.ParamSpec.boolean(
                'line-numbers',
                'Line numbers',
                'A compound-named property whose accessor is camelCase',
                GObject.ParamFlags.READWRITE,
                false,
            ),
            // No JS accessor: the engine store stays its single backing store.
            storeOnly: GObject.ParamSpec.string(
                'store-only',
                'Store only',
                'A property with NO JS accessor',
                GObject.ParamFlags.READWRITE,
                'default',
            ),
            // Declared with a setter that only works once the ctor body has run. Nothing
            // ever sets it, so its setter must never fire — the Learn6502 SourceView
            // `selectable` → `_signalHandlers.forEach` crash.
            untouched: GObject.ParamSpec.boolean(
                'untouched',
                'Untouched',
                'A READWRITE bool nobody sets; its setter must never run',
                GObject.ParamFlags.READWRITE,
                false,
            ),
        },
    },
    class Widget extends GObject.Object {
        constructor(params) {
            super(params);
            if (this._log === undefined) this._log = [];
        }
        get plain() {
            return this._plain ?? '<unset>';
        }
        set plain(v) {
            this._sets = [...(this._sets ?? []), `plain=${v}`];
            this._plain = v;
        }
        get lineNumbers() {
            return this._lineNumbers ?? '<unset>';
        }
        set lineNumbers(v) {
            this._sets = [...(this._sets ?? []), `lineNumbers=${v}`];
            this._lineNumbers = v;
        }
        set untouched(v) {
            // Throws unless the ctor body has already initialised _log.
            this._log.push(v);
        }
    },
);

test('set_property on a custom property runs the class JS setter', () => {
    const w = new Widget();
    assert.equal(w.plain, '<unset>', 'nothing set it yet');
    w.set_property('plain', 'FROM-SET-PROPERTY');
    assert.deepEqual(w._sets, ['plain=FROM-SET-PROPERTY'], 'the JS setter ran exactly once');
    assert.equal(w.plain, 'FROM-SET-PROPERTY', 'the class getter sees the value');
    assert.equal(w._plain, 'FROM-SET-PROPERTY', 'the backing field carries it');
});

test('a compound property name reaches a camelCase JS setter', () => {
    const w = new Widget();
    w.set_property('line-numbers', true);
    assert.deepEqual(w._sets, ['lineNumbers=true'], 'the camelCase setter ran');
    assert.equal(w._lineNumbers, true, 'the backing field carries it');
});

test('a property passed to the constructor runs the JS setter', () => {
    const w = new Widget({ plain: 'FROM-NEW' });
    assert.deepEqual(w._sets, ['plain=FROM-NEW'], 'the JS setter ran exactly once');
    assert.equal(w.plain, 'FROM-NEW', 'the class getter sees the constructed value');
});

test('a property with NO JS accessor keeps the engine store as its backing store', () => {
    const w = new Widget();
    assert.equal(w.store_only, 'default', 'the declared default comes from the store');
    w.set_property('store-only', 'stored');
    assert.equal(w.store_only, 'stored', 'the store round-trips');
});

test('a setter for a property nobody set NEVER runs', () => {
    // If construction flushed every declared property (rather than only the ones
    // actually set), `set untouched` would run before the ctor body and throw on the
    // undefined `_log`.
    const w = new Widget();
    assert.deepEqual(w._log, [], 'the untouched setter did not run during construction');
    // It still works normally once something does set it.
    w.set_property('untouched', true);
    assert.deepEqual(w._log, [true], 'the setter ran exactly once, post-construction');
});

test('a GtkBuilder template value reaches the JS setter', { skip: !haveDisplay && 'needs a display' }, () => {
    const Gtk = requireGi('Gtk', '4.0');
    Gtk.init();

    const seen = [];
    GObject.registerClass(
        {
            GTypeName: 'NodeGiTemplatePropSetter',
            Properties: {
                code: GObject.ParamSpec.string(
                    'code',
                    'Code',
                    'The Learn6502 SourceView shape: a plain READWRITE string',
                    GObject.ParamFlags.READWRITE,
                    '',
                ),
                'line-numbers': GObject.ParamSpec.boolean(
                    'line-numbers',
                    'Line numbers',
                    'A compound name with a camelCase setter',
                    GObject.ParamFlags.READWRITE,
                    false,
                ),
            },
        },
        class TemplateProbe extends Gtk.Box {
            set code(v) {
                seen.push(`code=${v}`);
                this._code = v;
            }
            get code() {
                return this._code ?? '<unset>';
            }
            set lineNumbers(v) {
                seen.push(`lineNumbers=${v}`);
                this._lineNumbers = v;
            }
        },
    );

    const builder = Gtk.Builder.new_from_string(
        '<interface><object class="NodeGiTemplatePropSetter" id="probe">' +
            '<property name="code">LDA #$01</property>' +
            '<property name="line-numbers">true</property>' +
            '</object></interface>',
        -1,
    );
    const probe = builder.get_object('probe');

    assert.deepEqual(seen, ['code=LDA #$01', 'lineNumbers=true'], 'both template values ran their setters');
    assert.equal(probe.code, 'LDA #$01', 'the class getter returns the template value');
    assert.equal(probe._lineNumbers, true, 'the compound-named backing field carries it');
});
