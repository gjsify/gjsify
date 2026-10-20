// SPDX-License-Identifier: MIT
// FOREIGN-PARENT classes — `GObject.registerClass(meta, class X extends SomeHostClass {})`,
// where the parent is NOT a node-gi GObject class (on the real host: a @nativescript/core
// widget). The ONE deliberate divergence from GJS, gated on `#host`'s
// FOREIGN_PARENT_CLASSES: ADR 0105 § 2, docs/node-gi-gjs-surface.md.
//
// Two halves, and the first is the one that keeps the exception honest:
//   • under the DEFAULT host (node/bun/deno/gjs) registerClass must still throw GJS's
//     invalid-base error, because a program there CAN be run under real GJS;
//   • under the `nativescript` condition the same declaration registers a GType rooted at
//     GObject.Object and ATTACHES it to the host object, whose [[Prototype]] stays its own.
//
// The NativeScript host is reached on the desktop by giving it the loader it looks for
// (`globalThis.require` → this checkout's built addon). That exercises the whole L1 path
// — registration, attach, notify, signals, identity — against a real GObject. What it
// cannot show is the widget half (layout, rendering); that is measured on-device by
// tests/integration/nativescript-gi's `foreign-parent` spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const addon = resolve(root, 'build/Release/node_gi.node');
// `node -e` gets a synthetic module URL in the CWD, so a RELATIVE import from a probe
// resolves one directory too high. The probes name gi.js absolutely.
const giModule = resolve(root, 'gi.js');

// Run `code` with #host resolved to the NativeScript host, with the addon handed to it
// through NativeScript's own loader name. The host writes its XDG env onto its OWN
// `runtimeProcess.env` stand-in, and derives no app dir off-device, so nothing leaks.
function onNativeScriptHost(code) {
    const prelude = `
        const { createRequire } = await import('node:module');
        const req = createRequire(${JSON.stringify(import.meta.url)});
        globalThis.require = (id) =>
            id === 'system_lib://libnode_gi.so' ? req(${JSON.stringify(addon)}) : req(id);
        const { requireGi } = await import(${JSON.stringify(giModule)});
        const GObject = requireGi('GObject', '2.0');
        const Gio = requireGi('Gio', '2.0');
        const out = [];
        const ok = (name, value) => out.push([name, value]);
        // Reading the ENGINE STORE behind a property, for the cases where the accessor
        // that would answer belongs to the host class. node-gi's \`get_property\` is the
        // introspected TWO-arg form (name + a GValue to fill) on every host — a
        // pre-existing divergence from gjs's one-arg override, not this path's — so the
        // store is read through a one-shot binding instead.
        const StoreProbe = GObject.registerClass(
            { GTypeName: 'ForeignStoreProbe', Properties: {
                v: GObject.ParamSpec.string('v', '', '', GObject.ParamFlags.READWRITE, ''),
            } },
            class StoreProbe extends GObject.Object {},
        );
        const readStore = (obj, prop) => {
            const probe = new StoreProbe();
            const binding = obj.bind_property(prop, probe, 'v', GObject.BindingFlags.SYNC_CREATE);
            const value = probe.v;
            binding.unbind();
            return value;
        };
    `;
    const r = spawnSync(
        process.execPath,
        ['--conditions=nativescript', '--expose-gc', '--input-type=module', '-e', prelude + code],
        { cwd: root, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } },
    );
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    return Object.fromEntries(JSON.parse(r.stdout.trim().split('\n').at(-1)));
}

// The gate, from both sides. A boolean in a host file is the whole mechanism, so it is
// worth asserting directly rather than only through its consequences.
test('FOREIGN_PARENT_CLASSES is on for NativeScript and off everywhere else', () => {
    const probe = (conditions) => {
        const r = spawnSync(
            process.execPath,
            [
                ...conditions,
                '--input-type=module',
                '-e',
                "import * as h from '#host'; console.log(h.FOREIGN_PARENT_CLASSES)",
            ],
            { cwd: root, encoding: 'utf8' },
        );
        assert.equal(r.status, 0, r.stderr);
        return r.stdout.trim();
    };
    assert.equal(probe([]), 'false');
    assert.equal(probe(['--conditions=nativescript']), 'true');
});

