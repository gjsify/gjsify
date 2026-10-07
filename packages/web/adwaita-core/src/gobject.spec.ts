// The GObject core (ADR 0096) against the shared vectors, through a test door.
//
// The door builds a template out of two registered fake widgets, so the construction order, the
// handler scope and the `template` bind source are driven through the real core and not mocked.
// Real GJS holds the same vectors in `gobject.gjs.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';

import { GOBJECT_VECTORS, driveGObjectVectors, type GObjectSubject } from './conformance/gobject.js';
import {
    bindProperties,
    createGObject,
    type BindingFlag,
    type BuiltTemplate,
    type GObjectDoor,
    type GObjectInstance,
    type TemplateScope,
} from './gobject.js';
import type { SharedTreeNode } from './conformance/shared-trees.js';

const events: string[] = [];

const door: GObjectDoor = {
    name: 'test door',
    dispatch(_target, event) {
        throw new Error(`test door: nothing to dispatch '${event}' on`);
    },
    listen(_target, event) {
        throw new Error(`test door: nothing to listen '${event}' on`);
    },
    createFromTree(tree: SharedTreeNode, scope: TemplateScope): BuiltTemplate {
        events.push('create');
        const objects: Record<string, object> = {};
        const byId = (id: string): GObjectInstance =>
            (id === 'template' ? scope.instance : objects[id]) as GObjectInstance;
        const build = (node: SharedTreeNode): object => {
            const Klass = node.tag === 'GtkSwitch' ? FakeSwitch : node.tag === 'GtkButton' ? FakeButton : undefined;
            if (!Klass) throw new Error(`test door: no fake widget for ${node.tag}`);
            const widget = new Klass();
            if (node.id !== undefined) objects[node.id] = widget;
            for (const signal of node.signals ?? []) {
                widget.connect(signal.name, scope.handler(signal.handler, { flags: signal.flags }));
            }
            for (const [property, binding] of Object.entries(node.bindings ?? {})) {
                const flags: BindingFlag[] = [];
                if (binding.flags?.includes('bidirectional')) flags.push('bidirectional');
                if (binding.flags?.includes('inverted')) flags.push('invert-boolean');
                if (!binding.flags?.includes('no-sync-create')) flags.push('sync-create');
                scope.bind(byId(binding.source), binding.property, widget, property, flags);
            }
            return widget;
        };
        return { children: (tree.children ?? []).map(build), objects };
    },
    attach(host, built) {
        events.push(`attach:${built.children.length}:${typeof (host as Record<string, unknown>)._sw}`);
    },
    register() {},
};

const G = createGObject(door);
const { ParamSpec: P, ParamFlags: F } = G;

const FakeSwitch = G.registerClass(
    { GTypeName: 'FakeSwitch', Properties: { active: P.boolean('active', '', '', F.READWRITE, false) } },
    class extends G.Object {},
);
const FakeButton = G.registerClass(
    { GTypeName: 'FakeButton', Signals: { clicked: { param_types: [] } } },
    class extends G.Object {},
);

const subject: GObjectSubject = {
    name: 'adwaita-core (test door)',
    isOracle: false,
    GObject: G,
    Widget: G.Object,
    template: (source) => source.tree,
    bind: (source, sourceProperty, target, targetProperty, flags) => {
        bindProperties(source, sourceProperty, target, targetProperty, flags);
    },
};

export default async () => {
    await driveGObjectVectors(subject, { describe, it, expect });

    await describe('GObject core: the door (ADR 0096 § 1)', async () => {
        await it('asks the door to attach the built children after InternalChildren are installed', () => {
            events.length = 0;
            const Hosted = G.registerClass(
                {
                    GTypeName: 'DoorHosted',
                    Template: { tag: 'GtkBox', children: [{ tag: 'GtkSwitch', id: 'sw' }] },
                    InternalChildren: ['sw'],
                },
                class extends G.Object {},
            );
            new Hosted();
            expect(events.join()).toBe('create,attach:1:object');
        });

        await it('hands the construct bag only what is not a declared property', () => {
            const Plain = G.registerClass(
                { GTypeName: 'DoorBag', Properties: { code: P.string('code', '', '', F.READWRITE, '') } },
                class extends G.Object {},
            );
            expect(() => new Plain({ code: 'x', stray: 1 })).toThrow();
        });

        await it('refuses a Template that is not a ?template value', () => {
            expect(() =>
                G.registerClass({ GTypeName: 'DoorString', Template: '<interface/>' }, class extends G.Object {}),
            ).toThrow();
        });

        await it('lets type_ensure refuse a token that is not a GType', () => {
            expect(() => G.type_ensure({ name: 'fake' })).toThrow();
        });

        await it('covers every row of ADR 0096 § 2 with a vector', () => {
            const rows = new Set(GOBJECT_VECTORS.map((vector) => vector.row));
            for (const row of [
                'registerClass',
                'field-form',
                'ParamSpec',
                'Signals',
                'type_ensure',
                'vfunc',
                'binding engine',
                'template',
            ]) {
                expect(rows.has(row as never)).toBe(true);
            }
        });
    });
};
