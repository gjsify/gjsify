// THE REAL-ENGINE LEG (ADR 0105 stage 2): the GOBJECT_VECTORS against the subset itself, with
// its property store and signal bus replaced by real GObject through `@gjsify/node-gi`.
//
// WHAT THIS MEASURES THAT STAGE 0 DID NOT. `adwaita-core/src/gobject.node-gi.spec.ts` drives the
// vectors against node-gi's own `GObject.registerClass` — real GObject as an ORACLE, answering in
// its own voice. It proves the vectors are not GJS-specific. It says nothing about the subset
// still holding them once ITS store is the real thing: that is this file. The subject here is
// `createGObject(door, createRealGioEngine(requireGi))` — the core's refusals, accessors,
// construct order and error messages, over real GTypes, real `notify`, real emissions and real
// `GBinding`.
//
// SO ALL 24 ROWS RUN HERE, including the seven `holds: 'subset'` refusals the oracle leg skips
// (`isOracle: false`): the refusals are the core's and must survive the engine swap — that is the
// one claim an engine could silently break. The four `widget: true` rows run too, because the
// door is the same two-fake-widget door `gobject.spec.ts` uses, not a real Gtk; no display is
// needed and none is consulted.
//
// WHY IT LIVES HERE AND NOT BESIDE THE VECTORS. `@gjsify/adwaita-core` is tier 2 and may not
// depend on this tier-3 package, and the subject needs the engine. ADR 0105 § 7 asks for the
// engine AND the node-gi subject in this package; the stage-0 ORACLE subject stays in the core
// because it needs no engine at all.
//
// WHY `requireGi` IS A PARAMETER: `engine.ts`'s header. The bridge is imported once, in
// `src/test.node-gi.mts`, which `tsconfig.json` excludes.

import { describe, expect, it } from '@gjsify/unit';

import { driveGObjectVectors, type GObjectSubject } from '@gjsify/adwaita-core/conformance';
import {
    createGObject,
    registeredClassOf,
    type BindingFlag,
    type BlueprintTemplate,
    type BuiltTemplate,
    type GObjectConstructor,
    type GObjectDoor,
    type GObjectEngine,
    type GObjectInstance,
    type ParamSpec,
    type TemplateScope,
} from '@gjsify/adwaita-core';

import { createRealGioEngine, type RequireGi } from './engine.js';

/**
 * The same test door `gobject.spec.ts` drives the pure-JS subject through: two fake widgets, so
 * the template rows exercise the real construction order, handler scope and bind source rather
 * than a mock. Registered against the SAME namespace, so a fake widget has a twin too and a
 * template bind is a real `GBinding` between two real GObjects.
 */
function createSubject(engine: GObjectEngine): GObjectSubject {
    // Declared before the door closes over them and assigned after `createGObject` returns: the
    // door is an argument to the namespace that registers the widgets it builds.
    let FakeSwitch: GObjectConstructor | undefined;
    let FakeButton: GObjectConstructor | undefined;

    const door: GObjectDoor = {
        name: 'test door',
        dispatch(_target, event) {
            throw new Error(`test door: nothing to dispatch '${event}' on`);
        },
        listen(_target, event) {
            throw new Error(`test door: nothing to listen '${event}' on`);
        },
        createFromTree(tree: BlueprintTemplate, scope: TemplateScope): BuiltTemplate {
            const objects: Record<string, object> = {};
            const byId = (id: string): GObjectInstance =>
                (id === 'template' ? scope.instance : objects[id]) as GObjectInstance;
            const build = (node: BlueprintTemplate): object => {
                const Klass = node.tag === 'GtkSwitch' ? FakeSwitch : node.tag === 'GtkButton' ? FakeButton : undefined;
                if (!Klass) throw new Error(`test door: no fake widget for ${node.tag}`);
                const widget = new (Klass as unknown as new () => GObjectInstance)();
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
        attach() {},
        register() {},
    };

    const G = createGObject(door, engine);
    const { ParamSpec: P, ParamFlags: F } = G;
    FakeSwitch = G.registerClass(
        { GTypeName: 'FakeSwitch', Properties: { active: P.boolean('active', '', '', F.READWRITE, false) } },
        class extends G.Object {},
    );
    FakeButton = G.registerClass(
        { GTypeName: 'FakeButton', Signals: { clicked: { param_types: [] } } },
        class extends G.Object {},
    );

    return {
        name: 'adwaita-core on real GObject (node-gi engine)',
        isOracle: false,
        GObject: G,
        Widget: G.Object,
        template: (source) => source.tree,
        // The ENGINE's binding engine, not `bindProperties`: on this subject the two differ, and
        // the binding rows are about what the engine does.
        bind: (source, sourceProperty, target, targetProperty, flags) => {
            engine.bind(source, sourceProperty, target, targetProperty, flags);
        },
    };
}

export const realGioEngineSuite = (requireGi: RequireGi) => async () => {
    const engine = createRealGioEngine(requireGi);

    await driveGObjectVectors(createSubject(engine), { describe, expect, it });

    await describe('real-gio engine: the engine itself (ADR 0105 § 2)', async () => {
        await it('names itself in a diagnostic', () => {
            expect(engine.name).toBe('real-gio');
        });

        await it('refuses an instance of a class it never registered', () => {
            class Stranger {}
            expect(() => engine.getValue(new Stranger(), { name: 'x' } as never)).toThrow();
        });

        // The one engine member whose CONTRACT no vector can see: `setValue` returns whether the
        // CORE still owes a notify, and this engine answers false because the write already
        // notified. A vector only counts notifies, and it counts one either way — so a `setValue`
        // that wrongly returned true would pass every row and double-notify in production.
        await it('leaves the notify to its own store: setValue never asks the core for one', () => {
            const { GObject: G } = createSubject(engine);
            const { ParamSpec: P, ParamFlags: F } = G;
            const K = G.registerClass(
                { GTypeName: 'EngineNotifyOwner', Properties: { code: P.string('code', '', '', F.READWRITE, '') } },
                class extends G.Object {},
            );
            const instance = new K();
            const seen: string[] = [];
            instance.connect('notify::code', () => seen.push('n'));
            const asked = engine.setValue(instance, specOf(K, 'code'), 'x');
            expect([asked, seen.join('')]).toStrictEqual([false, 'n']);
        });
    });
};

/** The ParamSpec of a registered class, as the core finds it — the engine takes specs, not names. */
function specOf(klass: object, name: string): ParamSpec {
    const found = registeredClassOf(klass)?.properties.find((spec) => spec.name === name);
    if (!found) throw new Error(`no '${name}' property on the registered class`);
    return found;
}