// The REGRESSION that matters: the divergence must not reach the desktop. GJS throws
// "GObject.registerClass() used with invalid base class" for this declaration
// (refs/gjs/modules/core/overrides/GObject.js), and node-gi's own wording has to keep
// standing in for it here.
test('the default host still refuses a non-GObject parent', () => {
    const r = spawnSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `const { requireGi } = await import(${JSON.stringify(giModule)});
             const GObject = requireGi('GObject', '2.0');
             class Host {}
             try {
                 GObject.registerClass({ GTypeName: 'DesktopForeign' }, class extends Host {});
                 console.log('REGISTERED');
             } catch (e) {
                 console.log(e.constructor.name + ': ' + e.message);
             }
             // And the static surface stays GJS's: no \`$foreignSkipped\` own property on a
             // class registered here, so nothing about this route is observable off the
             // NativeScript host.
             const Plain = GObject.registerClass({ GTypeName: 'DesktopPlain' }, class extends GObject.Object {});
             console.log('OWN ' + (Object.getOwnPropertyDescriptor(Plain, '$foreignSkipped') === undefined));`,
        ],
        { cwd: root, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', NODE_GI_NATIVE: 'build' } },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^TypeError: GObject\.registerClass: .* must extend a node-gi GObject class/);
    assert.match(r.stdout, /^OWN true$/m);
});

// Criterion 1: the object is BOTH. Its prototype chain is the host's, untouched — which is
// what a hard `instanceof` gate in host code (NativeScript's `_addView`) needs — and
// `instanceof GObject.Object` answers through the GObject type system.
test('a foreign-parent instance is both its host class and a GObject', () => {
    const out = onNativeScriptHost(`
        class HostWidget { constructor() { this.hostField = 'kept'; } hostMethod() { return 'host'; } }
        class Sub extends HostWidget {}
        const Leaf = GObject.registerClass({ GTypeName: 'ForeignLeaf' }, class Leaf extends Sub {});
        const w = new Leaf();
        ok('hostClass', w instanceof HostWidget);
        ok('hostSub', w instanceof Sub);
        ok('leaf', w instanceof Leaf);
        ok('gobject', w instanceof GObject.Object);
        ok('protoUntouched', Object.getPrototypeOf(Object.getPrototypeOf(w)) === Sub.prototype);
        ok('hostMethod', w.hostMethod());
        ok('hostField', w.hostField);
        ok('ctor', w.constructor === Leaf);
        ok('gtypeName', w.$typeName);
        ok('registeredUnderObject', GObject.type_name(GObject.type_parent(Leaf.$gtype)));
        console.log(JSON.stringify(out));
    `);
    assert.equal(out.hostClass, true);
    assert.equal(out.hostSub, true);
    assert.equal(out.leaf, true);
    assert.equal(out.gobject, true);
    assert.equal(out.protoUntouched, true);
    assert.equal(out.hostMethod, 'host');
    assert.equal(out.hostField, 'kept');
    assert.equal(out.ctor, true);
    assert.equal(out.gtypeName, 'ForeignLeaf');
    assert.equal(out.registeredUnderObject, 'GObject');
});

// Criterion 3: a declared property notifies, and the generated accessors answer under all
// three spellings GJS makes equivalent — with GJS's equal-value guard, which is the whole
// reason the accessors are generated here rather than resolved at the point of use.
test('a declared property notifies, across all three spellings', () => {
    const out = onNativeScriptHost(`
        class HostWidget {}
        const Leaf = GObject.registerClass(
            { GTypeName: 'ForeignProps', Properties: {
                'plain-text': GObject.ParamSpec.string('plain-text', '', '', GObject.ParamFlags.READWRITE, ''),
            } },
            class Leaf extends HostWidget {},
        );
        const w = new Leaf();
        const seen = [];
        w.connect('notify::plain-text', (_o, pspec) => seen.push(pspec.get_name()));
        w.plainText = 'camel';
        ok('readDash', w['plain-text']);
        ok('readSnake', w.plain_text);
        w.plain_text = 'camel';     // equal value: silent, as on gjs
        w['plain-text'] = 'dash';
        ok('notifies', seen.length);
        ok('final', w.plainText);
        // set_property bypasses the accessor and so notifies unconditionally, on both runtimes.
        w.set_property('plain-text', 'dash');
        ok('afterSetProperty', seen.length);
        ok('getProperty', readStore(w, 'plain-text'));
        console.log(JSON.stringify(out));
    `);
    assert.equal(out.readDash, 'camel');
    assert.equal(out.readSnake, 'camel');
    assert.equal(out.notifies, 2);
    assert.equal(out.final, 'dash');
    assert.equal(out.afterSetProperty, 3);
    assert.equal(out.getProperty, 'dash');
});

