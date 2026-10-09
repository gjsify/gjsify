// The web door of the GObject subset (ADR 0096 § 1): how custom elements dispatch and listen for a
// named event, build a template, and take the built children.
//
// A registered class is a custom element. `registerClass` defines it under a tag derived from
// its `GTypeName`, and the instance is built in the order of GJS's `Gtk.Widget._init` by a class
// inserted between the class and its widget base, because the base is an element that knows
// nothing of GObject and `super(params)` is the only place a subclass hands control down.
//
// CHILDREN ARE ATTACHED AT THE FIRST `connectedCallback`, never in the constructor: the custom
// element rules forbid a constructor to give the element children or attributes when
// `createElement` or the parser creates it. They are created, and wired to their handlers and
// binds, from the constructor on, so `this._x.connect(…)` in a subclass constructor works.

import {
    constructRegistered,
    type BuiltTemplate,
    type ClassLike,
    type GObjectDoor,
    type RegisteredClass,
    type TemplateScope,
    widgetDisplayMembers,
} from '@gjsify/adwaita-core';
import { propertyOf } from '@gjsify/adwaita-core/tags';

import { gdk } from './namespace/gdk.js';
import { dispatchElement, listenElement } from './gobject-elements.js';
import { buildTemplateTree, type BuiltTemplateTree } from './shared-tree-builder.js';
import { registerTemplateClass } from './template-classes.js';

type Ctor = new (...args: never[]) => HTMLElement;

const PENDING = new WeakMap<HTMLElement, BuiltTemplateTree[]>();
const CONSTRUCTED = new WeakSet<HTMLElement>();
const DEFINED_FOR = new Map<string, string>();

/** `Hexdump` → `gjsify-hexdump`, `GoVecNotify` → `gjsify-go-vec-notify`. */
export function tagForTypeName(typeName: string): string {
    const kebab = typeName
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `gjsify-${kebab}`;
}

function isElementClass(klass: ClassLike): boolean {
    return (klass as { prototype: object }).prototype instanceof HTMLElement;
}

/** The signals a registered element declares: its widget base's, one `notify::` per property, its own. */
function declareSignals(klass: ClassLike, info: RegisteredClass): void {
    const inherited = (klass as unknown as { signals?: Record<string, string> }).signals ?? {};
    const signals: Record<string, string> = { ...inherited };
    for (const spec of info.properties) signals[`notify::${spec.name}`] = `notify::${spec.name}`;
    for (const name of Object.keys(info.signals)) signals[name] = name;
    Object.defineProperty(klass, 'signals', { value: signals, configurable: true, writable: true });
}

function attachPending(host: HTMLElement): void {
    const pending = PENDING.get(host);
    if (pending === undefined) return;
    PENDING.delete(host);
    for (const built of pending) {
        built.finish();
        host.append(...built.children);
    }
}

export const webDoor: GObjectDoor = {
    name: 'adwaita-web',

    dispatch(target, event, args) {
        if (!(target instanceof HTMLElement)) throw new Error(`No signal '${event}' on object '${String(target)}'`);
        dispatchElement(target, event, args);
    },

    listen(target, event, handler) {
        if (!(target instanceof HTMLElement)) throw new Error(`No signal '${event}' on object '${String(target)}'`);
        return listenElement(target, event, handler as never);
    },

    createFromTree(tree, scope: TemplateScope, host): BuiltTemplate {
        return buildTemplateTree(tree, scope, host as HTMLElement);
    },

    attach(host, built) {
        const pending = PENDING.get(host as HTMLElement) ?? [];
        pending.push(built as BuiltTemplateTree);
        PENDING.set(host as HTMLElement, pending);
    },

    register(klass, info) {
        // A class with no widget model beneath it is built by `GObject.Object`, which is the core's.
        if (!isElementClass(klass)) return;
        const tag = tagForTypeName(info.typeName);
        const known = DEFINED_FOR.get(tag) ?? (customElements.get(tag) === undefined ? undefined : 'another class');
        if (known !== undefined) {
            throw new Error(
                `GObject.registerClass: ${info.typeName} would be <${tag}>, which ${known} already defines. ` +
                    'Give the class a distinct GTypeName.',
            );
        }

        const Parent = Object.getPrototypeOf(klass) as Ctor;
        class Constructing extends Parent {
            constructor(params?: Record<string, unknown>) {
                super();
                // A registered base ran the whole chain already, for the most derived class.
                if (CONSTRUCTED.has(this)) return;
                CONSTRUCTED.add(this);
                const rest = constructRegistered(this, params);
                for (const [key, value] of Object.entries(rest)) {
                    const member = propertyOf(key);
                    if (!(member in this)) throw new Error(`No property ${key} on <${tag}>`);
                    (this as unknown as Record<string, unknown>)[member] = value;
                }
            }
        }
        Object.setPrototypeOf(klass, Constructing);
        Object.setPrototypeOf((klass as { prototype: object }).prototype, Constructing.prototype);

        const proto = (klass as { prototype: Record<string, unknown> }).prototype;
        // `this.get_display()` / `this.get_clipboard()`, as on a realized Gtk.Widget; a class's own wins.
        for (const [name, member] of Object.entries(widgetDisplayMembers(gdk))) {
            if (!(name in proto))
                Object.defineProperty(proto, name, { value: member, writable: true, configurable: true });
        }
        const inherited = proto.connectedCallback as (() => void) | undefined;
        Object.defineProperty(proto, 'connectedCallback', {
            configurable: true,
            writable: true,
            value(this: HTMLElement) {
                attachPending(this);
                inherited?.call(this);
            },
        });

        declareSignals(klass, info);
        customElements.define(tag, klass as unknown as CustomElementConstructor);
        DEFINED_FOR.set(tag, info.typeName);
        registerTemplateClass(info.typeName, tag);
    },
};
