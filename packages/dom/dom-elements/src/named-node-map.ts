// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/named-node-map/NamedNodeMap.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify — single Map storage, no proxy factory

import { Attr } from './attr.js';
import { NamespaceURI } from './namespace-uri.js';

import type { Element } from './element.js';

/**
 * Simplified NamedNodeMap for attribute storage.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/NamedNodeMap
 */
export class NamedNodeMap {
	private _items: Attr[] = [];
	private _ownerElement: Element;

	constructor(ownerElement: Element) {
		this._ownerElement = ownerElement;
	}

	get length(): number {
		return this._items.length;
	}

	item(index: number): Attr | null {
		return this._items[index] ?? null;
	}

	getNamedItem(qualifiedName: string): Attr | null {
		return this._findByName(qualifiedName);
	}

	getNamedItemNS(namespace: string | null, localName: string): Attr | null {
		const ns = namespace === '' ? null : namespace;
		for (const attr of this._items) {
			if (attr.namespaceURI === ns && attr.localName === localName) {
				return attr;
			}
		}
		return null;
	}

	setNamedItem(attr: Attr): Attr | null {
		return this._setAttr(attr);
	}

	setNamedItemNS(attr: Attr): Attr | null {
		return this._setAttr(attr);
	}

	removeNamedItem(qualifiedName: string): Attr {
		const existing = this._findByName(qualifiedName);
		if (!existing) {
			throw new DOMException(
				`Failed to execute 'removeNamedItem' on 'NamedNodeMap': No item with name '${qualifiedName}' was found.`,
				'NotFoundError',
			);
		}
		this._removeAttr(existing);
		return existing;
	}

	removeNamedItemNS(namespace: string | null, localName: string): Attr {
		const existing = this.getNamedItemNS(namespace, localName);
		if (!existing) {
			throw new DOMException(
				`Failed to execute 'removeNamedItemNS' on 'NamedNodeMap': No item with namespace '${namespace}' and localName '${localName}' was found.`,
				'NotFoundError',
			);
		}
		this._removeAttr(existing);
		return existing;
	}

	[Symbol.iterator](): IterableIterator<Attr> {
		return this._items[Symbol.iterator]();
	}

	get [Symbol.toStringTag](): string {
		return 'NamedNodeMap';
	}

	// -- Internal helpers --

	/** @internal Add or replace an attribute by name. */
	_setNamedItem(name: string, value: string, namespaceURI: string | null = null, prefix: string | null = null): void {
		const existing = namespaceURI !== null
			? this.getNamedItemNS(namespaceURI, name.includes(':') ? name.split(':')[1] : name)
			: this._findByName(name);

		if (existing) {
			existing.value = value;
		} else {
			const attr = new Attr(name, value, namespaceURI, prefix, this._ownerElement);
			this._items.push(attr);
		}
	}

	/** @internal Remove an attribute by name. Returns true if removed. */
	_removeNamedItem(name: string): boolean {
		const existing = this._findByName(name);
		if (existing) {
			this._removeAttr(existing);
			return true;
		}
		return false;
	}

	/** @internal Remove an attribute by namespace + localName. Returns true if removed. */
	_removeNamedItemNS(namespace: string | null, localName: string): boolean {
		const existing = this.getNamedItemNS(namespace, localName);
		if (existing) {
			this._removeAttr(existing);
			return true;
		}
		return false;
	}

	private _findByName(qualifiedName: string): Attr | null {
		// For HTML elements, attribute names are case-insensitive
		const isHTML = this._ownerElement.namespaceURI === NamespaceURI.html;
		const searchName = isHTML ? qualifiedName.toLowerCase() : qualifiedName;
		for (const attr of this._items) {
			const attrName = isHTML ? attr.name.toLowerCase() : attr.name;
			if (attrName === searchName) {
				return attr;
			}
		}
		return null;
	}

	private _setAttr(attr: Attr): Attr | null {
		// Find existing by namespace match or by name
		let existing: Attr | null = null;
		if (attr.namespaceURI !== null) {
			existing = this.getNamedItemNS(attr.namespaceURI, attr.localName);
		} else {
			existing = this._findByName(attr.name);
		}

		if (existing) {
			const oldAttr = new Attr(existing.name, existing.value, existing.namespaceURI, existing.prefix, existing.ownerElement);
			existing.value = attr.value;
			return oldAttr;
		}

		this._items.push(attr);
		return null;
	}

	private _removeAttr(attr: Attr): void {
		const idx = this._items.indexOf(attr);
		if (idx !== -1) {
			this._items.splice(idx, 1);
		}
	}
}
