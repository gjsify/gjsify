// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/nodes/element/Element.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify — no innerHTML/outerHTML, no querySelector/CSS selectors,
//   no Shadow DOM, no classList/DOMTokenList, no computed styles.
//   Selectors are NOT reimplemented here — they run the one engine in
//   `@gjsify/domparser/selectors` through `selector-adapter.ts` (ADR 0026).

import type { Event } from '@gjsify/dom-events';

import { closestSelector, matchesSelector, selectAll, selectOne } from '@gjsify/domparser/selectors';

import type { Attr } from './attr.js';
import { Node } from './node.js';
import { elementAdapter } from './selector-adapter.js';
import { NodeType } from './node-type.js';
import { NamedNodeMap } from './named-node-map.js';
import { NamespaceURI } from './namespace-uri.js';
import * as PS from './property-symbol.js';

/**
 * DOM Element class.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/Element
 */
export class Element extends Node {
    public [PS.tagName]: string = '';
    public [PS.localName]: string = '';
    public [PS.namespaceURI]: string | null = NamespaceURI.html;
    public [PS.prefix]: string | null = null;
    public [PS.attributes]: NamedNodeMap = new NamedNodeMap(this);
    public [PS.propertyEventListeners]: Map<string, ((event: Event) => void) | null> = new Map();

    constructor() {
        super();
        this[PS.nodeType] = NodeType.ELEMENT_NODE;
    }

    get tagName(): string {
        return this[PS.tagName];
    }

    get localName(): string {
        return this[PS.localName];
    }

    get namespaceURI(): string | null {
        return this[PS.namespaceURI];
    }

    get prefix(): string | null {
        return this[PS.prefix];
    }

    get nodeName(): string {
        return this[PS.tagName];
    }

    get attributes(): NamedNodeMap {
        return this[PS.attributes];
    }

    get id(): string {
        return this.getAttribute('id') ?? '';
    }

    set id(value: string) {
        this.setAttribute('id', value);
    }

    get className(): string {
        return this.getAttribute('class') ?? '';
    }

    set className(value: string) {
        this.setAttribute('class', value);
    }

    get children(): Element[] {
        return this[PS.elementChildren] as Element[];
    }

    get childElementCount(): number {
        return this[PS.elementChildren].length;
    }

    get firstElementChild(): Element | null {
        return (this[PS.elementChildren][0] as Element) ?? null;
    }

    get lastElementChild(): Element | null {
        const children = this[PS.elementChildren];
        return (children[children.length - 1] as Element) ?? null;
    }

    get previousElementSibling(): Element | null {
        const parent = this[PS.parentNode];
        if (!parent) return null;
        const siblings = parent[PS.elementChildren];
        const idx = siblings.indexOf(this);
        return idx > 0 ? (siblings[idx - 1] as Element) : null;
    }

    get nextElementSibling(): Element | null {
        const parent = this[PS.parentNode];
        if (!parent) return null;
        const siblings = parent[PS.elementChildren];
        const idx = siblings.indexOf(this);
        return idx !== -1 && idx < siblings.length - 1 ? (siblings[idx + 1] as Element) : null;
    }

    get textContent(): string {
        let text = '';
        for (const child of this[PS.childNodesList]) {
            if (child.textContent !== null) {
                text += child.textContent;
            }
        }
        return text;
    }

    set textContent(_value: string | null) {
        // Remove all children
        const children = this[PS.childNodesList];
        while (children.length > 0) {
            this.removeChild(children[0]);
        }
    }

    // -- Attribute methods --

    getAttribute(qualifiedName: string): string | null {
        const attr = this[PS.attributes].getNamedItem(qualifiedName);
        return attr ? attr.value : null;
    }

    getAttributeNS(namespace: string | null, localName: string): string | null {
        const attr = this[PS.attributes].getNamedItemNS(namespace, localName);
        return attr ? attr.value : null;
    }

    setAttribute(qualifiedName: string, value: string): void {
        this[PS.attributes]._setNamedItem(qualifiedName, String(value));
    }

    setAttributeNS(namespace: string | null, qualifiedName: string, value: string): void {
        const ns = namespace === '' ? null : namespace;
        const parts = qualifiedName.split(':');
        const prefix = parts.length > 1 ? parts[0] : null;
        this[PS.attributes]._setNamedItem(qualifiedName, String(value), ns, prefix);
    }

