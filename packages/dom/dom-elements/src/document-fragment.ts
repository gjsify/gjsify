// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/nodes/document-fragment/DocumentFragment.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify — no querySelector/querySelectorAll, no HTML parsing

import { Node } from './node.js';
import { Element } from './element.js';
import { Text } from './text.js';
import { NodeType } from './node-type.js';
import * as PS from './property-symbol.js';

/**
 * DocumentFragment.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/DocumentFragment
 */
export class DocumentFragment extends Node {
	constructor() {
		super();
		this[PS.nodeType] = NodeType.DOCUMENT_FRAGMENT_NODE;
	}

	get nodeName(): string {
		return '#document-fragment';
	}

	/** Element children only (excludes text/comment nodes) */
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

	get textContent(): string {
		let text = '';
		for (const child of this.childNodes) {
			if (child.textContent !== null) {
				text += child.textContent;
			}
		}
		return text;
	}

	set textContent(value: string) {
		// Remove all children
		while (this.firstChild) {
			this.removeChild(this.firstChild);
		}
		// Add text node if value is non-empty
		if (value) {
			// Import Text lazily to avoid circular dependency
this.appendChild(new Text(value));
		}
	}

	/**
	 * Append nodes or strings to this fragment.
	 */
	append(...nodes: (Node | string)[]): void {
		for (const node of nodes) {
			if (typeof node === 'string') {
		this.appendChild(new Text(node));
			} else {
				this.appendChild(node);
			}
		}
	}

	/**
	 * Prepend nodes or strings to this fragment.
	 */
	prepend(...nodes: (Node | string)[]): void {
		const firstChild = this.firstChild;
		for (const node of nodes) {
			if (typeof node === 'string') {
		this.insertBefore(new Text(node), firstChild);
			} else {
				this.insertBefore(node, firstChild);
			}
		}
	}

	/**
	 * Replace all children with the given nodes.
	 */
	replaceChildren(...nodes: (Node | string)[]): void {
		while (this.firstChild) {
			this.removeChild(this.firstChild);
		}
		this.append(...nodes);
	}

	/**
	 * Find an element by ID in this fragment's children.
	 */
	getElementById(id: string): Element | null {
		for (const child of this.children) {
			if (child.id === id) return child;
			const found = this._findById(child, id);
			if (found) return found;
		}
		return null;
	}

	private _findById(element: Element, id: string): Element | null {
		for (const child of element.children) {
			if (child.id === id) return child;
			const found = this._findById(child, id);
			if (found) return found;
		}
		return null;
	}

	cloneNode(deep = false): DocumentFragment {
		const clone = new DocumentFragment();
		if (deep) {
			for (const child of this.childNodes) {
				clone.appendChild(child.cloneNode(true));
			}
		}
		return clone;
	}

	get [Symbol.toStringTag](): string {
		return 'DocumentFragment';
	}
}
