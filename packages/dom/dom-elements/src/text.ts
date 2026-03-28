// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/nodes/text/Text.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify — no textarea/style hooks, no mutation observer

import { CharacterData } from './character-data.js';
import { NodeType } from './node-type.js';
import * as PS from './property-symbol.js';

/**
 * Text node.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/Text
 */
export class Text extends CharacterData {
	constructor(data = '') {
		super(data);
		this[PS.nodeType] = NodeType.TEXT_NODE;
	}

	get nodeName(): string {
		return '#text';
	}

	/**
	 * Returns the combined text of this node and all adjacent Text siblings.
	 */
	get wholeText(): string {
		let text = this.data;

		let prev = this.previousSibling;
		while (prev && prev instanceof Text) {
			text = prev.data + text;
			prev = prev.previousSibling;
		}

		let next = this.nextSibling;
		while (next && next instanceof Text) {
			text += next.data;
			next = next.nextSibling;
		}

		return text;
	}

	/**
	 * Splits the text node at the given offset, returning the new Text node
	 * containing the text after the offset.
	 */
	splitText(offset: number): Text {
		const newData = this.data.substring(offset);
		this.data = this.data.substring(0, offset);

		const newNode = new Text(newData);
		if (this.parentNode) {
			this.parentNode.insertBefore(newNode, this.nextSibling);
		}
		return newNode;
	}

	cloneNode(_deep = false): Text {
		return new Text(this.data);
	}

	get [Symbol.toStringTag](): string {
		return 'Text';
	}
}
