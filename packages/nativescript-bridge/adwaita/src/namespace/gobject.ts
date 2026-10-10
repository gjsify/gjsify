// The GObject half of `@gjsify/adwaita-nativescript`'s vocabulary — `GObject.registerClass` and
// its subset (ADR 0096). The behaviour lives once, in `@gjsify/adwaita-core`; this file is the
// DOOR over NativeScript widgets that `createGObject` asks for.
//
// A SUBPATH (`./gobject`) AND NOT A MEMBER OF `src/index.ts`, because registering a class builds
// its template through `../builder`, and `builder/index.ts` documents why nothing on the root's
// import path may reach it: it needs the `@nativescript/core` alias the trees entry supplies.
//
// WHY `registerClass` INSERTS A LAYER BENEATH THE CLASS. A GNOME class calls `super(params)` and
// expects `this._copyButton` afterwards, so the template has to be built inside the port base's
// constructor chain. The port widgets apply their construct bag (which throws on a key it does
// not declare) at the end of their own constructors, so the one place that sees the raw `params`
// first is a class between the widget and the application class. `registerClass` splices one in
// with `setPrototypeOf`: `super(params)` of the application class lands in it, it builds the
// widget with no bag, runs the core's construction order, and hands the bag's remainder to the
// port's own `applyConstructProps`.
//
// A WIDGET ALREADY HAS `connect`, `disconnect`, `emit` and `notify(data)` (`withSignals`, and
// NativeScript's `Observable.notify`, which takes a payload object). The spliced layer puts the
// core's registry in front of them: a declared property or signal goes to the registry, anything
// else falls through to the widget's own event system via `listen` / `dispatch`, and `notify`
// with a payload object stays NativeScript's.

import {
    GObjectObject,
    connectInstance,
    constructRegistered,
    createGObject,
    disconnectInstance,
    emitInstance,
    notifyInstance,
    registeredClassOf,
    type BuiltTemplate,
    type ClassLike,
    type GObjectDoor,
    type GObjectInstance,
    type RegisteredClass,
    type SignalHandler,
    widgetDisplayMembers,
} from '@gjsify/adwaita-core';
import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';

import type { View } from '@nativescript/core';

import { buildInto } from '../builder/index.js';
import { gdk } from './gdk.js';
import { registerTemplateClass, type TemplateClass } from '../builder/template-classes.js';
import { applyConstructProps } from '../widgets/construct-props.js';

type Constructor = new (...args: never[]) => object;
type Payload = { eventName: string; object: object; [key: string]: unknown };
type EventTarget_ = {
    addEventListener(name: string, listener: (data: Payload) => void): void;
    removeEventListener(name: string, listener: (data: Payload) => void): void;
    notify(data: Payload): void;
};

/** The nearest registered class of what is being constructed: the layer of that class runs. */
function nearestRegistered(constructed: unknown): unknown {
    for (let each = constructed; typeof each === 'function'; each = Object.getPrototypeOf(each)) {
        if (registeredClassOf(each) !== undefined) return each;
    }
    return undefined;
}

/** `emittedSignals` is what the builder checks before it connects a handler or a `bind`. */
function declareEmitted(klass: ClassLike, info: RegisteredClass): void {
    const inherited = (klass as unknown as { emittedSignals?: readonly string[] }).emittedSignals ?? [];
    const own = [...info.properties.map((spec) => `notify::${spec.name}`), ...Object.keys(info.signals)];
    Object.defineProperty(klass, 'emittedSignals', {
        value: [...new Set([...inherited, ...own])],
        enumerable: false,
        configurable: true,
        writable: true,
    });
}