// A property named after one the HOST chain already defines must not be shadowed: the
// host's setter drives the host's own state and its internals call it. The engine's store
// routes to it instead (runJsPropertySetter), so the two compose.
test('a host accessor keeps its name, and the engine store routes to it', () => {
    const out = onNativeScriptHost(`
        class HostWidget {
            #text = '';
            get text() { return this.#text; }
            set text(v) { this.#text = 'host:' + v; }
        }
        const Leaf = GObject.registerClass(
            { GTypeName: 'ForeignShadow', Properties: {
                text: GObject.ParamSpec.string('text', '', '', GObject.ParamFlags.READWRITE, ''),
            } },
            class Leaf extends HostWidget {},
        );
        const w = new Leaf();
        w.text = 'x';
        ok('hostSetterRan', w.text);
        ok('gobjectUntouched', readStore(w, 'text'));
        // A write THROUGH GObject reaches the host setter, which is what makes a declared
        // property able to drive a widget property.
        w.set_property('text', 'y');
        ok('viaSetProperty', w.text);
        ok('skipped', Leaf.prototype === Object.getPrototypeOf(w));
        console.log(JSON.stringify(out));
    `);
    assert.equal(out.hostSetterRan, 'host:x');
    assert.equal(out.gobjectUntouched, '');
    assert.equal(out.viaSetProperty, 'host:y');
    assert.equal(out.skipped, true);
});

// What a registration did NOT get, readable from the class. Which GObject spellings the
// host chain already owns depends on the parent, so it cannot be documented once — a
// program (and the on-device spec) has to be able to read it per class.
//
// `notify` is deliberately NOT in the list: it is the one member whose GObject spelling IS
// installed, with the host's implementation captured and forwarded by argument type. So
// the list means "GObject's spelling lost here", not "this name collides" — the two
// answers differ for exactly one name, and the test says which.
test('$foreignSkipped names the spellings the host chain already owned', () => {
    const out = onNativeScriptHost(`
        class HostWidget {
            notify(data) { return data.eventName; }
            get_property(name) { return 'host:' + name; }
        }
        const Leaf = GObject.registerClass({ GTypeName: 'ForeignSkipped' }, class Leaf extends HostWidget {});
        const Plain = GObject.registerClass({ GTypeName: 'PlainSkipped' }, class Plain extends GObject.Object {});
        const w = new Leaf();
        ok('skipped', [...Leaf.$foreignSkipped].sort());
        ok('frozen', Object.isFrozen(Leaf.$foreignSkipped));
        ok('emptyOffPath', Plain.$foreignSkipped.length === 0);
        ok('hostKeptItsOwn', w.get_property('x'));
        ok('camelStillGObject', typeof w.getProperty === 'function');
        ok('notifyForwards', w.notify({ eventName: 'tap' }));
        console.log(JSON.stringify(out));
    `);
    assert.deepEqual(out.skipped, ['get_property']);
    assert.equal(out.frozen, true);
    assert.equal(out.emptyOffPath, true);
    assert.equal(out.hostKeptItsOwn, 'host:x');
    assert.equal(out.camelStillGObject, true);
    assert.equal(out.notifyForwards, 'tap');
});