    removeAttribute(qualifiedName: string): void {
        this[PS.attributes]._removeNamedItem(qualifiedName);
    }

    removeAttributeNS(namespace: string | null, localName: string): void {
        const ns = namespace === '' ? null : namespace;
        this[PS.attributes]._removeNamedItemNS(ns, localName);
    }

    hasAttribute(qualifiedName: string): boolean {
        return this[PS.attributes].getNamedItem(qualifiedName) !== null;
    }

    hasAttributeNS(namespace: string | null, localName: string): boolean {
        return this[PS.attributes].getNamedItemNS(namespace, localName) !== null;
    }

    getAttributeNode(qualifiedName: string): unknown {
        return this[PS.attributes].getNamedItem(qualifiedName);
    }

    setAttributeNode(attr: unknown): unknown {
        return this[PS.attributes].setNamedItem(attr as Attr);
    }

    removeAttributeNode(attr: unknown): unknown {
        const existing = this[PS.attributes].getNamedItem((attr as { name: string }).name);
        if (!existing) {
            throw new DOMException(
                "Failed to execute 'removeAttributeNode' on 'Element': The attribute is not owned by this element.",
                'NotFoundError',
            );
        }
        this[PS.attributes].removeNamedItem(existing.name);
        return existing;
    }

    toggleAttribute(qualifiedName: string, force?: boolean): boolean {
        if (force !== undefined) {
            if (force) {
                this.setAttribute(qualifiedName, '');
                return true;
            }
            this.removeAttribute(qualifiedName);
            return false;
        }
        if (this.hasAttribute(qualifiedName)) {
            this.removeAttribute(qualifiedName);
            return false;
        }
        this.setAttribute(qualifiedName, '');
        return true;
    }

    hasAttributes(): boolean {
        return this[PS.attributes].length > 0;
    }

    // -- Override dispatchEvent to call on* property handlers --

    dispatchEvent(event: Event): boolean {
        const result = super.dispatchEvent(event);

        // Call on<type> property handler if registered
        const handler = this[PS.propertyEventListeners].get('on' + event.type);
        if (typeof handler === 'function') {
            handler.call(this, event);
        }

        return result;
    }

    // -- Selectors, over the shared engine (ADR 0026 § Decision 2) --
    //
    // These four used to return `null` / `[]` / `false` / `null` without looking
    // at the tree: methods that answer, always wrongly, and never fail. A caller
    // could not tell "no match" from "not implemented", which is the failure
    // shape that costs the most to find. They now run the same engine the HTML
    // parser does, through `elementAdapter`.

    querySelector(selectors: string): Element | null {
        return selectOne(selectors, this as Node, elementAdapter) as Element | null;
    }

    querySelectorAll(selectors: string): Element[] {
        return selectAll(selectors, this as Node, elementAdapter) as Element[];
    }

    matches(selectors: string): boolean {
        return matchesSelector(selectors, this as Node, elementAdapter);
    }

    closest(selectors: string): Element | null {
        return closestSelector(selectors, this as Node, elementAdapter) as Element | null;
    }

    getElementsByTagName(tagName: string): Element[] {
        const results: Element[] = [];
        const upperTag = tagName.toUpperCase();
        const walk = (node: Node): void => {
            for (const child of node[PS.childNodesList]) {
                if (child[PS.nodeType] === NodeType.ELEMENT_NODE) {
                    const el = child as Element;
                    if (tagName === '*' || el[PS.tagName] === upperTag) {
                        results.push(el);
                    }
                    walk(el);
                }
            }
        };
        walk(this);
        return results;
    }

    getElementsByClassName(className: string): Element[] {
        const results: Element[] = [];
        const targetClasses = className.split(/\s+/).filter(Boolean);
        const walk = (node: Node): void => {
            for (const child of node[PS.childNodesList]) {
                if (child[PS.nodeType] === NodeType.ELEMENT_NODE) {
                    const el = child as Element;
                    const elClasses = el.className.split(/\s+/);
                    if (targetClasses.every((c) => elClasses.includes(c))) {
                        results.push(el);
                    }
                    walk(el);
                }
            }
        };
        walk(this);
        return results;
    }

    // -- Clone --

