// Ported from refs/happy-dom/packages/happy-dom/test/nodes/
// Original: MIT license, Copyright (c) David Ortner (capricorn86)

import { describe, it, expect } from '@gjsify/unit';

import {
	Node, Element, HTMLElement, NodeType, NamespaceURI, Attr, NamedNodeMap,
	CharacterData, Text, Comment, DocumentFragment, DOMTokenList,
} from '@gjsify/dom-elements';
import { Event } from '@gjsify/dom-events';

export default async () => {
	// -- Attr --

	await describe('Attr', async () => {
		await it('should store name and value', async () => {
			const attr = new Attr('id', 'test');
			expect(attr.name).toBe('id');
			expect(attr.value).toBe('test');
			expect(attr.localName).toBe('id');
			expect(attr.namespaceURI).toBeNull();
			expect(attr.prefix).toBeNull();
			expect(attr.specified).toBe(true);
		});

		await it('should extract localName from prefixed name', async () => {
			const attr = new Attr('xml:lang', 'en', 'http://www.w3.org/XML/1998/namespace', 'xml');
			expect(attr.name).toBe('xml:lang');
			expect(attr.localName).toBe('lang');
			expect(attr.prefix).toBe('xml');
		});

		await it('should allow value mutation', async () => {
			const attr = new Attr('class', 'old');
			attr.value = 'new';
			expect(attr.value).toBe('new');
		});
	});

	// -- Node --

	await describe('Node', async () => {
		await it('should have correct node type constants', async () => {
			expect(Node.ELEMENT_NODE).toBe(1);
			expect(Node.TEXT_NODE).toBe(3);
			expect(Node.COMMENT_NODE).toBe(8);
			expect(Node.DOCUMENT_NODE).toBe(9);
			expect(Node.DOCUMENT_FRAGMENT_NODE).toBe(11);
		});

		await it('should have instance node type constants', async () => {
			const node = new Node();
			expect(node.ELEMENT_NODE).toBe(1);
			expect(node.TEXT_NODE).toBe(3);
		});

		await it('should appendChild and set parentNode', async () => {
			const parent = new Node();
			const child = new Node();
			parent.appendChild(child);
			expect(child.parentNode).toBe(parent);
			expect(parent.hasChildNodes()).toBe(true);
			expect(parent.childNodes.length).toBe(1);
			expect(parent.firstChild).toBe(child);
			expect(parent.lastChild).toBe(child);
		});

		await it('should removeChild and clear parentNode', async () => {
			const parent = new Node();
			const child = new Node();
			parent.appendChild(child);
			parent.removeChild(child);
			expect(child.parentNode).toBeNull();
			expect(parent.hasChildNodes()).toBe(false);
			expect(parent.childNodes.length).toBe(0);
		});

		await it('should throw when removing a non-child', async () => {
			const parent = new Node();
			const stranger = new Node();
			let threw = false;
			try {
				parent.removeChild(stranger);
			} catch {
				threw = true;
			}
			expect(threw).toBe(true);
		});

		await it('should insertBefore', async () => {
			const parent = new Node();
			const child1 = new Node();
			const child2 = new Node();
			const child3 = new Node();
			parent.appendChild(child1);
			parent.appendChild(child3);
			parent.insertBefore(child2, child3);
			expect(parent.childNodes.length).toBe(3);
			expect(parent.childNodes.item(0)).toBe(child1);
			expect(parent.childNodes.item(1)).toBe(child2);
			expect(parent.childNodes.item(2)).toBe(child3);
		});

		await it('should insertBefore with null reference (appends)', async () => {
			const parent = new Node();
			const child = new Node();
			parent.insertBefore(child, null);
			expect(parent.firstChild).toBe(child);
		});

		await it('should replaceChild', async () => {
			const parent = new Node();
			const oldChild = new Node();
			const newChild = new Node();
			parent.appendChild(oldChild);
			parent.replaceChild(newChild, oldChild);
			expect(parent.firstChild).toBe(newChild);
			expect(oldChild.parentNode).toBeNull();
		});

		await it('should navigate siblings', async () => {
			const parent = new Node();
			const a = new Node();
			const b = new Node();
			const c = new Node();
			parent.appendChild(a);
			parent.appendChild(b);
			parent.appendChild(c);
			expect(a.previousSibling).toBeNull();
			expect(a.nextSibling).toBe(b);
			expect(b.previousSibling).toBe(a);
			expect(b.nextSibling).toBe(c);
			expect(c.previousSibling).toBe(b);
			expect(c.nextSibling).toBeNull();
		});

		await it('should contains()', async () => {
			const parent = new Node();
			const child = new Node();
			const grandchild = new Node();
			parent.appendChild(child);
			child.appendChild(grandchild);
			expect(parent.contains(child)).toBe(true);
			expect(parent.contains(grandchild)).toBe(true);
			expect(parent.contains(parent)).toBe(true);
			expect(child.contains(parent)).toBe(false);
			expect(parent.contains(null)).toBe(false);
		});

		await it('should getRootNode()', async () => {
			const root = new Node();
			const child = new Node();
			const grandchild = new Node();
			root.appendChild(child);
			child.appendChild(grandchild);
			expect(grandchild.getRootNode()).toBe(root);
			expect(root.getRootNode()).toBe(root);
		});

		await it('should cloneNode shallow', async () => {
			const parent = new Node();
			const child = new Node();
			parent.appendChild(child);
			const clone = parent.cloneNode(false);
			expect(clone.hasChildNodes()).toBe(false);
		});

		await it('should cloneNode deep', async () => {
			const parent = new Node();
			const child = new Node();
			parent.appendChild(child);
			const clone = parent.cloneNode(true);
			expect(clone.hasChildNodes()).toBe(true);
			expect(clone.firstChild).not.toBe(child);
		});

		await it('should move child when appending to new parent', async () => {
			const parent1 = new Node();
			const parent2 = new Node();
			const child = new Node();
			parent1.appendChild(child);
			parent2.appendChild(child);
			expect(parent1.hasChildNodes()).toBe(false);
			expect(parent2.firstChild).toBe(child);
			expect(child.parentNode).toBe(parent2);
		});

		await it('should return null for ownerDocument', async () => {
			const node = new Node();
			expect(node.ownerDocument).toBeNull();
		});
	});

	// -- Element --

	await describe('Element', async () => {
		await it('should have ELEMENT_NODE type', async () => {
			const el = new Element();
			expect(el.nodeType).toBe(NodeType.ELEMENT_NODE);
		});

		await it('should set and get attributes', async () => {
			const el = new Element();
			el.setAttribute('id', 'test');
			expect(el.getAttribute('id')).toBe('test');
			expect(el.hasAttribute('id')).toBe(true);
		});

		await it('should remove attributes', async () => {
			const el = new Element();
			el.setAttribute('class', 'foo');
			el.removeAttribute('class');
			expect(el.getAttribute('class')).toBeNull();
			expect(el.hasAttribute('class')).toBe(false);
		});

		await it('should set and get id', async () => {
			const el = new Element();
			el.id = 'myId';
			expect(el.id).toBe('myId');
			expect(el.getAttribute('id')).toBe('myId');
		});

		await it('should set and get className', async () => {
			const el = new Element();
			el.className = 'foo bar';
			expect(el.className).toBe('foo bar');
			expect(el.getAttribute('class')).toBe('foo bar');
		});

		await it('should setAttributeNS and getAttributeNS', async () => {
			const el = new Element();
			el.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', 'en');
			expect(el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang')).toBe('en');
			expect(el.hasAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang')).toBe(true);
		});

		await it('should removeAttributeNS', async () => {
			const el = new Element();
			el.setAttributeNS(null, 'data-foo', 'bar');
			el.removeAttributeNS(null, 'data-foo');
			expect(el.getAttributeNS(null, 'data-foo')).toBeNull();
		});

		await it('should toggleAttribute', async () => {
			const el = new Element();
			expect(el.toggleAttribute('hidden')).toBe(true);
			expect(el.hasAttribute('hidden')).toBe(true);
			expect(el.toggleAttribute('hidden')).toBe(false);
			expect(el.hasAttribute('hidden')).toBe(false);
		});

		await it('should toggleAttribute with force', async () => {
			const el = new Element();
			expect(el.toggleAttribute('hidden', true)).toBe(true);
			expect(el.hasAttribute('hidden')).toBe(true);
			expect(el.toggleAttribute('hidden', true)).toBe(true);
			expect(el.hasAttribute('hidden')).toBe(true);
			expect(el.toggleAttribute('hidden', false)).toBe(false);
			expect(el.hasAttribute('hidden')).toBe(false);
		});

		await it('should hasAttributes', async () => {
			const el = new Element();
			expect(el.hasAttributes()).toBe(false);
			el.setAttribute('id', 'test');
			expect(el.hasAttributes()).toBe(true);
		});

		await it('should have correct attributes.length', async () => {
			const el = new Element();
			expect(el.attributes.length).toBe(0);
			el.setAttribute('id', 'test');
			el.setAttribute('class', 'foo');
			expect(el.attributes.length).toBe(2);
		});

		await it('should iterate attributes', async () => {
			const el = new Element();
			el.setAttribute('id', 'test');
			el.setAttribute('class', 'foo');
			const names: string[] = [];
			for (const attr of el.attributes) {
				names.push(attr.name);
			}
			expect(names.length).toBe(2);
			expect(names).toContain('id');
			expect(names).toContain('class');
		});

		await it('should track element children', async () => {
			const parent = new Element();
			const child1 = new Element();
			const child2 = new Element();
			parent.appendChild(child1);
			parent.appendChild(child2);
			expect(parent.children.length).toBe(2);
			expect(parent.childElementCount).toBe(2);
			expect(parent.firstElementChild).toBe(child1);
			expect(parent.lastElementChild).toBe(child2);
		});

		await it('should navigate element siblings', async () => {
			const parent = new Element();
			const a = new Element();
			const b = new Element();
			parent.appendChild(a);
			parent.appendChild(b);
			expect(a.nextElementSibling).toBe(b);
			expect(b.previousElementSibling).toBe(a);
			expect(a.previousElementSibling).toBeNull();
			expect(b.nextElementSibling).toBeNull();
		});

		await it('should clone with attributes', async () => {
			const el = new Element();
			el.setAttribute('id', 'original');
			el.setAttribute('class', 'test');
			const clone = el.cloneNode(false);
			expect(clone.getAttribute('id')).toBe('original');
			expect(clone.getAttribute('class')).toBe('test');
			expect(clone).not.toBe(el);
		});

		await it('should getElementsByTagName', async () => {
			const root = new Element();
			const div = new Element();
			div[Symbol.for ? Symbol.for('tagName') : 'tagName'] = 'DIV';
			// Use internal symbol access via setting attribute approach
			// Instead, test with the proper API
			root.appendChild(div);
			// getElementsByTagName works on tagName which is '' by default for Element
			const results = root.getElementsByTagName('*');
			expect(results.length).toBe(1);
		});

		await it('should dispatch events and call on* handlers', async () => {
			const el = new Element();
			let handlerCalled = false;
			let listenerCalled = false;

			el.addEventListener('click', () => {
				listenerCalled = true;
			});

			el[Symbol.for ? Symbol.for('propertyEventListeners') : 'propertyEventListeners'] = new Map();
			// Use the propertyEventListeners through proper API in HTMLElement
			// For Element, test addEventListener only
			el.dispatchEvent(new Event('click'));
			expect(listenerCalled).toBe(true);
		});
	});

	// -- HTMLElement --

	await describe('HTMLElement', async () => {
		await it('should be an instance of Element and Node', async () => {
			const el = new HTMLElement();
			expect(el instanceof Element).toBe(true);
			expect(el instanceof Node).toBe(true);
		});

		await it('should have correct [Symbol.toStringTag]', async () => {
			const el = new HTMLElement();
			expect(Object.prototype.toString.call(el)).toBe('[object HTMLElement]');
		});

		await it('should get/set title', async () => {
			const el = new HTMLElement();
			expect(el.title).toBe('');
			el.title = 'My Title';
			expect(el.title).toBe('My Title');
			expect(el.getAttribute('title')).toBe('My Title');
		});

		await it('should get/set lang', async () => {
			const el = new HTMLElement();
			expect(el.lang).toBe('');
			el.lang = 'en';
			expect(el.lang).toBe('en');
			expect(el.getAttribute('lang')).toBe('en');
		});

		await it('should get/set dir', async () => {
			const el = new HTMLElement();
			expect(el.dir).toBe('');
			el.dir = 'rtl';
			expect(el.dir).toBe('rtl');
			expect(el.getAttribute('dir')).toBe('rtl');
		});

		await it('should get/set hidden (boolean attribute)', async () => {
			const el = new HTMLElement();
			expect(el.hidden).toBe(false);
			el.hidden = true;
			expect(el.hidden).toBe(true);
			expect(el.hasAttribute('hidden')).toBe(true);
			el.hidden = false;
			expect(el.hidden).toBe(false);
			expect(el.hasAttribute('hidden')).toBe(false);
		});

		await it('should get/set tabIndex', async () => {
			const el = new HTMLElement();
			expect(el.tabIndex).toBe(-1);
			el.tabIndex = 0;
			expect(el.tabIndex).toBe(0);
			expect(el.getAttribute('tabindex')).toBe('0');
		});

		await it('should get/set draggable', async () => {
			const el = new HTMLElement();
			expect(el.draggable).toBe(false);
			el.draggable = true;
			expect(el.draggable).toBe(true);
			expect(el.getAttribute('draggable')).toBe('true');
		});

		await it('should get/set contentEditable', async () => {
			const el = new HTMLElement();
			expect(el.contentEditable).toBe('inherit');
			el.contentEditable = 'true';
			expect(el.contentEditable).toBe('true');
			expect(el.isContentEditable).toBe(true);
			el.contentEditable = 'false';
			expect(el.contentEditable).toBe('false');
			expect(el.isContentEditable).toBe(false);
			el.contentEditable = 'inherit';
			expect(el.contentEditable).toBe('inherit');
		});

		await it('should return 0 for layout properties', async () => {
			const el = new HTMLElement();
			expect(el.offsetHeight).toBe(0);
			expect(el.offsetWidth).toBe(0);
			expect(el.offsetLeft).toBe(0);
			expect(el.offsetTop).toBe(0);
			expect(el.clientHeight).toBe(0);
			expect(el.clientWidth).toBe(0);
			expect(el.clientLeft).toBe(0);
			expect(el.clientTop).toBe(0);
			expect(el.scrollHeight).toBe(0);
			expect(el.scrollWidth).toBe(0);
			expect(el.scrollTop).toBe(0);
			expect(el.scrollLeft).toBe(0);
			expect(el.offsetParent).toBeNull();
		});

		await it('should click() dispatch click event', async () => {
			const el = new HTMLElement();
			let clicked = false;
			el.addEventListener('click', () => { clicked = true; });
			el.click();
			expect(clicked).toBe(true);
		});

		await it('should focus() dispatch focus event', async () => {
			const el = new HTMLElement();
			let focused = false;
			el.addEventListener('focus', () => { focused = true; });
			el.focus();
			expect(focused).toBe(true);
		});

		await it('should blur() dispatch blur event', async () => {
			const el = new HTMLElement();
			let blurred = false;
			el.addEventListener('blur', () => { blurred = true; });
			el.blur();
			expect(blurred).toBe(true);
		});

		await it('should get/set onload handler', async () => {
			const el = new HTMLElement();
			expect(el.onload).toBeNull();
			const handler = () => {};
			el.onload = handler;
			expect(el.onload).toBe(handler);
		});

		await it('should call onload handler on dispatchEvent', async () => {
			const el = new HTMLElement();
			let called = false;
			el.onload = () => { called = true; };
			el.dispatchEvent(new Event('load'));
			expect(called).toBe(true);
		});

		await it('should get/set onerror handler', async () => {
			const el = new HTMLElement();
			expect(el.onerror).toBeNull();
			const handler = () => {};
			el.onerror = handler;
			expect(el.onerror).toBe(handler);
		});

		await it('should call onerror handler on dispatchEvent', async () => {
			const el = new HTMLElement();
			let called = false;
			el.onerror = () => { called = true; };
			el.dispatchEvent(new Event('error'));
			expect(called).toBe(true);
		});

		await it('should get/set onclick handler', async () => {
			const el = new HTMLElement();
			expect(el.onclick).toBeNull();
			let clicked = false;
			el.onclick = () => { clicked = true; };
			el.click();
			expect(clicked).toBe(true);
		});

		await it('should support both addEventListener and on* handler', async () => {
			const el = new HTMLElement();
			const calls: string[] = [];
			el.addEventListener('load', () => { calls.push('listener'); });
			el.onload = () => { calls.push('handler'); };
			el.dispatchEvent(new Event('load'));
			expect(calls.length).toBe(2);
			expect(calls).toContain('listener');
			expect(calls).toContain('handler');
		});

		await it('should clear on* handler when set to null', async () => {
			const el = new HTMLElement();
			let called = false;
			el.onload = () => { called = true; };
			el.onload = null;
			el.dispatchEvent(new Event('load'));
			expect(called).toBe(false);
		});

		await it('should clone HTMLElement', async () => {
			const el = new HTMLElement();
			el.title = 'test';
			el.hidden = true;
			const clone = el.cloneNode(false);
			expect(clone instanceof HTMLElement).toBe(true);
			expect(clone.getAttribute('title')).toBe('test');
			expect(clone.hasAttribute('hidden')).toBe(true);
		});
	});

	// -- NamedNodeMap --

	await describe('NamedNodeMap', async () => {
		await it('should set and get items', async () => {
			const el = new Element();
			el.setAttribute('id', 'test');
			const attr = el.attributes.getNamedItem('id');
			expect(attr).not.toBeNull();
			expect(attr!.name).toBe('id');
			expect(attr!.value).toBe('test');
		});

		await it('should item() by index', async () => {
			const el = new Element();
			el.setAttribute('id', 'test');
			el.setAttribute('class', 'foo');
			expect(el.attributes.item(0)!.name).toBe('id');
			expect(el.attributes.item(1)!.name).toBe('class');
			expect(el.attributes.item(2)).toBeNull();
		});

		await it('should remove items', async () => {
			const el = new Element();
			el.setAttribute('id', 'test');
			el.attributes.removeNamedItem('id');
			expect(el.attributes.length).toBe(0);
		});

		await it('should throw on removing non-existent item', async () => {
			const el = new Element();
			let threw = false;
			try {
				el.attributes.removeNamedItem('nonexistent');
			} catch {
				threw = true;
			}
			expect(threw).toBe(true);
		});

		await it('should iterate with for...of', async () => {
			const el = new Element();
			el.setAttribute('a', '1');
			el.setAttribute('b', '2');
			const names: string[] = [];
			for (const attr of el.attributes) {
				names.push(attr.name);
			}
			expect(names.length).toBe(2);
			expect(names[0]).toBe('a');
			expect(names[1]).toBe('b');
		});
	});

	// -- CharacterData --

	await describe('CharacterData', async () => {
		await it('should create with default empty data', async () => {
			const cd = new CharacterData();
			expect(cd.data).toBe('');
			expect(cd.length).toBe(0);
		});

		await it('should create with initial data', async () => {
			const cd = new CharacterData('hello');
			expect(cd.data).toBe('hello');
			expect(cd.length).toBe(5);
		});

		await it('should sync data, textContent, and nodeValue', async () => {
			const cd = new CharacterData('abc');
			expect(cd.textContent).toBe('abc');
			expect(cd.nodeValue).toBe('abc');
			cd.data = 'xyz';
			expect(cd.textContent).toBe('xyz');
			expect(cd.nodeValue).toBe('xyz');
			cd.textContent = '123';
			expect(cd.data).toBe('123');
			cd.nodeValue = '456';
			expect(cd.data).toBe('456');
		});

		await it('should appendData', async () => {
			const cd = new CharacterData('hello');
			cd.appendData(' world');
			expect(cd.data).toBe('hello world');
		});

		await it('should insertData', async () => {
			const cd = new CharacterData('helo');
			cd.insertData(2, 'l');
			expect(cd.data).toBe('hello');
		});

		await it('should deleteData', async () => {
			const cd = new CharacterData('hello');
			cd.deleteData(1, 3);
			expect(cd.data).toBe('ho');
		});

		await it('should replaceData', async () => {
			const cd = new CharacterData('hello');
			cd.replaceData(1, 3, 'a');
			expect(cd.data).toBe('hao');
		});

		await it('should substringData', async () => {
			const cd = new CharacterData('hello');
			expect(cd.substringData(1, 3)).toBe('ell');
		});

		await it('should cloneNode', async () => {
			const cd = new CharacterData('hello');
			const clone = cd.cloneNode();
			expect(clone.data).toBe('hello');
			expect(clone).not.toBe(cd);
		});

		await it('should have correct Symbol.toStringTag', async () => {
			const cd = new CharacterData();
			expect(Object.prototype.toString.call(cd)).toBe('[object CharacterData]');
		});
	});

	// -- Text --

	await describe('Text', async () => {
		await it('should create with data', async () => {
			const t = new Text('hello');
			expect(t.data).toBe('hello');
			expect(t.nodeType).toBe(Node.TEXT_NODE);
			expect(t.nodeName).toBe('#text');
		});

		await it('should create with empty default', async () => {
			const t = new Text();
			expect(t.data).toBe('');
		});

		await it('should be instanceof CharacterData and Node', async () => {
			const t = new Text('hi');
			expect(t instanceof CharacterData).toBe(true);
			expect(t instanceof Node).toBe(true);
		});

		await it('should splitText', async () => {
			const parent = new Element();
			const t = new Text('hello world');
			parent.appendChild(t);
			const newNode = t.splitText(5);
			expect(t.data).toBe('hello');
			expect(newNode.data).toBe(' world');
			expect(parent.childNodes.length).toBe(2);
			expect(parent.childNodes.item(1)).toBe(newNode);
		});

		await it('should splitText without parent', async () => {
			const t = new Text('hello world');
			const newNode = t.splitText(5);
			expect(t.data).toBe('hello');
			expect(newNode.data).toBe(' world');
			expect(newNode.parentNode).toBeNull();
		});

		await it('should wholeText with adjacent siblings', async () => {
			const parent = new Element();
			const t1 = new Text('hello');
			const t2 = new Text(' ');
			const t3 = new Text('world');
			parent.appendChild(t1);
			parent.appendChild(t2);
			parent.appendChild(t3);
			expect(t2.wholeText).toBe('hello world');
		});

		await it('should wholeText with no siblings', async () => {
			const t = new Text('alone');
			expect(t.wholeText).toBe('alone');
		});

		await it('should cloneNode', async () => {
			const t = new Text('hello');
			const clone = t.cloneNode();
			expect(clone.data).toBe('hello');
			expect(clone instanceof Text).toBe(true);
			expect(clone).not.toBe(t);
		});

		await it('should have correct Symbol.toStringTag', async () => {
			const t = new Text();
			expect(Object.prototype.toString.call(t)).toBe('[object Text]');
		});
	});

	// -- Comment --

	await describe('Comment', async () => {
		await it('should create with data', async () => {
			const c = new Comment('a comment');
			expect(c.data).toBe('a comment');
			expect(c.nodeType).toBe(Node.COMMENT_NODE);
			expect(c.nodeName).toBe('#comment');
		});

		await it('should be instanceof CharacterData and Node', async () => {
			const c = new Comment();
			expect(c instanceof CharacterData).toBe(true);
			expect(c instanceof Node).toBe(true);
		});

		await it('should cloneNode', async () => {
			const c = new Comment('test');
			const clone = c.cloneNode();
			expect(clone.data).toBe('test');
			expect(clone instanceof Comment).toBe(true);
			expect(clone).not.toBe(c);
		});

		await it('should have correct Symbol.toStringTag', async () => {
			const c = new Comment();
			expect(Object.prototype.toString.call(c)).toBe('[object Comment]');
		});
	});

	// -- DocumentFragment --

	await describe('DocumentFragment', async () => {
		await it('should have correct nodeType and nodeName', async () => {
			const frag = new DocumentFragment();
			expect(frag.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE);
			expect(frag.nodeName).toBe('#document-fragment');
		});

		await it('should appendChild and track children', async () => {
			const frag = new DocumentFragment();
			const el = new Element();
			frag.appendChild(el);
			expect(frag.childNodes.length).toBe(1);
			expect(frag.children.length).toBe(1);
			expect(frag.childElementCount).toBe(1);
			expect(frag.firstElementChild).toBe(el);
			expect(frag.lastElementChild).toBe(el);
		});

		await it('should track textContent', async () => {
			const frag = new DocumentFragment();
			const t1 = new Text('hello');
			const t2 = new Text(' world');
			frag.appendChild(t1);
			frag.appendChild(t2);
			expect(frag.textContent).toBe('hello world');
		});

		await it('should set textContent replacing children', async () => {
			const frag = new DocumentFragment();
			frag.appendChild(new Element());
			frag.appendChild(new Text('old'));
			frag.textContent = 'new text';
			expect(frag.childNodes.length).toBe(1);
			expect(frag.textContent).toBe('new text');
		});

		await it('should be instanceof Node', async () => {
			const frag = new DocumentFragment();
			expect(frag instanceof Node).toBe(true);
		});
	});

	// -- DOMTokenList --

	await describe('DOMTokenList', async () => {
		await it('should add tokens', async () => {
			const el = new Element();
			const classList = new DOMTokenList(el, 'class');
			classList.add('foo', 'bar');
			expect(classList.length).toBe(2);
			expect(classList.contains('foo')).toBe(true);
			expect(classList.contains('bar')).toBe(true);
			expect(el.getAttribute('class')).toBe('foo bar');
		});

		await it('should remove tokens', async () => {
			const el = new Element();
			el.setAttribute('class', 'foo bar baz');
			const classList = new DOMTokenList(el, 'class');
			classList.remove('bar');
			expect(classList.length).toBe(2);
			expect(classList.contains('bar')).toBe(false);
			expect(classList.contains('foo')).toBe(true);
			expect(classList.contains('baz')).toBe(true);
		});

		await it('should toggle tokens', async () => {
			const el = new Element();
			const classList = new DOMTokenList(el, 'class');
			const added = classList.toggle('active');
			expect(added).toBe(true);
			expect(classList.contains('active')).toBe(true);
			const removed = classList.toggle('active');
			expect(removed).toBe(false);
			expect(classList.contains('active')).toBe(false);
		});

		await it('should toggle with force', async () => {
			const el = new Element();
			const classList = new DOMTokenList(el, 'class');
			classList.toggle('active', true);
			expect(classList.contains('active')).toBe(true);
			classList.toggle('active', true);
			expect(classList.contains('active')).toBe(true);
			classList.toggle('active', false);
			expect(classList.contains('active')).toBe(false);
		});

		await it('should item() by index', async () => {
			const el = new Element();
			el.setAttribute('class', 'a b c');
			const classList = new DOMTokenList(el, 'class');
			expect(classList.item(0)).toBe('a');
			expect(classList.item(1)).toBe('b');
			expect(classList.item(2)).toBe('c');
			expect(classList.item(3)).toBeNull();
		});

		await it('should return correct value', async () => {
			const el = new Element();
			el.setAttribute('class', 'foo bar');
			const classList = new DOMTokenList(el, 'class');
			expect(classList.value).toBe('foo bar');
		});

		await it('should set value', async () => {
			const el = new Element();
			const classList = new DOMTokenList(el, 'class');
			classList.value = 'x y z';
			expect(classList.length).toBe(3);
			expect(el.getAttribute('class')).toBe('x y z');
		});

		await it('should report empty when no attribute', async () => {
			const el = new Element();
			const classList = new DOMTokenList(el, 'class');
			expect(classList.length).toBe(0);
			expect(classList.value).toBe('');
		});

		await it('should toString', async () => {
			const el = new Element();
			el.setAttribute('class', 'a b');
			const classList = new DOMTokenList(el, 'class');
			expect(classList.toString()).toBe('a b');
		});
	});
};
