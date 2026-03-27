// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/nodes/character-data/CharacterData.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify — no ChildNode utilities, no mutation observer hooks

import { Node } from './node.js';
import { NodeType } from './node-type.js';
import * as PS from './property-symbol.js';

/**
 * CharacterData base class for Text and Comment nodes.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/CharacterData
 */
export class CharacterData extends Node {
	private _data: string;

	constructor(data = '') {
		super();
		this[PS.nodeType] = NodeType.TEXT_NODE;
		this._data = data;
	}

	get data(): string {
		return this._data;
	}

	set data(value: string) {
		this._data = value;
	}

	get textContent(): string {
		return this._data;
	}

	set textContent(value: string) {
		this._data = value;
	}

	get nodeValue(): string {
		return this._data;
	}

	set nodeValue(value: string) {
		this._data = value;
	}

	get length(): number {
		return this._data.length;
	}

	appendData(data: string): void {
		this._data += data;
	}

	deleteData(offset: number, count: number): void {
		this._data = this._data.substring(0, offset) + this._data.substring(offset + count);
	}

	insertData(offset: number, data: string): void {
		this._data = this._data.substring(0, offset) + data + this._data.substring(offset);
	}

	replaceData(offset: number, count: number, data: string): void {
		this._data = this._data.substring(0, offset) + data + this._data.substring(offset + count);
	}

	substringData(offset: number, count: number): string {
		return this._data.substring(offset, offset + count);
	}

	cloneNode(_deep = false): CharacterData {
		const clone = new (this.constructor as typeof CharacterData)(this._data);
		return clone;
	}

	get [Symbol.toStringTag](): string {
		return 'CharacterData';
	}
}
