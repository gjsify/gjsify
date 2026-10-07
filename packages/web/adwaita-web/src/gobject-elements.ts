// `connect` / `disconnect` / `emit` / `notify` on the elements a template builds (ADR 0096 § 3).
//
// A registered class gets these from the core. The widgets it holds are plain custom elements,
// which talk in DOM events, so a template instance that binds to one or connects a handler needs
// the same four methods on it — over the events the element DECLARES in `static signals`, never
// over a name it merely might dispatch.
//
// NOTIFY ON AN ELEMENT THAT IS NOT CONNECTED (the gap ADR 0093 Progress row 4 names, measured
// in `gobject-door.spec.ts`): an element dispatches `notify::<property>` from its
// `attributeChangedCallback`, which returns early until the element has been connected once. The
// children of a template are built in the constructor and attached on the first
// `connectedCallback`, so every write to them in between is silent, and a `bidirectional` bind
// never hears its target. {@link ensureNotifying} closes it per instance: the property's own
// setter is wrapped, and a change the element did not announce itself is announced here. When
// the element does announce, nothing is added, so a connected element still notifies once.

import { attributeOf, propertyOf } from '@gjsify/adwaita-core/tags';

import { dispatchedSignalsOf } from './signals.js';

type Handler = (emitter: HTMLElement, ...args: unknown[]) => unknown;

/** Events {@link dispatchElement} created, whose `detail` is the argument list of an `emit`. */
const EMITTED = new WeakSet<Event>();
const NOTIFYING = new WeakMap<Element, Set<string>>();
const WITH_API = new WeakSet<Element>();
let nextHandlerId = 0;

/** Whether `el` got its four methods from {@link installElementApi} (a registered class has the core's). */
export function hasElementApi(el: object): boolean {
    return WITH_API.has(el as Element);
}

/** The DOM event `signal` arrives as on `el`, or a refusal naming what the element does declare. */
function eventOf(el: Element, signal: string): string {
    const declared = dispatchedSignalsOf(el);
    const event =
        declared[signal] ??
        (signal.startsWith('notify::')
            ? declared[`notify::${attributeOf(signal.slice('notify::'.length))}`]
            : undefined);
    if (event === undefined) {
        throw new Error(
            `<${el.localName}> declares no signal '${signal}'. It dispatches: ${Object.keys(declared).join(', ') || 'none'}.`,
        );
    }
    return event;
}

/** The nearest descriptor of `member` above `el`'s own properties. */
function inheritedDescriptor(el: object, member: string): PropertyDescriptor | undefined {
    for (
        let at = Object.getPrototypeOf(el) as object | null;
        at !== null;
        at = Object.getPrototypeOf(at) as object | null
    ) {
        const descriptor = Object.getOwnPropertyDescriptor(at, member);
        if (descriptor !== undefined) return descriptor;
    }
    return undefined;
}

function notifyElement(el: HTMLElement, name: string): void {
    const member = propertyOf(name);
    el.dispatchEvent(
        new CustomEvent(eventOf(el, `notify::${name}`), {
            bubbles: true,
            detail: { [member]: (el as unknown as Record<string, unknown>)[member] },
        }),
    );
}

/** Makes every change of `property` on `el` reach a `notify::<property>` listener, connected or not. */
export function ensureNotifying(el: HTMLElement, property: string): void {
    const member = propertyOf(property);
    const patched = NOTIFYING.get(el) ?? new Set<string>();
    if (patched.has(member)) return;
    patched.add(member);
    NOTIFYING.set(el, patched);
    if (Object.getOwnPropertyDescriptor(el, member) !== undefined) return;
    const inherited = inheritedDescriptor(el, member);
    if (inherited?.get === undefined || inherited.set === undefined) return;
    const { get, set } = inherited;
    const event = eventOf(el, `notify::${property}`);
    Object.defineProperty(el, member, {
        configurable: true,
        enumerable: false,
        get() {
            return get.call(this);
        },
        set(this: HTMLElement, value: unknown) {
            const before = get.call(this);
            let announced = false;
            const mark = (domEvent: Event) => {
                if (domEvent.target === this) announced = true;
            };
            this.addEventListener(event, mark);
            try {
                set.call(this, value);
            } finally {
                this.removeEventListener(event, mark);
            }
            if (!announced && get.call(this) !== before) notifyElement(this, property);
        },
    });
}

/** Calls `handler(el, ...args)` for `signal`; returns the disconnect. */
export function listenElement(el: HTMLElement, signal: string, handler: Handler): () => void {
    const event = eventOf(el, signal);
    const notification = signal.startsWith('notify::');
    if (notification) ensureNotifying(el, signal.slice('notify::'.length));
    const listener = (domEvent: Event) => {
        // A notification bubbles, and a parent must not hear its child's property as its own.
        if (notification && domEvent.target !== el) return;
        handler(el, ...(EMITTED.has(domEvent) ? ((domEvent as CustomEvent).detail as unknown[]) : []));
    };
    el.addEventListener(event, listener);
    return () => el.removeEventListener(event, listener);
}

export function dispatchElement(el: HTMLElement, signal: string, args: readonly unknown[]): void {
    const event = eventOf(el, signal);
    const domEvent = new CustomEvent(event, { detail: args, bubbles: event.startsWith('notify::') });
    EMITTED.add(domEvent);
    el.dispatchEvent(domEvent);
}

/** Gives `el` the instance API of a registered class, over the events it declares. */
export function installElementApi(el: HTMLElement): void {
    // A registered class already has the core's four methods on its prototype.
    if (typeof (el as unknown as Record<string, unknown>).connect === 'function') return;
    WITH_API.add(el);
    const connections = new Map<number, () => void>();
    const define = (name: string, value: unknown) =>
        Object.defineProperty(el, name, { value, configurable: true, writable: true, enumerable: false });
    define('connect', (signal: string, handler: Handler): number => {
        const unlisten = listenElement(el, signal, handler);
        const id = ++nextHandlerId;
        connections.set(id, unlisten);
        return id;
    });
    define('disconnect', (id: number): void => {
        const unlisten = connections.get(id);
        if (unlisten === undefined) throw new Error(`No handler with id ${id} is connected to <${el.localName}>`);
        connections.delete(id);
        unlisten();
    });
    define('emit', (signal: string, ...args: unknown[]): void => dispatchElement(el, signal, args));
    define('notify', (name: string): void => notifyElement(el, name));
}

const API_MEMBERS = new Set(['connect', 'disconnect', 'emit', 'notify']);

/**
 * The end of a bind the core's engine drives. An element speaks camelCase members where a `.blp`
 * says `dash-name`, so a built element is wrapped to translate the name; a registered class
 * already has the core's accessors and aliases and is returned as it is.
 */
export function endpointOf(el: HTMLElement): HTMLElement {
    if (!hasElementApi(el)) return el;
    return new Proxy(el, {
        get(target, key) {
            if (typeof key !== 'string' || API_MEMBERS.has(key)) return Reflect.get(target, key, target);
            const value = Reflect.get(target, propertyOf(key), target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, key, value) {
            return Reflect.set(target, typeof key === 'string' ? propertyOf(key) : key, value, target);
        },
    });
}
