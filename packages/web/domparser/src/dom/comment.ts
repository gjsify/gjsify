import { COMMENT_NODE, DOMNode } from './node.js';

export class DOMComment extends DOMNode {
    constructor(data: string) {
        super(COMMENT_NODE, '#comment', data);
    }

    get data(): string {
        return this.nodeValue ?? '';
    }
}
