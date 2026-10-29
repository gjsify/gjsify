// The SUBJECT the GObject vectors run against when the engine is real — one definition, because
// there are now two legs driving it and they must drive the same thing.
//
// `engine.node-gi.spec.ts` runs it on the CI host (`gtk-host-node`, a desktop GI stack behind
// `@gjsify/node-gi`). `tests/integration/nativescript-gi/` runs it on an Android DEVICE, over the
// `libnode_gi.so` and typelibs `@gjsify/gi-runtime-android` put in the APK. The two differ in
// exactly one thing — where `requireGi` comes from — and in nothing else, which is the whole point
// of ADR 0105 stage 4: the device adds a payload, not a dialect. A second copy of this door is how
// that claim would quietly stop being true.
//
// WHY IT SHIPS rather than living in a spec file. Spec files are not published, and the device app
// is a separate package that installs this one. A door assembled a second time inside that app
// could drift in the ways that matter most here: which widgets exist, whether a template bind is a
// real `GBinding` between two real GObjects, what the handler scope is.
//
// It is a TEST door, not a Gtk one: two fake widgets registered against the same namespace, so the
// template rows exercise real construction order, real handler scope and a real bind source without
// a display. `adwaita-core`'s own `gobject.spec.ts` drives the pure-JS subject through the same
// shape; this is its real-engine twin.

import {
    createGObject,
    ListModel,
    type BindingFlag,
    type BlueprintTemplate,
    type BuiltTemplate,
    type GObjectConstructor,
    type GObjectDoor,
    type GObjectEngine,
    type GObjectInstance,
    type TemplateScope,
} from '@gjsify/adwaita-core';
import type { GObjectSubject } from '@gjsify/adwaita-core/conformance';

/** The name the real-engine leg has reported since ADR 0105 stage 2; a leg may name itself. */
export const SUBSET_SUBJECT_NAME = 'adwaita-core on real GObject (node-gi engine)';

/**
 * The GObject subset with `engine` behind it, as a {@link GObjectSubject} the conformance driver
 * takes.
 *
 * @param engine the engine under test — `createRealGioEngine(requireGi)` on both legs
 * @param name what the driver calls the suite, so a device run is distinguishable in logcat
 */
export function createSubsetSubject(engine: GObjectEngine, name: string = SUBSET_SUBJECT_NAME): GObjectSubject {
    // Declared before the door closes over them and assigned after `createGObject` returns: the
    // door is an argument to the namespace that registers the widgets it builds.
    let FakeSwitch: GObjectConstructor | undefined;
    let FakeButton: GObjectConstructor | undefined;
    let FakeDropDown: GObjectConstructor | undefined;
    let FakeStringList: GObjectConstructor | undefined;

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
    // The twin of `Gtk.DropDown:model` (ADR 0122 § 6), the same pair `adwaita-core`'s own subject
    // registers — so the object-property rows measure the ENGINE and not a second door. This is
    // where the engine's `ParamSpec.object` leg is exercised: `register` translates the declared
    // value type into a real `g_param_spec_object` over `Gio.ListModel`, and the rows then hold it
    // to the C property's refusals, its single notify per change and its identity round-trip.
    FakeDropDown = G.registerClass(
        { GTypeName: 'FakeDropDown', Properties: { model: P.object('model', '', '', F.READWRITE, ListModel) } },
        class extends G.Object {},
    );
    FakeStringList = G.registerClass(
        { GTypeName: 'FakeStringList', Implements: [ListModel] },
        class extends G.Object {
            vfunc_get_item_type(): unknown {
                return G.TYPE_OBJECT;
            }
            vfunc_get_n_items(): number {
                return 2;
            }
            vfunc_get_item(position: number): unknown {
                return position < 2 ? `item-${position}` : null;
            }
        },
    );

    return {
        name,
        isOracle: false,
        GObject: G,
        Widget: G.Object,
        template: (source) => source.tree,
        // The CORE's interface token, not a real `Gio.ListModel`: the interface is the subset's own
        // (ADR 0122 § 2) and the engine deliberately leaves it off the twin's GType — see
        // `register`'s comment in `engine.ts`. A real one here would describe a different subject.
        ListModel,
        objectProperty: () => ({
            instance: new (FakeDropDown as unknown as new () => GObjectInstance)(),
            accepted: new (FakeStringList as unknown as new () => GObjectInstance)(),
        }),
        // The ENGINE's binding engine, not `bindProperties`: on this subject the two differ, and
        // the binding rows are about what the engine does.
        bind: (source, sourceProperty, target, targetProperty, flags) => {
            engine.bind(source, sourceProperty, target, targetProperty, flags);
        },
    };
}
