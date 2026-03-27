// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/nodes/element/Element.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify — no innerHTML/outerHTML, no querySelector/CSS selectors,
//   no Shadow DOM, no classList/DOMTokenList, no computed styles

import { Event } from '@gjsify/dom-events';

import { Node } from './node.js';
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
		return this[PS.attributes].setNamedItem(attr as any);
	}

	removeAttributeNode(attr: unknown): unknown {
		const existing = this[PS.attributes].getNamedItem((attr as any).name);
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

	// -- Stubs for commonly expected methods --

	querySelector(_selectors: string): Element | null {
		return null;
	}

	querySelectorAll(_selectors: string): Element[] {
		return [];
	}

	matches(_selectors: string): boolean {
		return false;
	}

	closest(_selectors: string): Element | null {
		return null;
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
					if (targetClasses.every(c => elClasses.includes(c))) {
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

	get [Symbol.toStringTag](): string {
		return 'Element';
	}
}