// Criterion 4: a registered signal, and the `notify` collision. `notify(string)` is
// GObject's; `notify(anything else)` is the host's own method under the same name, captured
// before the GObject one shadows it — this is the only name that collides in the
// @nativescript/core 9.1 Label chain.
test('registered signals work, and notify() serves both callers', () => {
    const out = onNativeScriptHost(`
        class HostWidget {
            constructor() { this.events = []; }
            notify(data) { this.events.push(data.eventName); return 'host-notify'; }
        }
        const Leaf = GObject.registerClass(
            { GTypeName: 'ForeignSignals',
              Properties: { tag: GObject.ParamSpec.string('tag', '', '', GObject.ParamFlags.READWRITE, '') },
              Signals: { changed: { param_types: [GObject.TYPE_STRING] } } },
            class Leaf extends HostWidget {},
        );
        const w = new Leaf();
        const got = [];
        const id = w.connect('changed', (_o, s) => got.push(s));
        w.emit('changed', 'one');
        w.disconnect(id);
        w.emit('changed', 'two');
        ok('signal', got);

        const notified = [];
        w.connect('notify::tag', (_o, p) => notified.push(p.get_name()));
        w.notify('tag');                       // GObject: a property name
        ok('gobjectNotify', notified);
        ok('hostNotify', w.notify({ eventName: 'tap' }));   // host: an event payload
        ok('hostEvents', w.events);
        console.log(JSON.stringify(out));
    `);
    assert.deepEqual(out.signal, ['one']);
    assert.deepEqual(out.gobjectNotify, ['tag']);
    assert.equal(out.hostNotify, 'host-notify');
    assert.deepEqual(out.hostEvents, ['tap']);
});

// bind_property in both directions, between a foreign-parent object and an ordinary
// node-gi GObject — the two have to be the same kind of thing to GObject for this to work.
test('bind_property binds a foreign-parent object to a plain GObject', () => {
    const out = onNativeScriptHost(`
        class HostWidget {}
        const Leaf = GObject.registerClass(
            { GTypeName: 'ForeignBind', Properties: {
                caption: GObject.ParamSpec.string('caption', '', '', GObject.ParamFlags.READWRITE, ''),
            } },
            class Leaf extends HostWidget {},
        );
        const Plain = GObject.registerClass(
            { GTypeName: 'PlainBind', Properties: {
                label: GObject.ParamSpec.string('label', '', '', GObject.ParamFlags.READWRITE, ''),
            } },
            class Plain extends GObject.Object {},
        );
        const w = new Leaf();
        const p = new Plain();
        w.bind_property('caption', p, 'label', GObject.BindingFlags.BIDIRECTIONAL);
        w.caption = 'from-foreign';
        ok('toPlain', p.label);
        p.label = 'from-plain';
        ok('toForeign', w.caption);
        console.log(JSON.stringify(out));
    `);
    assert.equal(out.toPlain, 'from-foreign');
    assert.equal(out.toForeign, 'from-plain');
});

// Criterion 5: identity. A foreign-parent object handed to C and read back must be the
// SAME JS object — the host field it carries is the witness that no second wrapper exists.
test('a round-trip through Gio.ListStore returns the same JS object', () => {
    const out = onNativeScriptHost(`
        class HostWidget { constructor() { this.hostField = Math.random(); } }
        const Leaf = GObject.registerClass({ GTypeName: 'ForeignIdentity' }, class Leaf extends HostWidget {});
        const store = new Gio.ListStore({ 'item-type': Leaf.$gtype });
        const w = new Leaf();
        store.append(w);
        const back = store.get_item(0);
        ok('same', back === w);
        ok('field', back.hostField === w.hostField);
        ok('stillHost', back instanceof HostWidget);
        console.log(JSON.stringify(out));
    `);
    assert.equal(out.same, true);
    assert.equal(out.field, true);
    assert.equal(out.stillHost, true);
});

// Criterion 6, the JS half: the attach must not make the object immortal. A FinalizationRegistry
// is the witness (a WeakRef is no witness on the NativeScript runtime), and the known node-gi
// rule applies — a handler closure capturing the instance is a C↔JS cycle neither runtime's GC
// breaks, so the collected case must capture only the signal's own arguments.
test('a foreign-parent object is collected once nothing holds it', async () => {
    const out = onNativeScriptHost(`
        class HostWidget {}
        const Leaf = GObject.registerClass(
            { GTypeName: 'ForeignLifetime', Properties: {
                tag: GObject.ParamSpec.string('tag', '', '', GObject.ParamFlags.READWRITE, ''),
            } },
            class Leaf extends HostWidget {},
        );
        const dead = [];
        const reg = new FinalizationRegistry((name) => dead.push(name));
        const kept = new Leaf();
        reg.register(kept, 'kept');
        (() => {
            const gone = new Leaf();
            // Captures only the emitter argument — never \`gone\` — so no C↔JS cycle.
            gone.connect('notify::tag', (emitter) => void emitter.$typeName);
            gone.tag = 'attached';          // forces the attach
            reg.register(gone, 'gone');
        })();
        for (let i = 0; i < 12; i++) {
            globalThis.gc();
            await new Promise((r) => setTimeout(r, 20));
        }
        ok('collected', dead);
        ok('keptAlive', kept instanceof GObject.Object);
        console.log(JSON.stringify(out));
    `);
    assert.deepEqual(out.collected, ['gone'], 'the unreferenced object was not finalized');
    assert.equal(out.keptAlive, true);
});

