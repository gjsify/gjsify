// SPDX-License-Identifier: MIT
// What a custom-property WRITE does, observed from outside, must not depend on which
// fast path the engine took: equal-value assignment notifies exactly as gjs's generated
// accessor decides, `set_property` always notifies, a class-declared accessor runs on
// every write (also in a subclass whose parent declares none), and the ::notify handler
// sees the pspec. node-gi folds the equal-value guard into one native call and stops
// crossing into JS for a property no class declares an accessor for — none of which may
// be visible here.
import GObject from 'gi://GObject?version=2.0';

const { ParamSpec: P, ParamFlags: F } = GObject;

const Plain = GObject.registerClass(
    {
        GTypeName: 'ConfFastpathPlain',
        Properties: {
            label: P.string('label', 'Label', '', F.READWRITE, 'x'),
            count: P.int('count', 'Count', '', F.READWRITE, 0, 100, 0),
            flag: P.boolean('flag', 'Flag', '', F.READWRITE, false),
        },
    },
    class ConfFastpathPlain extends GObject.Object {},
);

const notifies = (o, name, writes, via) => {
    const log = [];
    o.connect(`notify::${name}`, (_o, pspec) => log.push(`${pspec.name}=${o[name]}`));
    for (const v of writes) via(o, name, v);
    return log.join(' ');
};
const assign = (o, name, v) => {
    o[name] = v;
};
const setProp = (o, name, v) => o.set_property(name, v);

print('assign string:', notifies(new Plain(), 'label', ['a', 'a', 'b', 'b', 'a'], assign));
print('assign int:', notifies(new Plain(), 'count', [1, 1, 2, 2, 0], assign));
print('assign bool:', notifies(new Plain(), 'flag', [true, true, false, false], assign));
print('set_property string:', notifies(new Plain(), 'label', ['a', 'a', 'b'], setProp));
const read = new Plain();
void read.label;
print('read then default:', notifies(read, 'label', ['x', 'x', 'y'], assign));

const Sub = GObject.registerClass(
    { GTypeName: 'ConfFastpathSub' },
    class ConfFastpathSub extends Plain {
        set count(v) {
            this._count = v;
            this._seen = (this._seen ?? 0) + 1;
        }
        get count() {
            return this._count ?? 0;
        }
    },
);
const plain = new Plain();
for (let i = 0; i < 4; i++) plain.set_property('count', i);
const sub = new Sub();
for (let i = 0; i < 4; i++) sub.set_property('count', i + 10);
print('parent value:', plain.count, 'sub value:', sub.count, 'sub setter runs:', sub._seen);
