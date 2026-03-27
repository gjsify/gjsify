// Minimal Document stub for GJS — original implementation
// Reference: refs/happy-dom/packages/happy-dom/src/nodes/document/Document.ts

import { HTMLElement } from './html-element.js';
import { HTMLImageElement } from './html-image-element.js';
import { HTMLCanvasElement } from './html-canvas-element.js';

export class Document {
    createElementNS(_namespace: string | null, tagName: string): HTMLElement {
        switch (tagName.toLowerCase()) {
            case 'img': return new HTMLImageElement();
            case 'canvas': return new HTMLCanvasElement();
            default: return new HTMLElement();
        }
    }

    createElement(tagName: string): HTMLElement {
        return this.createElementNS('http://www.w3.org/1999/xhtml', tagName);
    }
}

export const document = new Document();
