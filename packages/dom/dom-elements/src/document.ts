// Document stub for GJS — original implementation
// Reference: refs/happy-dom/packages/happy-dom/src/nodes/document/Document.ts

import { Node } from './node.js';
import type { Element } from './element.js';
import { HTMLElement } from './html-element.js';
import { HTMLImageElement } from './html-image-element.js';
import { HTMLVideoElement } from './html-video-element.js';
import { HTMLCanvasElement } from './html-canvas-element.js';
import { Text } from './text.js';
import { Comment } from './comment.js';
import { DocumentFragment } from './document-fragment.js';
import { Event } from '@gjsify/dom-events';
import { NamespaceURI } from './namespace-uri.js';
import * as PS from './property-symbol.js';

type ElementFactory = () => HTMLElement;

export class Document extends Node {
    /** External packages register element factories here (e.g. @gjsify/iframe registers 'iframe') */
    private static _elementFactories = new Map<string, ElementFactory>();

    /** Stub body element */
    readonly body: HTMLElement = new HTMLElement();

    /** Stub head element */
    readonly head: HTMLElement = new HTMLElement();

    /** Stub documentElement */
    readonly documentElement: HTMLElement = new HTMLElement();

    constructor() {
        super();
        // Establish DOM tree: document → documentElement → body
        // so event bubbling from any child of body reaches document.
        this.appendChild(this.documentElement);
        this.documentElement.appendChild(this.body);
    }

    /**
     * Register a factory for a custom element tag name.
     * Called as a side-effect by DOM packages to avoid circular dependencies.
     *
     * Example: `Document.registerElementFactory('iframe', () => new HTMLIFrameElement())`
     */
    static registerElementFactory(tagName: string, factory: ElementFactory): void {
        Document._elementFactories.set(tagName.toLowerCase(), factory);
    }

    /**
     * Create an element — and NAME it.
     *
     * The naming is the part that was missing: every element this factory
     * returned carried the class default `''` for `tagName`, `localName` and
     * therefore `nodeName`. Nothing failed, because nothing asked — until
     * something did: `getElementsByTagName('li')` compared `'' === 'LI'` and
     * answered 0 for a tree full of `li`, and `querySelector('li')` inherited
     * the same silence the moment the selector engine started reading real
     * names (ADR 0026 § Decision 2). Both are the shape where a method answers
     * confidently and wrongly rather than failing.
     */
    createElementNS(namespace: string | null, tagName: string): HTMLElement {
        const tag = tagName.toLowerCase();
        const element = ((): HTMLElement => {
            switch (tag) {
                case 'img':
                    return new HTMLImageElement();
                case 'video':
                    return new HTMLVideoElement();
                case 'canvas':
                    return new HTMLCanvasElement();
                default: {
                    const factory = Document._elementFactories.get(tag);
                    if (factory) return factory();
                    return new HTMLElement();
                }
            }
        })();

        // `tagName` uppercase and `localName` lowercase is what the HTML DOM
        // reports; the selector engine reads `localName`, so the two must not be
        // collapsed into one field.
        element[PS.localName] = tag;
        element[PS.tagName] = tag.toUpperCase();
        element[PS.namespaceURI] = namespace ?? NamespaceURI.html;
        return element;
    }

    createElement(tagName: string): HTMLElement {
        return this.createElementNS('http://www.w3.org/1999/xhtml', tagName);
    }

    createTextNode(data: string): Text {
        return new Text(data);
    }

    createComment(data: string): Comment {
        return new Comment(data);
    }

    createDocumentFragment(): DocumentFragment {
        return new DocumentFragment();
    }

    createEvent(type: string): Event {
        return new Event(type);
    }

    /**
     * Find an element by ID. Searches body's descendants.
     */
    getElementById(id: string): Element | null {
        return this._findById(this.body, id);
    }

    private _findById(element: Element, id: string): Element | null {
        if (element.id === id) return element;
        for (const child of element.children) {
            const found = this._findById(child, id);
            if (found) return found;
        }
        return null;
    }

    get [Symbol.toStringTag](): string {
        return 'Document';
    }
}

export const document = new Document();