function spliceLayer(klass: ClassLike): void {
    const Parent = Object.getPrototypeOf(klass) as Constructor;
    const baseNotify = (Parent.prototype as EventTarget_).notify;

    class Registered extends (Parent as new (...args: never[]) => object) {
        constructor(params?: Record<string, unknown>) {
            super();
            if (nearestRegistered(new.target) !== klass) return;
            const rest = constructRegistered(this, params);
            applyConstructProps(this, rest);
        }
    }

    const instanceApi: Record<string, unknown> = {
        connect(this: GObjectInstance, signal: string, handler: SignalHandler) {
            return connectInstance(this, signal, handler);
        },
        disconnect(this: GObjectInstance, id: number) {
            disconnectInstance(this, id);
        },
        emit(this: GObjectInstance, signal: string, ...args: unknown[]) {
            emitInstance(this, signal, ...args);
        },
        notify(this: GObjectInstance, name: string | Payload) {
            if (typeof name === 'string') notifyInstance(this, name);
            else baseNotify.call(this, name);
        },
    };
    // `this.get_display()` / `this.get_clipboard()`, as on a realized Gtk.Widget; a parent's own wins.
    for (const [name, member] of Object.entries(widgetDisplayMembers(gdk))) {
        if (!(name in Parent.prototype)) instanceApi[name] = member;
    }
    for (const [name, value] of Object.entries(instanceApi)) {
        Object.defineProperty(Registered.prototype, name, {
            value,
            writable: true,
            configurable: true,
            enumerable: false,
        });
    }
    Object.setPrototypeOf(klass, Registered);
    Object.setPrototypeOf((klass as unknown as { prototype: object }).prototype, Registered.prototype);
}

const door: GObjectDoor = {
    name: 'adwaita-nativescript',

    dispatch(target, event, args) {
        (target as EventTarget_).notify({ eventName: event, object: target, args });
    },

    listen(target, event, handler) {
        const listener = (data: Payload): void => {
            handler(target, data);
        };
        (target as EventTarget_).addEventListener(event, listener);
        return () => (target as EventTarget_).removeEventListener(event, listener);
    },

    createFromTree(tree, scope, host) {
        const objects = buildInto(host as View, tree as SharedTreeNode, { template: scope });
        // `buildInto` builds INTO the host: its children are already attached.
        return { children: [], objects: Object.fromEntries(objects) };
    },

    attach(_host: object, _built: BuiltTemplate) {},

    register(klass, info) {
        declareEmitted(klass, info);
        // A class over `GObject.Object` has no widget model: nothing to splice, nothing to name in a tree.
        if (klass.prototype instanceof GObjectObject) return;
        spliceLayer(klass);
        registerTemplateClass(info.typeName, klass as unknown as TemplateClass);
    },
};

// THE REAL-GObject OPT-IN IS ONE ARGUMENT, AND IT IS DELIBERATELY NOT MADE HERE YET.
// `createGObject(door, createRealGioEngine(requireGi))` from `@gjsify/adwaita-gobject-native`
// puts a real GObject behind this subset (ADR 0105 § 2), and the engine is implemented, wired
// into CI and green on all 24 `GOBJECT_VECTORS` over node-gi. What is missing is the premise
// UNDER it: that node-gi loads on NativeScript's V8 at all. That is ADR 0105's own open
// question, and this line is evaluated at MODULE LOAD — a `requireGi` that throws on a device
// would take the app down at startup, which is the failure mode this tree has already paid for
// once (`AGENTS.md` § "What the slice PROMISES"). A try/catch fallback is not the answer either:
// it would make "the subset is backed by real GObject" unknowable from inside the app.
// So the argument goes in when the probe says it can, and not before.
const created = createGObject(door);

const {
    Object: GObjectBase,
    registerClass,
    ParamSpec,
    ParamFlags,
    Value,
    TYPE_STRING,
    TYPE_BOOLEAN,
    TYPE_INT,
    TYPE_UINT,
    TYPE_DOUBLE,
    GTypeName,
    GTypeFlags,
    interfaces,
    properties,
    signals,
    requires,
    __gtkTemplate__,
    __gtkCssName__,
    __gtkChildren__,
    __gtkInternalChildren__,
    type_ensure,
    signal_stop_emission_by_name,
} = created;

export {
    GObjectBase as Object,
    registerClass,
    ParamSpec,
    ParamFlags,
    Value,
    TYPE_STRING,
    TYPE_BOOLEAN,
    TYPE_INT,
    TYPE_UINT,
    TYPE_DOUBLE,
    GTypeName,
    GTypeFlags,
    interfaces,
    properties,
    signals,
    requires,
    __gtkTemplate__,
    __gtkCssName__,
    __gtkChildren__,
    __gtkInternalChildren__,
    type_ensure,
    signal_stop_emission_by_name,
};
