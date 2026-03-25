// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/nodes/node/NodeList.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify — minimal live array wrapper

import type { Node } from './node.js';

/**
 * Minimal NodeList backed by an external array.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/NodeList
 */
export class NodeList {
	private _items: Node[];

	constructor(items: Node[]) {
		this._items = items;
	}

	get length(): number {
		return this._items.length;
	}

	item(index: number): Node | null {
		return this._items[index] ?? null;
	}

	forEach(callback: (node: Node, index: number, list: NodeList) => void, thisArg?: unknown): void {
		for (let i = 0; i < this._items.length; i++) {
			callback.call(thisArg, this._items[i], i, this);
		}
	}

	entries(): IterableIterator<[number, Node]> {
		return this._items.entries();
	}

	keys(): IterableIterator<number> {
		return this._items.keys();
	}

	values(): IterableIterator<Node> {
		return this._items.values();
	}

	[Symbol.iterator](): IterableIterator<Node> {
		return this._items[Symbol.iterator]();
	}

	get [Symbol.toStringTag](): string {
		return 'NodeList';
	}
}
