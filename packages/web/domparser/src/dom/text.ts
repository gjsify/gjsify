import { CDATA_SECTION_NODE, DOMNode, TEXT_NODE } from './node.js';

export class DOMText extends DOMNode {
    constructor(data: string) {
        super(TEXT_NODE, '#text', data);
    }

    get data(): string {
        return this.nodeValue ?? '';
    }

    set data(value: string) {
        this.nodeValue = value;
    }
}

export class DOMCDATASection extends DOMNode {
    constructor(data: string) {
        super(CDATA_SECTION_NODE, '#cdata-section', data);
    }
}