    cloneNode(deep = false): Element {
        const clone = super.cloneNode(false) as Element;
        clone[PS.tagName] = this[PS.tagName];
        clone[PS.localName] = this[PS.localName];
        clone[PS.namespaceURI] = this[PS.namespaceURI];
        clone[PS.prefix] = this[PS.prefix];

        // Clone attributes
        for (const attr of this[PS.attributes]) {
            clone.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
        }

        if (deep) {
            for (const child of this[PS.childNodesList]) {
                clone.appendChild(child.cloneNode(true));
            }
        }

        return clone;
    }

    // -- Backing-widget resize notifications --
    //
    // Framework bridges (`@gjsify/webgl`, `@gjsify/canvas2d`, `@gjsify/video`,
    // `@gjsify/iframe`) pair a polyfill DOM element with a real GTK widget.
    // When the widget's GTK `resize` signal fires, the bridge forwards the
    // new allocation to the paired element via `notifyElementResize()` —
    // this is the subscription side of that pipeline, used by the
    // `ResizeObserver` polyfill so that consumers writing standard
    // `new ResizeObserver(cb).observe(target)` code (Excalibur.js 0.32's
    // `DisplayMode.FillContainer` is the canonical example) get fired on
    // real GTK allocation changes, not on layout — which has no analogue
    // in the GJS env.

    private _resizeSubscribers: Set<(width: number, height: number) => void> | null = null;

    /**
     * Latest known allocation from a backing GTK widget, written by
     * `notifyElementResize()` (target + every ancestor). The polyfill
     * has no layout engine, so without this `clientWidth` /
     * `clientHeight` would always return 0 — which breaks consumers
     * that use `ResizeObserver` to react to a parent's size
     * (Excalibur.js `DisplayMode.FillContainer` reads
     * `canvas.parentElement.clientWidth` to compute its resolution;
     * with 0 the resolution comes out 0×0 and the canvas renders
     * blank).
     *
     * Multi-bridge scenarios fall back to last-write-wins on
     * shared ancestors (typically `document.body`) — acceptable
     * because the consumers that care (one canvas filling the
     * window) have a 1-to-1 bridge / ancestor mapping anyway.
     */
    _allocatedClientWidth = 0;
    _allocatedClientHeight = 0;

    /**
     * @internal Subscribe to backing-widget resize notifications.
     *
     * Returns an unsubscribe function. Two observers subscribing to the
     * same target each get their own disposer so the wrong one can never
     * cancel the other's subscription.
     */
    _onResize(cb: (width: number, height: number) => void): () => void {
        const set = this._resizeSubscribers ?? (this._resizeSubscribers = new Set());
        set.add(cb);
        return () => {
            set.delete(cb);
            if (set.size === 0) this._resizeSubscribers = null;
        };
    }

    /**
     * @internal Dispatch the new size to every subscriber. Called by
     * `notifyElementResize()`; user code must use that wrapper because
     * it also walks up the ancestor chain (browser `ResizeObserver`
     * semantics — Excalibur observes `canvas.parentElement`, not the
     * canvas itself, so the bridge resize has to reach `document.body`).
     */
    _fireResizeSubscribers(width: number, height: number): void {
        const set = this._resizeSubscribers;
        if (!set || set.size === 0) return;
        // Snapshot in case a subscriber synchronously disconnects mid-dispatch.
        // oxlint-disable-next-line no-useless-spread -- the spread is the snapshot; iterating `set` directly would be mutation-unsafe
        for (const cb of [...set]) {
            try {
                cb(width, height);
            } catch (err) {
                console.error('ResizeObserver subscriber threw:', err);
            }
        }
    }

    // -- Pointer capture (no-op stubs, GTK tracks pointer implicitly) --
    // Reference: refs/happy-dom/packages/happy-dom/src/nodes/element/Element.ts

    private _pointerCaptures = new Set<number>();

    setPointerCapture(pointerId: number): void {
        this._pointerCaptures.add(pointerId);
    }

    releasePointerCapture(pointerId: number): void {
        this._pointerCaptures.delete(pointerId);
    }

    hasPointerCapture(pointerId: number): boolean {
        return this._pointerCaptures.has(pointerId);
    }

    get [Symbol.toStringTag](): string {
        return 'Element';
    }
}
