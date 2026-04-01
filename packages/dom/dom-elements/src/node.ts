// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/nodes/node/Node.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify — no Document, no MutationObserver, no cache system,
//   extends @gjsify/dom-events EventTarget

import { EventTarget, Event as DOMEvent } from '@gjsify/dom-events';

import { NodeType } from './node-type.js';
import { NodeList } from './node-list.js';
import * as PS from './property-symbol.js';

/**
 * DOM Node base class.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/Node
 */
export class Node extends EventTarget {
	// Static node type constants
	static readonly ELEMENT_NODE = NodeType.ELEMENT_NODE;
	static readonly ATTRIBUTE_NODE = NodeType.ATTRIBUTE_NODE;
	static readonly TEXT_NODE = NodeType.TEXT_NODE;
	static readonly CDATA_SECTION_NODE = NodeType.CDATA_SECTION_NODE;
	static readonly PROCESSING_INSTRUCTION_NODE = NodeType.PROCESSING_INSTRUCTION_NODE;
	static readonly COMMENT_NODE = NodeType.COMMENT_NODE;
	static readonly DOCUMENT_NODE = NodeType.DOCUMENT_NODE;
	static readonly DOCUMENT_TYPE_NODE = NodeType.DOCUMENT_TYPE_NODE;
	static readonly DOCUMENT_FRAGMENT_NODE = NodeType.DOCUMENT_FRAGMENT_NODE;

	// Instance node type constants (mirror static for spec compliance)
	readonly ELEMENT_NODE = NodeType.ELEMENT_NODE;
	readonly ATTRIBUTE_NODE = NodeType.ATTRIBUTE_NODE;
	readonly TEXT_NODE = NodeType.TEXT_NODE;
	readonly CDATA_SECTION_NODE = NodeType.CDATA_SECTION_NODE;
	readonly PROCESSING_INSTRUCTION_NODE = NodeType.PROCESSING_INSTRUCTION_NODE;
	readonly COMMENT_NODE = NodeType.COMMENT_NODE;
	readonly DOCUMENT_NODE = NodeType.DOCUMENT_NODE;
	readonly DOCUMENT_TYPE_NODE = NodeType.DOCUMENT_TYPE_NODE;
	readonly DOCUMENT_FRAGMENT_NODE = NodeType.DOCUMENT_FRAGMENT_NODE;

	// DOCUMENT_POSITION constants
	static readonly DOCUMENT_POSITION_DISCONNECTED = 0x01;
	static readonly DOCUMENT_POSITION_PRECEDING = 0x02;
	static readonly DOCUMENT_POSITION_FOLLOWING = 0x04;
	static readonly DOCUMENT_POSITION_CONTAINS = 0x08;
	static readonly DOCUMENT_POSITION_CONTAINED_BY = 0x10;
	static readonly DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC = 0x20;

	// Internal state
	public [PS.nodeType]: number = NodeType.ELEMENT_NODE;
	public [PS.parentNode]: Node | null = null;
	public [PS.childNodesList]: Node[] = [];
	public [PS.elementChildren]: Node[] = [];
	public [PS.isConnected] = false;

	get nodeType(): number {
		return this[PS.nodeType];
	}

	get nodeName(): string {
		return '';
	}

	get parentNode(): Node | null {
		return this[PS.parentNode];
	}

	get parentElement(): Node | null {
		const parent = this[PS.parentNode];
		return parent && parent[PS.nodeType] === NodeType.ELEMENT_NODE ? parent : null;
	}

	get childNodes(): NodeList {
		return new NodeList(this[PS.childNodesList]);
	}

	get firstChild(): Node | null {
		return this[PS.childNodesList][0] ?? null;
	}

	get lastChild(): Node | null {
		const children = this[PS.childNodesList];
		return children[children.length - 1] ?? null;
	}

	get previousSibling(): Node | null {
		const parent = this[PS.parentNode];
		if (!parent) return null;
		const siblings = parent[PS.childNodesList];
		const idx = siblings.indexOf(this);
		return idx > 0 ? siblings[idx - 1] : null;
	}

	get nextSibling(): Node | null {
		const parent = this[PS.parentNode];
		if (!parent) return null;
		const siblings = parent[PS.childNodesList];
		const idx = siblings.indexOf(this);
		return idx !== -1 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
	}

	get textContent(): string | null {
		return null;
	}

	set textContent(_value: string | null) {
		// Override in subclasses
	}

	get nodeValue(): string | null {
		return null;
	}

