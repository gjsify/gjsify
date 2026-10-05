/** One element of a parsed XML document. Text and element children keep their source order in `children`. */
export interface XmlElement {
    readonly name: string;
    readonly attributes: Readonly<Record<string, string>>;
    readonly children: readonly (XmlElement | string)[];
    /** Offset of the opening `<` in the source, for error messages. */
    readonly offset: number;
}

const ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export class XmlParseError extends Error {
    constructor(
        message: string,
        readonly offset: number,
    ) {
        super(`${message} (at offset ${offset})`);
        this.name = 'XmlParseError';
    }
}

/** Decodes the five predefined entities and numeric references; an unknown entity is an error, not passed through. */
export function decodeEntities(text: string, offset = 0): string {
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body: string) => {
        if (body.startsWith('#')) {
            const code = body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
            if (!(code >= 1 && code <= 0x10ffff) || (code >= 0xd800 && code <= 0xdfff)) {
                throw new XmlParseError(`invalid character reference ${whole}`, offset);
            }
            return String.fromCodePoint(code);
        }
        const value = ENTITIES[body];
        if (value === undefined) throw new XmlParseError(`unknown entity ${whole}`, offset);
        return value;
    });
}

const NAME = '[A-Za-z_][\\w.:-]*';
const ATTRIBUTE = new RegExp(`\\s+(${NAME})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'y');

/**
 * Parses the XML subset GtkSourceView's data files use: elements, attributes, text, comments,
 * CDATA, a prolog. DOCTYPE with an internal subset and namespaces are refused rather than guessed.
 */
export function parseXml(source: string): XmlElement {
    let pos = 0;
    const stack: {
        name: string;
        offset: number;
        attributes: Record<string, string>;
        children: (XmlElement | string)[];
    }[] = [];
    let root: XmlElement | null = null;

    const closeElement = (element: XmlElement): void => {
        const parent = stack[stack.length - 1];
        if (parent) parent.children.push(element);
        else if (root) throw new XmlParseError('more than one root element', element.offset);
        else root = element;
    };

    while (pos < source.length) {
        const lt = source.indexOf('<', pos);
        const textEnd = lt === -1 ? source.length : lt;
        if (textEnd > pos) {
            const raw = source.slice(pos, textEnd);
            const parent = stack[stack.length - 1];
            if (parent) parent.children.push(decodeEntities(raw, pos));
            else if (raw.trim() !== '') throw new XmlParseError('text outside the root element', pos);
        }
        if (lt === -1) break;
        pos = lt;

        if (source.startsWith('<!--', pos)) {
            const end = source.indexOf('-->', pos + 4);
            if (end === -1) throw new XmlParseError('unterminated comment', pos);
            pos = end + 3;
        } else if (source.startsWith('<![CDATA[', pos)) {
            const end = source.indexOf(']]>', pos + 9);
            if (end === -1) throw new XmlParseError('unterminated CDATA section', pos);
            const parent = stack[stack.length - 1];
            if (!parent) throw new XmlParseError('CDATA outside the root element', pos);
            parent.children.push(source.slice(pos + 9, end));
            pos = end + 3;
        } else if (source.startsWith('<?', pos)) {
            const end = source.indexOf('?>', pos + 2);
            if (end === -1) throw new XmlParseError('unterminated processing instruction', pos);
            pos = end + 2;
        } else if (source.startsWith('<!', pos)) {
            if (/^<!DOCTYPE[^[>]*>/i.test(source.slice(pos))) pos = source.indexOf('>', pos) + 1;
            else throw new XmlParseError('unsupported markup declaration', pos);
        } else if (source.startsWith('</', pos)) {
            const match = new RegExp(`</(${NAME})\\s*>`, 'y');
            match.lastIndex = pos;
            const found = match.exec(source);
            if (!found) throw new XmlParseError('malformed closing tag', pos);
            const open = stack.pop();
            if (!open || open.name !== found[1]) {
                throw new XmlParseError(`closing tag </${found[1]}> does not match <${open?.name ?? 'nothing'}>`, pos);
            }
            closeElement({
                name: open.name,
                attributes: open.attributes,
                children: open.children,
                offset: open.offset,
            });
            pos = match.lastIndex;
        } else {
            const nameMatch = new RegExp(`<(${NAME})`, 'y');
            nameMatch.lastIndex = pos;
            const found = nameMatch.exec(source);
            if (!found) throw new XmlParseError('malformed opening tag', pos);
            const attributes: Record<string, string> = {};
            let cursor = nameMatch.lastIndex;
            for (;;) {
                ATTRIBUTE.lastIndex = cursor;
                const attribute = ATTRIBUTE.exec(source);
                if (!attribute) break;
                if (attribute[1] in attributes) throw new XmlParseError(`duplicate attribute ${attribute[1]}`, cursor);
                attributes[attribute[1]] = decodeEntities(attribute[2] ?? attribute[3] ?? '', cursor);
                cursor = ATTRIBUTE.lastIndex;
            }
            const tail = /^\s*(\/?)>/.exec(source.slice(cursor));
            if (!tail) throw new XmlParseError(`malformed attributes on <${found[1]}>`, cursor);
            pos = cursor + tail[0].length;
            if (tail[1] === '/') closeElement({ name: found[1], attributes, children: [], offset: found.index });
            else stack.push({ name: found[1], offset: found.index, attributes, children: [] });
        }
    }
    if (stack.length > 0) throw new XmlParseError(`unclosed element <${stack[stack.length - 1].name}>`, source.length);
    if (!root) throw new XmlParseError('no root element', 0);
    return root;
}

/** The child elements, in order, optionally only those named `name`. */
export function childElements(element: XmlElement, name?: string): XmlElement[] {
    return element.children.filter(
        (child): child is XmlElement => typeof child !== 'string' && (name === undefined || child.name === name),
    );
}

/** The concatenated text of an element, as the XML spec defines text content. */
export function textContent(element: XmlElement): string {
    return element.children.map((child) => (typeof child === 'string' ? child : textContent(child))).join('');
}
