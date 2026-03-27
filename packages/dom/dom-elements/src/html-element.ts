// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/nodes/html-element/HTMLElement.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify — no CSSStyleDeclaration, no dataset/DOMStringMap,
//   no innerText/outerText, no custom element lifecycle, minimal on* handlers

import { Event } from '@gjsify/dom-events';

import { Element } from './element.js';
import * as PS from './property-symbol.js';

/**
 * HTML Element base class.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
 */
export class HTMLElement extends Element {
	// -- Attribute-backed string properties --

	get title(): string {
		return this.getAttribute('title') ?? '';
	}

	set title(value: string) {
		this.setAttribute('title', value);
	}

	get lang(): string {
		return this.getAttribute('lang') ?? '';
	}

	set lang(value: string) {
		this.setAttribute('lang', value);
	}

	get dir(): string {
		return this.getAttribute('dir') ?? '';
	}

	set dir(value: string) {
		this.setAttribute('dir', value);
	}

	get accessKey(): string {
		return this.getAttribute('accesskey') ?? '';
	}

	set accessKey(value: string) {
		this.setAttribute('accesskey', value);
	}

	get accessKeyLabel(): string {
		return this.getAttribute('accesskey') ?? '';
	}

	// -- Attribute-backed boolean properties --

	get hidden(): boolean {
		return this.hasAttribute('hidden');
	}

	set hidden(value: boolean) {
		if (value) {
			this.setAttribute('hidden', '');
		} else {
			this.removeAttribute('hidden');
		}
	}

	get draggable(): boolean {
		return this.getAttribute('draggable') === 'true';
	}

	set draggable(value: boolean) {
		this.setAttribute('draggable', String(value));
	}

	get spellcheck(): boolean {
		const attr = this.getAttribute('spellcheck');
		if (attr === 'false') return false;
		return attr !== null;
	}

	set spellcheck(value: boolean) {
		this.setAttribute('spellcheck', String(value));
	}

	get translate(): boolean {
		const attr = this.getAttribute('translate');
		return attr !== 'no';
	}

	set translate(value: boolean) {
		this.setAttribute('translate', value ? 'yes' : 'no');
	}

	// -- Attribute-backed numeric properties --

	get tabIndex(): number {
		const attr = this.getAttribute('tabindex');
		return attr !== null ? Number(attr) : -1;
	}

	set tabIndex(value: number) {
		this.setAttribute('tabindex', String(value));
	}

	// -- Content editable --

	get contentEditable(): string {
		const attr = this.getAttribute('contenteditable');
		if (attr === '' || attr === 'true') return 'true';
		if (attr === 'false') return 'false';
		return 'inherit';
	}

	set contentEditable(value: string) {
		if (value === 'inherit') {
			this.removeAttribute('contenteditable');
		} else {
			this.setAttribute('contenteditable', value);
		}
	}

	get isContentEditable(): boolean {
		return this.contentEditable === 'true';
	}

	// -- Layout stubs (return 0 — no layout engine) --

	get offsetHeight(): number { return 0; }
	get offsetWidth(): number { return 0; }
	get offsetLeft(): number { return 0; }
	get offsetTop(): number { return 0; }
	get offsetParent(): Element | null { return null; }
	get clientHeight(): number { return 0; }
	get clientWidth(): number { return 0; }
	get clientLeft(): number { return 0; }
	get clientTop(): number { return 0; }
	get scrollHeight(): number { return 0; }
	get scrollWidth(): number { return 0; }
	get scrollTop(): number { return 0; }
	set scrollTop(_value: number) { /* no layout engine */ }
	get scrollLeft(): number { return 0; }
	set scrollLeft(_value: number) { /* no layout engine */ }

	// -- Interaction methods --

	click(): void {
		this.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
	}

	blur(): void {
		this.dispatchEvent(new Event('blur'));
	}

	focus(): void {
		this.dispatchEvent(new Event('focus'));
	}

	// -- on* event handler properties --
	// Following happy-dom pattern: stored in propertyEventListeners Map,
	// dispatched automatically by Element.dispatchEvent override

	get onclick(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onclick') ?? null;
	}

	set onclick(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onclick', value);
	}

	get ondblclick(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('ondblclick') ?? null;
	}

	set ondblclick(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('ondblclick', value);
	}

	get onload(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onload') ?? null;
	}

	set onload(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onload', value);
	}

	get onerror(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onerror') ?? null;
	}

	set onerror(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onerror', value);
	}

	get onabort(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onabort') ?? null;
	}

	set onabort(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onabort', value);
	}

	get onfocus(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onfocus') ?? null;
	}

	set onfocus(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onfocus', value);
	}

	get onblur(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onblur') ?? null;
	}

	set onblur(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onblur', value);
	}

	get onchange(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onchange') ?? null;
	}

	set onchange(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onchange', value);
	}

	get oninput(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('oninput') ?? null;
	}

	set oninput(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('oninput', value);
	}

	get onsubmit(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onsubmit') ?? null;
	}

	set onsubmit(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onsubmit', value);
	}

	get onreset(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onreset') ?? null;
	}

	set onreset(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onreset', value);
	}

	get onscroll(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onscroll') ?? null;
	}

	set onscroll(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onscroll', value);
	}

	get onresize(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onresize') ?? null;
	}

	set onresize(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onresize', value);
	}

	// Mouse events
	get onmousedown(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onmousedown') ?? null;
	}

	set onmousedown(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onmousedown', value);
	}

	get onmouseup(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onmouseup') ?? null;
	}

	set onmouseup(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onmouseup', value);
	}

	get onmousemove(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onmousemove') ?? null;
	}

	set onmousemove(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onmousemove', value);
	}

	get onmouseover(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onmouseover') ?? null;
	}

	set onmouseover(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onmouseover', value);
	}

	get onmouseout(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onmouseout') ?? null;
	}

	set onmouseout(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onmouseout', value);
	}

	get onmouseenter(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onmouseenter') ?? null;
	}

	set onmouseenter(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onmouseenter', value);
	}

	get onmouseleave(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onmouseleave') ?? null;
	}

	set onmouseleave(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onmouseleave', value);
	}

	get oncontextmenu(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('oncontextmenu') ?? null;
	}

	set oncontextmenu(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('oncontextmenu', value);
	}

	// Keyboard events
	get onkeydown(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onkeydown') ?? null;
	}

	set onkeydown(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onkeydown', value);
	}

	get onkeyup(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onkeyup') ?? null;
	}

	set onkeyup(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onkeyup', value);
	}

	// Touch events
	get ontouchstart(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('ontouchstart') ?? null;
	}

	set ontouchstart(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('ontouchstart', value);
	}

	get ontouchend(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('ontouchend') ?? null;
	}

	set ontouchend(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('ontouchend', value);
	}

	get ontouchmove(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('ontouchmove') ?? null;
	}

	set ontouchmove(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('ontouchmove', value);
	}

	// Pointer events
	get onpointerdown(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onpointerdown') ?? null;
	}

	set onpointerdown(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onpointerdown', value);
	}

	get onpointerup(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onpointerup') ?? null;
	}

	set onpointerup(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onpointerup', value);
	}

	get onpointermove(): ((event: Event) => void) | null {
		return this[PS.propertyEventListeners].get('onpointermove') ?? null;
	}

	set onpointermove(value: ((event: Event) => void) | null) {
		this[PS.propertyEventListeners].set('onpointermove', value);
	}

	// -- Clone --

	cloneNode(deep = false): HTMLElement {
		return super.cloneNode(deep) as HTMLElement;
	}

	get [Symbol.toStringTag](): string {
		return 'HTMLElement';
	}
}