	set nodeValue(_value: string | null) {
		// Override in subclasses
	}

	get ownerDocument(): any {
		// Lazy reference to avoid circular dependency (Document extends Node).
		// globalThis.document is set by @gjsify/dom-elements on import.
		return (globalThis as any).document ?? null;
	}

	get isConnected(): boolean {
		return this[PS.isConnected];
	}

	hasChildNodes(): boolean {
		return this[PS.childNodesList].length > 0;
	}

	contains(other: Node | null): boolean {
		if (other === null) return false;
		if (other === this) return true;
		let node: Node | null = other;
		while (node) {
			if (node === this) return true;
			node = node[PS.parentNode];
		}
		return false;
	}

	getRootNode(): Node {
		let node: Node = this;
		while (node[PS.parentNode]) {
			node = node[PS.parentNode]!;
		}
		return node;
	}

	appendChild(node: Node): Node {
		// Remove from previous parent
		if (node[PS.parentNode]) {
			node[PS.parentNode]!.removeChild(node);
		}

		node[PS.parentNode] = this;
		this[PS.childNodesList].push(node);

		// Track element children
		if (node[PS.nodeType] === NodeType.ELEMENT_NODE) {
			this[PS.elementChildren].push(node);
		}

		return node;
	}

	removeChild(node: Node): Node {
		const children = this[PS.childNodesList];
		const idx = children.indexOf(node);
		if (idx === -1) {
			throw new DOMException(
				"Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
				'NotFoundError',
			);
		}

		children.splice(idx, 1);
		node[PS.parentNode] = null;

		// Remove from element children
		if (node[PS.nodeType] === NodeType.ELEMENT_NODE) {
			const elemIdx = this[PS.elementChildren].indexOf(node);
			if (elemIdx !== -1) {
				this[PS.elementChildren].splice(elemIdx, 1);
			}
		}

		return node;
	}

	insertBefore(newNode: Node, referenceNode: Node | null): Node {
		if (referenceNode === null) {
			return this.appendChild(newNode);
		}

		const children = this[PS.childNodesList];
		const refIdx = children.indexOf(referenceNode);
		if (refIdx === -1) {
			throw new DOMException(
				"Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
				'NotFoundError',
			);
		}

		// Remove from previous parent
		if (newNode[PS.parentNode]) {
			newNode[PS.parentNode]!.removeChild(newNode);
		}

		newNode[PS.parentNode] = this;
		children.splice(refIdx, 0, newNode);

		// Track element children
		if (newNode[PS.nodeType] === NodeType.ELEMENT_NODE) {
			// Find correct position in element children
			const elemChildren = this[PS.elementChildren];
			let elemIdx = elemChildren.length;
			for (let i = refIdx; i < children.length; i++) {
				if (children[i][PS.nodeType] === NodeType.ELEMENT_NODE && children[i] !== newNode) {
					elemIdx = elemChildren.indexOf(children[i]);
					break;
				}
			}
			elemChildren.splice(elemIdx, 0, newNode);
		}

		return newNode;
	}

	replaceChild(newChild: Node, oldChild: Node): Node {
		this.insertBefore(newChild, oldChild);
		this.removeChild(oldChild);
		return oldChild;
	}

	cloneNode(deep = false): Node {
		const clone = new (this.constructor as new () => Node)();
		clone[PS.nodeType] = this[PS.nodeType];

		if (deep) {
			for (const child of this[PS.childNodesList]) {
				clone.appendChild(child.cloneNode(true));
			}
		}

		return clone;
	}

	/**
	 * Override dispatchEvent to support event bubbling through the DOM tree.
	 * After AT_TARGET phase, if event.bubbles is true, walk up the parentNode
	 * chain and dispatch on each ancestor (BUBBLING_PHASE).
	 */
	override dispatchEvent(event: DOMEvent): boolean {
		const result = super.dispatchEvent(event);

		// Bubble up the DOM tree
		if (event.bubbles && !event.cancelBubble) {
			let parent = this[PS.parentNode];
			while (parent) {
				// Dispatch on parent using EventTarget.dispatchEvent (no recursion)
				// We call the base class method to avoid infinite bubbling loops
				Object.getPrototypeOf(Node.prototype).dispatchEvent.call(parent, event);
				if (event.cancelBubble) break;
				parent = parent[PS.parentNode];
			}
		}

		return result;
	}

	get [Symbol.toStringTag](): string {
		return 'Node';
	}
}
