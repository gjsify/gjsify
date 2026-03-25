// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/nodes/attr/Attr.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify — lightweight data holder, does not extend Node

import * as PS from './property-symbol.js';

import type { Element } from './element.js';

/**
 * Represents a DOM attribute.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/Attr
 */
export class Attr {
	public [PS.name]: string;
	public [PS.value]: string;
	public [PS.ownerElement]: Element | null;

	public readonly localName: string;
	public readonly namespaceURI: string | null;
	public readonly prefix: string | null;
	public readonly specified = true;

	constructor(
		name: string,
		value: string,
		namespaceURI: string | null = null,
		prefix: string | null = null,
		ownerElement: Element | null = null,
	) {
		this[PS.name] = name;
		this[PS.value] = value;
		this[PS.ownerElement] = ownerElement;
		this.namespaceURI = namespaceURI;
		this.prefix = prefix;

		// localName is the part after the prefix colon, or the full name if no prefix
		const colonIndex = name.indexOf(':');
		this.localName = colonIndex !== -1 ? name.slice(colonIndex + 1) : name;
	}

	get name(): string {
		return this[PS.name];
	}

	get value(): string {
		return this[PS.value];
	}

	set value(value: string) {
		this[PS.value] = value;
	}

	get ownerElement(): Element | null {
		return this[PS.ownerElement];
	}

	get [Symbol.toStringTag](): string {
		return 'Attr';
	}
}
