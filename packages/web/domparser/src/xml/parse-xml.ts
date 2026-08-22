// The XML scanner. Its tree shape is FROZEN — including the two observables that
// are wrong by the XML spec (`tagName` lowercased, `nodeName` uppercased), because
// the one measured consumer switches on lowercase tag literals at 24 sites. The
// freeze is held by the golden in `src/xml-shape.spec.ts`, not by this comment.
// ADR 0026 § Decision 4.

import { DOMComment } from '../dom/comment.js';
import { DOMDocumentType } from '../dom/doctype.js';
import { DOMDocument } from '../dom/document.js';
import { DOMElement } from '../dom/element.js';
import { CDATA_SECTION_NODE, DOMNode, TEXT_NODE } from '../dom/node.js';
import { decodeXml } from '../entities/decode.js';

const ATTR_PATTERN = /\s+([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;

/** Not `toLowerCase()`: XML names are case-sensitive, and only the ASCII keyword
 *  spelling of `<!DOCTYPE` is being recognised here. */
function asciiLower(value: string): string {
    return value.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

function parseAttributes(attrsStr: string, el: DOMElement): void {
    let m: RegExpExecArray | null;
    ATTR_PATTERN.lastIndex = 0;
    while ((m = ATTR_PATTERN.exec(attrsStr)) !== null) {
        el.setAttribute(m[1], decodeXml(m[2] ?? m[3] ?? m[4] ?? ''));
    }
}

export function parseXml(xml: string): DOMDocument {
    const doc = new DOMDocument();
    const stack: DOMElement[] = [doc];
    let i = 0;
    const len = xml.length;

    while (i < len) {
        const ltIdx = xml.indexOf('<', i);
        if (ltIdx === -1) {
            const text = xml.slice(i);
            if (text.trim()) {
                const tn = new DOMNode(TEXT_NODE, '#text', decodeXml(text));
                const top = stack[stack.length - 1];
                tn.parentNode = top;
                top.childNodes.push(tn);
            }
            break;
        }

        if (ltIdx > i) {
            const text = xml.slice(i, ltIdx);
            if (text.trim()) {
                const tn = new DOMNode(TEXT_NODE, '#text', decodeXml(text));
                const top = stack[stack.length - 1];
                tn.parentNode = top;
                top.childNodes.push(tn);
            }
        }

        // CDATA
        if (xml.startsWith('<![CDATA[', ltIdx)) {
            const end = xml.indexOf(']]>', ltIdx);
            if (end === -1) break;
            const cn = new DOMNode(CDATA_SECTION_NODE, '#cdata-section', xml.slice(ltIdx + 9, end));
            const top = stack[stack.length - 1];
            cn.parentNode = top;
            top.childNodes.push(cn);
            i = end + 3;
            continue;
        }

        // Comment. Kept as a node rather than skipped (ADR 0026 § Decision 4): a
        // strict addition, because `children` is element-only and `textContent`
        // excludes comments by spec, so both stay exactly as they were.
        if (xml.startsWith('<!--', ltIdx)) {
            const end = xml.indexOf('-->', ltIdx);
            const cn = new DOMComment(xml.slice(ltIdx + 4, end === -1 ? len : end));
            const top = stack[stack.length - 1];
            cn.parentNode = top;
            top.childNodes.push(cn);
            i = end === -1 ? len : end + 3;
            continue;
        }

        // `<!DOCTYPE name …>`. Only the name is read: an XML doctype's internal
        // subset is a grammar this scanner does not have, and no consumer asks.
        if (asciiLower(xml.slice(ltIdx, ltIdx + 9)) === '<!doctype') {
            const end = findTagEnd(xml, ltIdx + 9);
            const declared = xml.slice(ltIdx + 9, end === -1 ? len : end).trim();
            const name = declared.split(/[\s[]/)[0] ?? '';
            const dt = new DOMDocumentType(name, '', '');
            dt.parentNode = doc;
            doc.childNodes.push(dt);
            i = end === -1 ? len : end + 1;
            continue;
        }

        // Processing instruction, or any other `<!…` declaration.
        if (xml.startsWith('<?', ltIdx) || xml.startsWith('<!', ltIdx)) {
            const end = xml.indexOf('>', ltIdx);
            i = end === -1 ? len : end + 1;
            continue;
        }

        // For tags that may contain '>' inside attribute values, find proper end
        const gtIdx = findTagEnd(xml, ltIdx + 1);
        if (gtIdx === -1) break;

        const tagContent = xml.slice(ltIdx + 1, gtIdx);

        // Closing tag
        if (tagContent.startsWith('/')) {
            if (stack.length > 1) stack.pop();
            i = gtIdx + 1;
            continue;
        }

        const selfClosing = tagContent.endsWith('/');
        const inner = selfClosing ? tagContent.slice(0, -1) : tagContent;

        const wsIdx = inner.search(/\s/);
        const tagName = (wsIdx === -1 ? inner : inner.slice(0, wsIdx)).trim();
        if (!tagName) {
            i = gtIdx + 1;
            continue;
        }

        const el = new DOMElement(tagName);
        if (wsIdx !== -1) parseAttributes(inner.slice(wsIdx), el);

        const top = stack[stack.length - 1];
        el.parentNode = top;
        top.childNodes.push(el);

        if (top === doc && !doc.documentElement) {
            doc.documentElement = el;
        }

        if (!selfClosing) stack.push(el);

        i = gtIdx + 1;
    }

    return doc;
}

/** Find the index of '>' that closes a tag, skipping '>' inside quoted attribute values. */
function findTagEnd(xml: string, start: number): number {
    let inSingle = false;
    let inDouble = false;
    for (let i = start; i < xml.length; i++) {
        const ch = xml[i];
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (ch === '>' && !inSingle && !inDouble) return i;
    }
    return -1;
}