// A registered subclass OF a foreign-parent class: the GType parent is the parent's
// registered GType, construction attaches the LEAF's type (not the parent's), and the
// parent's declared properties come down.
test('a registered subclass of a foreign-parent class gets its own GType', () => {
    const out = onNativeScriptHost(`
        class HostWidget {}
        const Base = GObject.registerClass(
            { GTypeName: 'ForeignBase', Properties: {
                base: GObject.ParamSpec.string('base', '', '', GObject.ParamFlags.READWRITE, 'b'),
            } },
            class Base extends HostWidget {},
        );
        const Derived = GObject.registerClass(
            { GTypeName: 'ForeignDerived', Properties: {
                extra: GObject.ParamSpec.string('extra', '', '', GObject.ParamFlags.READWRITE, 'e'),
            } },
            class Derived extends Base {},
        );
        const d = new Derived();
        ok('typeName', d.$typeName);
        ok('parentType', GObject.type_name(GObject.type_parent(Derived.$gtype)));
        ok('isBase', d instanceof Base);
        ok('isHost', d instanceof HostWidget);
        ok('isGObject', d instanceof GObject.Object);
        ok('inheritedProp', d.base);
        ok('ownProp', d.extra);
        const seen = [];
        d.connect('notify::base', (_o, p) => seen.push(p.get_name()));
        d.base = 'changed';
        ok('inheritedNotify', seen);
        console.log(JSON.stringify(out));
    `);
    assert.equal(out.typeName, 'ForeignDerived');
    assert.equal(out.parentType, 'ForeignBase');
    assert.equal(out.isBase, true);
    assert.equal(out.isHost, true);
    assert.equal(out.isGObject, true);
    assert.equal(out.inheritedProp, 'b');
    assert.equal(out.ownProp, 'e');
    assert.deepEqual(out.inheritedNotify, ['base']);
});

// A class-declared setter beside a declared property: the generated accessor steps aside
// and the engine's store routes through the class's own setter, exactly as GJS's
// _checkAccessors leaves a declared accessor in place. This is also the recursion case —
// the generated setter must be invisible to findPropertySetter or the store would re-enter
// it forever.
test("a class's own accessor wins, and the store routes through it", () => {
    const out = onNativeScriptHost(`
        class HostWidget {}
        const Leaf = GObject.registerClass(
            { GTypeName: 'ForeignOwnAccessor', Properties: {
                caption: GObject.ParamSpec.string('caption', '', '', GObject.ParamFlags.READWRITE, ''),
            } },
            class Leaf extends HostWidget {
                get caption() { return this._caption; }
                set caption(v) { this._caption = 'own:' + v; }
            },
        );
        const w = new Leaf();
        w.caption = 'a';
        ok('ownSetter', w.caption);
        w.set_property('caption', 'b');
        ok('viaStore', w.caption);
        ok('store', readStore(w, 'caption'));
        console.log(JSON.stringify(out));
    `);
    assert.equal(out.ownSetter, 'own:a');
    assert.equal(out.viaStore, 'own:b');
    assert.equal(out.store, 'b');
});

