// Browser unit tests for @gjsify/dom-elements APIs.
// Tests native browser globals to validate that the browser behaves the way
// our GJS implementation assumes. Do NOT import @gjsify/* — that would drag in
// @girs/* / gi:// GObject bindings that have no browser equivalent.

import { run, describe, it, expect } from '@gjsify/unit';

run({
    async DomElementsTest() {

        // -- Node constants --

        await describe('Node constants', async () => {
            await it('static constants are correct', async () => {
                expect(Node.ELEMENT_NODE).toBe(1);
                expect(Node.TEXT_NODE).toBe(3);
                expect(Node.COMMENT_NODE).toBe(8);
                expect(Node.DOCUMENT_NODE).toBe(9);
                expect(Node.DOCUMENT_FRAGMENT_NODE).toBe(11);
            });

            await it('instance constants match static', async () => {
                const el = document.createElement('div');
                expect(el.ELEMENT_NODE).toBe(1);
                expect(el.TEXT_NODE).toBe(3);
                expect(el.nodeType).toBe(Node.ELEMENT_NODE);
            });
        });

        // -- Node tree operations --

        await describe('Node tree ops', async () => {
            await it('appendChild sets parentNode and childNodes', async () => {
                const parent = document.createElement('div');
                const child = document.createElement('span');
                parent.appendChild(child);
                expect(child.parentNode).toBe(parent);
                expect(parent.hasChildNodes()).toBe(true);
                expect(parent.childNodes.length).toBe(1);
                expect(parent.firstChild).toBe(child);
                expect(parent.lastChild).toBe(child);
            });

            await it('removeChild clears parentNode', async () => {
                const parent = document.createElement('div');
                const child = document.createElement('span');
                parent.appendChild(child);
                parent.removeChild(child);
                expect(child.parentNode).toBeNull();
                expect(parent.hasChildNodes()).toBe(false);
            });

            await it('insertBefore inserts at correct position', async () => {
                const parent = document.createElement('div');
                const a = document.createElement('b');
                const b = document.createElement('i');
                const c = document.createElement('u');
                parent.appendChild(a);
                parent.appendChild(c);
                parent.insertBefore(b, c);
                expect(parent.childNodes.length).toBe(3);
                expect(parent.childNodes.item(0)).toBe(a);
                expect(parent.childNodes.item(1)).toBe(b);
                expect(parent.childNodes.item(2)).toBe(c);
            });

            await it('insertBefore with null appends', async () => {
                const parent = document.createElement('div');
                const child = document.createElement('span');
                parent.insertBefore(child, null);
                expect(parent.firstChild).toBe(child);
            });

            await it('replaceChild swaps nodes', async () => {
                const parent = document.createElement('div');
                const old = document.createElement('span');
                const neo = document.createElement('b');
                parent.appendChild(old);
                parent.replaceChild(neo, old);
                expect(parent.firstChild).toBe(neo);
                expect(old.parentNode).toBeNull();
            });

            await it('sibling navigation works', async () => {
                const parent = document.createElement('div');
                const a = document.createElement('b');
                const b = document.createElement('i');
                const c = document.createElement('u');
                parent.appendChild(a);
                parent.appendChild(b);
                parent.appendChild(c);
                expect(a.previousSibling).toBeNull();
                expect(a.nextSibling).toBe(b);
                expect(b.previousSibling).toBe(a);
                expect(b.nextSibling).toBe(c);
                expect(c.nextSibling).toBeNull();
            });

            await it('contains() checks descendants', async () => {
                const parent = document.createElement('div');
                const child = document.createElement('span');
                const grandchild = document.createElement('b');
                parent.appendChild(child);
                child.appendChild(grandchild);
                expect(parent.contains(child)).toBe(true);
                expect(parent.contains(grandchild)).toBe(true);
                expect(parent.contains(parent)).toBe(true);
                expect(child.contains(parent)).toBe(false);
            });

            await it('cloneNode shallow does not copy children', async () => {
                const parent = document.createElement('div');
                parent.appendChild(document.createElement('span'));
                const clone = parent.cloneNode(false);
                expect(clone.hasChildNodes()).toBe(false);
            });

            await it('cloneNode deep copies children', async () => {
                const parent = document.createElement('div');
                const child = document.createElement('span');
                parent.appendChild(child);
                const clone = parent.cloneNode(true);
                expect(clone.hasChildNodes()).toBe(true);
                expect(clone.firstChild).not.toBe(child);
            });

            await it('re-appending a child moves it to new parent', async () => {
                const p1 = document.createElement('div');
                const p2 = document.createElement('div');
                const child = document.createElement('span');
                p1.appendChild(child);
                p2.appendChild(child);
                expect(p1.hasChildNodes()).toBe(false);
                expect(p2.firstChild).toBe(child);
                expect(child.parentNode).toBe(p2);
            });
        });

        // -- Element attributes --

        await describe('Element attributes', async () => {
            await it('setAttribute / getAttribute / hasAttribute', async () => {
                const el = document.createElement('div');
                el.setAttribute('id', 'test');
                expect(el.getAttribute('id')).toBe('test');
                expect(el.hasAttribute('id')).toBe(true);
            });

            await it('removeAttribute clears the attr', async () => {
                const el = document.createElement('div');
                el.setAttribute('class', 'foo');
                el.removeAttribute('class');
                expect(el.getAttribute('class')).toBeNull();
                expect(el.hasAttribute('class')).toBe(false);
            });

            await it('id property mirrors attribute', async () => {
                const el = document.createElement('div');
                el.id = 'myId';
                expect(el.id).toBe('myId');
                expect(el.getAttribute('id')).toBe('myId');
            });

            await it('className property mirrors class attribute', async () => {
                const el = document.createElement('div');
                el.className = 'foo bar';
                expect(el.className).toBe('foo bar');
                expect(el.getAttribute('class')).toBe('foo bar');
            });

            await it('toggleAttribute adds then removes', async () => {
                const el = document.createElement('div');
                expect(el.toggleAttribute('hidden')).toBe(true);
                expect(el.hasAttribute('hidden')).toBe(true);
                expect(el.toggleAttribute('hidden')).toBe(false);
                expect(el.hasAttribute('hidden')).toBe(false);
            });

            await it('toggleAttribute with force', async () => {
                const el = document.createElement('div');
                expect(el.toggleAttribute('hidden', true)).toBe(true);
                expect(el.hasAttribute('hidden')).toBe(true);
                expect(el.toggleAttribute('hidden', false)).toBe(false);
                expect(el.hasAttribute('hidden')).toBe(false);
            });

            await it('hasAttributes reflects attribute presence', async () => {
                const el = document.createElement('div');
                expect(el.hasAttributes()).toBe(false);
                el.setAttribute('id', 'test');
                expect(el.hasAttributes()).toBe(true);
            });

            await it('attributes.length reflects count', async () => {
                const el = document.createElement('div');
                el.setAttribute('id', 'test');
                el.setAttribute('class', 'foo');
                expect(el.attributes.length).toBe(2);
            });

            await it('attributes is iterable', async () => {
                const el = document.createElement('div');
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

            await it('element children tracking', async () => {
                const parent = document.createElement('div');
                const c1 = document.createElement('span');
                const c2 = document.createElement('b');
                parent.appendChild(c1);
                parent.appendChild(c2);
                expect(parent.children.length).toBe(2);
                expect(parent.childElementCount).toBe(2);
                expect(parent.firstElementChild).toBe(c1);
                expect(parent.lastElementChild).toBe(c2);
            });

            await it('element sibling navigation', async () => {
                const parent = document.createElement('div');
                const a = document.createElement('span');
                const b = document.createElement('b');
                parent.appendChild(a);
                parent.appendChild(b);
                expect(a.nextElementSibling).toBe(b);
                expect(b.previousElementSibling).toBe(a);
                expect(a.previousElementSibling).toBeNull();
                expect(b.nextElementSibling).toBeNull();
            });

            await it('event dispatch via addEventListener', async () => {
                const el = document.createElement('div');
                let fired = false;
                el.addEventListener('click', () => { fired = true; });
                el.dispatchEvent(new Event('click'));
                expect(fired).toBe(true);
            });
        });

        // -- DOMTokenList (via element.classList) --

        await describe('DOMTokenList (classList)', async () => {
            await it('add creates tokens and updates class attribute', async () => {
                const el = document.createElement('div');
                el.classList.add('foo', 'bar');
                expect(el.classList.length).toBe(2);
                expect(el.classList.contains('foo')).toBe(true);
                expect(el.classList.contains('bar')).toBe(true);
                expect(el.getAttribute('class')).toBe('foo bar');
            });

            await it('remove removes tokens', async () => {
                const el = document.createElement('div');
                el.className = 'foo bar baz';
                el.classList.remove('bar');
                expect(el.classList.contains('bar')).toBe(false);
                expect(el.classList.contains('foo')).toBe(true);
                expect(el.classList.contains('baz')).toBe(true);
            });

            await it('toggle adds/removes', async () => {
                const el = document.createElement('div');
                const added = el.classList.toggle('active');
                expect(added).toBe(true);
                expect(el.classList.contains('active')).toBe(true);
                const removed = el.classList.toggle('active');
                expect(removed).toBe(false);
                expect(el.classList.contains('active')).toBe(false);
            });

            await it('toggle with force', async () => {
                const el = document.createElement('div');
                el.classList.toggle('active', true);
                expect(el.classList.contains('active')).toBe(true);
                el.classList.toggle('active', true);
                expect(el.classList.contains('active')).toBe(true);
                el.classList.toggle('active', false);
                expect(el.classList.contains('active')).toBe(false);
            });

            await it('item() by index', async () => {
                const el = document.createElement('div');
                el.className = 'a b c';
                expect(el.classList.item(0)).toBe('a');
                expect(el.classList.item(1)).toBe('b');
                expect(el.classList.item(2)).toBe('c');
                expect(el.classList.item(3)).toBeNull();
            });

            await it('value getter', async () => {
                const el = document.createElement('div');
                el.className = 'foo bar';
                expect(el.classList.value).toBe('foo bar');
            });

            await it('toString', async () => {
                const el = document.createElement('div');
                el.className = 'a b';
                expect(el.classList.toString()).toBe('a b');
            });
        });

        // -- HTMLElement properties --

        await describe('HTMLElement properties', async () => {
            await it('title', async () => {
                const el = document.createElement('div');
                expect(el.title).toBe('');
                el.title = 'My Title';
                expect(el.title).toBe('My Title');
                expect(el.getAttribute('title')).toBe('My Title');
            });

            await it('lang', async () => {
                const el = document.createElement('div');
                expect(el.lang).toBe('');
                el.lang = 'en';
                expect(el.lang).toBe('en');
            });

            await it('dir', async () => {
                const el = document.createElement('div');
                expect(el.dir).toBe('');
                el.dir = 'rtl';
                expect(el.dir).toBe('rtl');
            });

            await it('hidden (boolean attr)', async () => {
                const el = document.createElement('div');
                expect(el.hidden).toBe(false);
                el.hidden = true;
                expect(el.hidden).toBe(true);
                expect(el.hasAttribute('hidden')).toBe(true);
                el.hidden = false;
                expect(el.hidden).toBe(false);
                expect(el.hasAttribute('hidden')).toBe(false);
            });

            await it('tabIndex', async () => {
                const el = document.createElement('div');
                el.tabIndex = 0;
                expect(el.tabIndex).toBe(0);
                expect(el.getAttribute('tabindex')).toBe('0');
            });

            await it('draggable', async () => {
                const el = document.createElement('div');
                expect(el.draggable).toBe(false);
                el.draggable = true;
                expect(el.draggable).toBe(true);
                expect(el.getAttribute('draggable')).toBe('true');
            });

            await it('contentEditable', async () => {
                const el = document.createElement('div');
                el.contentEditable = 'true';
                expect(el.contentEditable).toBe('true');
                expect(el.isContentEditable).toBe(true);
                el.contentEditable = 'false';
                expect(el.isContentEditable).toBe(false);
            });

            await it('layout properties are numbers (zero for detached)', async () => {
                const el = document.createElement('div');
                expect(typeof el.offsetHeight).toBe('number');
                expect(typeof el.offsetWidth).toBe('number');
                expect(typeof el.clientHeight).toBe('number');
                expect(typeof el.clientWidth).toBe('number');
                expect(el.offsetParent).toBeNull();
            });

            await it('onclick handler fires on click()', async () => {
                const el = document.createElement('div');
                let clicked = false;
                el.onclick = () => { clicked = true; };
                el.click();
                expect(clicked).toBe(true);
            });

            await it('onload handler fires on dispatchEvent', async () => {
                const el = document.createElement('div');
                let called = false;
                el.onload = () => { called = true; };
                el.dispatchEvent(new Event('load'));
                expect(called).toBe(true);
            });

            await it('onwheel property exists (Excalibur feature-detect)', async () => {
                const el = document.createElement('div');
                expect('onwheel' in el).toBe(true);
                expect(el.onwheel).toBeNull();
            });

            await it('both addEventListener and on* handler fire', async () => {
                const el = document.createElement('div');
                const calls: string[] = [];
                el.addEventListener('load', () => { calls.push('listener'); });
                el.onload = () => { calls.push('handler'); };
                el.dispatchEvent(new Event('load'));
                expect(calls.length).toBe(2);
                expect(calls).toContain('listener');
                expect(calls).toContain('handler');
            });

            await it('clearing on* handler stops it from firing', async () => {
                const el = document.createElement('div');
                let called = false;
                el.onload = () => { called = true; };
                el.onload = null;
                el.dispatchEvent(new Event('load'));
                expect(called).toBe(false);
            });
        });

        // -- Text / Comment / DocumentFragment --

        await describe('Text', async () => {
            await it('creates with data and TEXT_NODE type', async () => {
                const t = new Text('hello');
                expect(t.data).toBe('hello');
                expect(t.nodeType).toBe(Node.TEXT_NODE);
                expect(t.nodeName).toBe('#text');
            });

            await it('empty default', async () => {
                const t = new Text();
                expect(t.data).toBe('');
            });

            await it('splitText splits data', async () => {
                const parent = document.createElement('div');
                const t = new Text('hello world');
                parent.appendChild(t);
                const newNode = t.splitText(5);
                expect(t.data).toBe('hello');
                expect(newNode.data).toBe(' world');
                expect(parent.childNodes.length).toBe(2);
            });

            await it('wholeText joins adjacent text nodes', async () => {
                const parent = document.createElement('div');
                const t1 = new Text('hello');
                const t2 = new Text(' ');
                const t3 = new Text('world');
                parent.appendChild(t1);
                parent.appendChild(t2);
                parent.appendChild(t3);
                expect(t2.wholeText).toBe('hello world');
            });
        });

        await describe('Comment', async () => {
            await it('creates with data and COMMENT_NODE type', async () => {
                const c = new Comment('a comment');
                expect(c.data).toBe('a comment');
                expect(c.nodeType).toBe(Node.COMMENT_NODE);
                expect(c.nodeName).toBe('#comment');
            });

            await it('cloneNode', async () => {
                const c = new Comment('test');
                const clone = c.cloneNode() as Comment;
                expect(clone.data).toBe('test');
                expect(clone instanceof Comment).toBe(true);
                expect(clone).not.toBe(c);
            });
        });

        await describe('DocumentFragment', async () => {
            await it('has correct nodeType and nodeName', async () => {
                const frag = new DocumentFragment();
                expect(frag.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE);
                expect(frag.nodeName).toBe('#document-fragment');
            });

            await it('tracks appended children', async () => {
                const frag = new DocumentFragment();
                const el = document.createElement('div');
                frag.appendChild(el);
                expect(frag.childNodes.length).toBe(1);
                expect(frag.children.length).toBe(1);
                expect(frag.firstElementChild).toBe(el);
            });

            await it('textContent concatenates text nodes', async () => {
                const frag = new DocumentFragment();
                frag.appendChild(new Text('hello'));
                frag.appendChild(new Text(' world'));
                expect(frag.textContent).toBe('hello world');
            });
        });

        // -- DOMMatrix --

        await describe('DOMMatrix', async () => {
            await it('identity by default', async () => {
                const m = new DOMMatrix();
                expect(m.a).toBe(1);
                expect(m.b).toBe(0);
                expect(m.c).toBe(0);
                expect(m.d).toBe(1);
                expect(m.e).toBe(0);
                expect(m.f).toBe(0);
                expect(m.is2D).toBe(true);
                expect(m.isIdentity).toBe(true);
            });

            await it('6-element 2D array initializer', async () => {
                const m = new DOMMatrix([1, 2, 3, 4, 5, 6]);
                expect(m.a).toBe(1);
                expect(m.b).toBe(2);
                expect(m.c).toBe(3);
                expect(m.d).toBe(4);
                expect(m.e).toBe(5);
                expect(m.f).toBe(6);
                expect(m.is2D).toBe(true);
                expect(m.m11).toBe(1);
                expect(m.m41).toBe(5);
                expect(m.m42).toBe(6);
            });

            await it('16-element 3D array sets is2D=false', async () => {
                const m = new DOMMatrix([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);
                expect(m.m11).toBe(1);
                expect(m.m44).toBe(16);
                expect(m.is2D).toBe(false);
            });

            await it('isIdentity false for non-identity', async () => {
                const m = new DOMMatrix([2, 0, 0, 2, 0, 0]);
                expect(m.isIdentity).toBe(false);
            });

            await it('multiply: identity is neutral', async () => {
                const a = new DOMMatrix([2, 0, 0, 3, 10, 20]);
                const i = new DOMMatrix();
                const r = a.multiply(i);
                expect(r.a).toBe(2);
                expect(r.d).toBe(3);
                expect(r.e).toBe(10);
                expect(r.f).toBe(20);
            });

            await it('multiply: two scales compose', async () => {
                const a = new DOMMatrix([2, 0, 0, 3, 0, 0]);
                const b = new DOMMatrix([4, 0, 0, 5, 0, 0]);
                const r = a.multiply(b);
                expect(r.a).toBe(8);
                expect(r.d).toBe(15);
            });

            await it('multiply does not mutate receiver', async () => {
                const a = new DOMMatrix([2, 0, 0, 2, 0, 0]);
                const b = new DOMMatrix([3, 0, 0, 3, 0, 0]);
                a.multiply(b);
                expect(a.a).toBe(2);
            });

            await it('inverse of identity is identity', async () => {
                const m = new DOMMatrix().inverse();
                expect(m.a).toBe(1);
                expect(m.d).toBe(1);
                expect(m.e).toBe(0);
                expect(m.f).toBe(0);
            });

            await it('inverse of scale(2,2) is scale(0.5, 0.5)', async () => {
                const m = new DOMMatrix([2, 0, 0, 2, 0, 0]).inverse();
                expect(m.a).toBe(0.5);
                expect(m.d).toBe(0.5);
            });

            await it('inverse of translate(10,20) is translate(-10,-20)', async () => {
                const m = new DOMMatrix([1, 0, 0, 1, 10, 20]).inverse();
                expect(m.e).toBe(-10);
                expect(m.f).toBe(-20);
            });

            await it('translate helper', async () => {
                const m = new DOMMatrix().translate(5, 7);
                expect(m.e).toBe(5);
                expect(m.f).toBe(7);
            });

            await it('scale helper', async () => {
                const m = new DOMMatrix().scale(3, 4);
                expect(m.a).toBe(3);
                expect(m.d).toBe(4);
            });
        });

        // -- CSSStyleDeclaration (via element.style) --

        await describe('CSSStyleDeclaration (element.style)', async () => {
            await it('setProperty / getPropertyValue', async () => {
                const el = document.createElement('div');
                el.style.setProperty('--ex-pixel-ratio', '2');
                expect(el.style.getPropertyValue('--ex-pixel-ratio')).toBe('2');
            });

            await it('removeProperty returns and clears value', async () => {
                const el = document.createElement('div');
                el.style.setProperty('--test', 'hello');
                const removed = el.style.removeProperty('--test');
                expect(removed).toBe('hello');
                expect(el.style.getPropertyValue('--test')).toBe('');
            });

            await it('getPropertyValue returns empty for unknown', async () => {
                const el = document.createElement('div');
                expect(el.style.getPropertyValue('nonexistent')).toBe('');
            });

            await it('getPropertyPriority is empty without !important', async () => {
                const el = document.createElement('div');
                el.style.setProperty('color', 'red');
                expect(el.style.getPropertyPriority('color')).toBe('');
            });

            await it('cssText setter parses declarations', async () => {
                const el = document.createElement('div');
                el.style.cssText = 'background-color:rgba(135,100,100,.5)';
                const bg = el.style.getPropertyValue('background-color');
                expect(typeof bg).toBe('string');
                expect(bg.length).toBeGreaterThan(0);
            });
        });

        // -- FontFace --

        await describe('FontFace', async () => {
            await it('constructor sets family and status', async () => {
                const face = new FontFace('TestFont', 'url(nonexistent.ttf)');
                expect(face.family).toBe('TestFont');
                expect(face.status).toBe('unloaded');
            });

            await it('load() returns a Promise', async () => {
                const face = new FontFace('TestFont2', 'url(nonexistent.ttf)');
                const p = face.load();
                expect(p instanceof Promise).toBe(true);
                p.catch(() => {});
            });
        });

        // -- FontFaceSet (document.fonts) --

        await describe('document.fonts (FontFaceSet)', async () => {
            await it('add/has/size track added faces', async () => {
                const face = new FontFace('BrowserTestFont', 'url(nonexistent.ttf)');
                const before = document.fonts.size;
                document.fonts.add(face);
                expect(document.fonts.has(face)).toBe(true);
                expect(document.fonts.size).toBe(before + 1);
                document.fonts.delete(face);
                expect(document.fonts.has(face)).toBe(false);
            });

            await it('ready is a Promise', async () => {
                expect(document.fonts.ready instanceof Promise).toBe(true);
            });
        });

        // -- window.matchMedia --

        await describe('window.matchMedia', async () => {
            await it('returns MediaQueryList with media string', async () => {
                const mq = window.matchMedia('(min-width: 800px)');
                expect(mq.media).toBe('(min-width: 800px)');
                expect(typeof mq.matches).toBe('boolean');
            });

            await it('addEventListener is available on MediaQueryList', async () => {
                const mq = window.matchMedia('(min-width: 100px)');
                expect(typeof mq.addEventListener).toBe('function');
            });
        });
    },
});
