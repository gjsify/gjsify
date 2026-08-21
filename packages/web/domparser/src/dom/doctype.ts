import { DOCUMENT_TYPE_NODE, DOMNode } from './node.js';

export class DOMDocumentType extends DOMNode {
    readonly name: string;
    readonly publicId: string;
    readonly systemId: string;

    constructor(name: string, publicId: string, systemId: string) {
        super(DOCUMENT_TYPE_NODE, name);
        this.name = name;
        this.publicId = publicId;
        this.systemId = systemId;
    }
}
