// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/dom/DOMTokenList.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify — no Proxy, plain array-based implementation

import type { Element } from './element.js';

/**
 * DOMTokenList — manages a set of space-separated tokens on an attribute.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/DOMTokenList
 */
export class DOMTokenList {
	private _ownerElement: Element;
	private _attributeName: string;

	constructor(ownerElement: Element, attributeName: string) {
		this._ownerElement = ownerElement;
		this._attributeName = attributeName;
	}

	private _getTokens(): string[] {
		const value = this._ownerElement.getAttribute(this._attributeName);
		if (!value) return [];
		return value.split(/\s+/).filter(t => t.length > 0);
	}

	private _setTokens(tokens: string[]): void {
		const value = tokens.join(' ');
		if (value) {
			this._ownerElement.setAttribute(this._attributeName, value);
		} else {
			this._ownerElement.removeAttribute(this._attributeName);
		}
	}

	get length(): number {
		return this._getTokens().length;
	}

	get value(): string {
		return this._ownerElement.getAttribute(this._attributeName) ?? '';
	}

	set value(val: string) {
		if (val) {
			this._ownerElement.setAttribute(this._attributeName, val);
		} else {
			this._ownerElement.removeAttribute(this._attributeName);
		}
	}

	item(index: number): string | null {
		const tokens = this._getTokens();
		return index >= 0 && index < tokens.length ? tokens[index] : null;
	}

	contains(token: string): boolean {
		return this._getTokens().includes(token);
	}

	add(...tokens: string[]): void {
		const current = this._getTokens();
		for (const token of tokens) {
			if (token && !current.includes(token)) {
				current.push(token);
			}
		}
		this._setTokens(current);
	}

	remove(...tokens: string[]): void {
		const current = this._getTokens().filter(t => !tokens.includes(t));
		this._setTokens(current);
	}

	toggle(token: string, force?: boolean): boolean {
		const has = this.contains(token);
		if (force !== undefined) {
			if (force) {
				this.add(token);
				return true;
			} else {
				this.remove(token);
				return false;
			}
		}
		if (has) {
			this.remove(token);
			return false;
		} else {
			this.add(token);
			return true;
		}
	}

	replace(token: string, newToken: string): boolean {
		const tokens = this._getTokens();
		const idx = tokens.indexOf(token);
		if (idx === -1) return false;
		tokens[idx] = newToken;
		this._setTokens(tokens);
		return true;
	}

	supports(_token: string): boolean {
		// No validation — all tokens are supported
		return true;
	}

	forEach(callback: (value: string, index: number, list: DOMTokenList) => void): void {
		const tokens = this._getTokens();
		for (let i = 0; i < tokens.length; i++) {
			callback(tokens[i], i, this);
		}
	}

	keys(): IterableIterator<number> {
		return this._getTokens().keys();
	}

	values(): IterableIterator<string> {
		return this._getTokens().values();
	}

	entries(): IterableIterator<[number, string]> {
		return this._getTokens().entries();
	}

	[Symbol.iterator](): IterableIterator<string> {
		return this._getTokens().values();
	}

	toString(): string {
		return this.value;
	}

	get [Symbol.toStringTag](): string {
		return 'DOMTokenList';
	}
}