// The MIXIN shape: two foreign-parent registrations with an ORDINARY subclass between
// them. This is how the adwaita port layers route D — `withSignals(GridLayout, meta)`
// registers, the widget class extends it plainly, `withProperties(AdwActionRow, meta)`
// registers again, the derived widget extends THAT plainly (ADR 0105 § 2) — so the
// registered-over-registered case above has a class in between that contributes no GType.
// Two things have to hold, and both broke before `findParentGType` learned to skip an
// INHERITED dotless `$gtypeName`: the parent walk reaches the registered ANCESTOR, and
// the derived registration SKIPS the GObject verbs it inherits instead of re-installing
// them, which means the PARENT's captured thunks are what a leaf instance runs.
test('a registered class over a plain subclass of a foreign-parent class', () => {
    const out = onNativeScriptHost(`
        class HostWidget {
            notify(data) { (this._hostNotified ??= []).push(data && data.eventName); }
        }
        const RowMixin = GObject.registerClass(
            { GTypeName: 'ForeignRowMixin', Properties: {
                title: GObject.ParamSpec.string('title', '', '', GObject.ParamFlags.READWRITE, ''),
            } },
            class RowMixin extends HostWidget {},
        );
        // What the seam does: take the installed verbs off the prototype and put routers
        // back over them, so the captured thunks are the only way to the GObject half.
        const giConnect = RowMixin.prototype.connect;
        const giDisconnect = RowMixin.prototype.disconnect;
        Object.defineProperty(RowMixin.prototype, 'connect', {
            configurable: true, writable: true, enumerable: false,
            value: function router(name, cb) { return giConnect.call(this, name, cb); },
        });
        class ActionRow extends RowMixin {}
        const SwitchMixin = GObject.registerClass(
            { GTypeName: 'ForeignSwitchMixin', Properties: {
                active: GObject.ParamSpec.boolean('active', '', '', GObject.ParamFlags.READWRITE, false),
            } },
            class SwitchMixin extends ActionRow {},
        );
        class SwitchRow extends SwitchMixin {}

        const row = new SwitchRow();
        ok('typeName', row.$typeName);
        ok('parentType', GObject.type_name(GObject.type_parent(SwitchMixin.$gtype)));
        ok('rootType', GObject.type_name(
            GObject.type_parent(GObject.type_parent(SwitchMixin.$gtype)),
        ));
        ok('isPlainMid', row instanceof ActionRow);
        ok('isHost', row instanceof HostWidget);
        ok('isGObject', row instanceof GObject.Object);

        // The derived registration found connect/disconnect/emit already on the chain and
        // stepped aside — the names are in ITS skip list, and it installed no own copy.
        ok('derivedSkipsConnect', SwitchMixin.$foreignSkipped.includes('connect'));
        ok('derivedSkipsEmit', SwitchMixin.$foreignSkipped.includes('emit'));
        ok('noOwnConnect', Object.hasOwn(SwitchMixin.prototype, 'connect'));

        // So the PARENT's captured thunk is what runs on a leaf instance — including for a
        // property only the LEAF declares, with the leaf as the emitter.
        const seen = [];
        const id = giConnect.call(row, 'notify::active', (self, pspec) =>
            seen.push([pspec.get_name(), self === row]));
        row.active = true;
        ok('leafNotify', seen);
        ok('leafRead', row.active);

        // And the inherited property, read + notified through the same leaf.
        const titles = [];
        giConnect.call(row, 'notify::title', (_o, p) => titles.push(p.get_name()));
        row.title = 'hello';
        ok('inheritedNotify', titles);
        ok('inheritedRead', row.title);

        // disconnect through the parent's thunk removes the leaf's handler.
        giDisconnect.call(row, id);
        row.active = false;
        ok('afterDisconnect', seen.length);

        // The host half is untouched: an object payload still reaches HostWidget.notify.
        row.notify({ eventName: 'activated' });
        ok('hostNotified', row._hostNotified);
        console.log(JSON.stringify(out));
    `);
    assert.equal(out.typeName, 'ForeignSwitchMixin');
    assert.equal(out.parentType, 'ForeignRowMixin', 'the plain class in between is skipped');
    assert.equal(out.rootType, 'GObject');
    assert.equal(out.isPlainMid, true);
    assert.equal(out.isHost, true);
    assert.equal(out.isGObject, true);
    assert.equal(out.derivedSkipsConnect, true);
    assert.equal(out.derivedSkipsEmit, true);
    assert.equal(out.noOwnConnect, false, 'the derived registration installed no own connect');
    assert.deepEqual(out.leafNotify, [['active', true]]);
    assert.equal(out.leafRead, true);
    assert.deepEqual(out.inheritedNotify, ['title']);
    assert.equal(out.inheritedRead, 'hello');
    assert.equal(out.afterDisconnect, 1, 'the disconnected handler did not fire again');
    assert.deepEqual(out.hostNotified, ['activated']);
});
