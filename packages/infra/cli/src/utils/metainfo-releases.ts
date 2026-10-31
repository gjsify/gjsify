// The `<release>` entries of a hand-written AppStream metainfo file, in the shape of the config's
// `releases`, for `gjsify release-notes`.
//
// Apps that keep the file by hand (`gjsify.site.metainfo`) have no `releases` in the config, but the
// file holds the same data. The tokeniser is the one `gjsify flatpak check` uses; this module only
// adds the part that one throws away: inline markup, which a release note needs as Markdown.

import { scanXml } from '@gjsify/utils/core';
import type { DescriptionBlock } from '../types/config-data.js';
import type { ReleaseEntry } from './release-notes.js';

interface Element {
    name: string;
    attrs: Record<string, string>;
    /** Elements and text in document order — inline markup needs the interleaving. */
    nodes: Array<Element | string>;
}

/** Strip the legacy intltool `_` prefix (`<_description>`), which `.metainfo.xml.in` files still use. */
const normName = (name: string): string => (name.startsWith('_') ? name.slice(1) : name);

function buildTree(xml: string): Element {
    const root: Element = { name: '#root', attrs: {}, nodes: [] };
    const stack: Element[] = [root];
    for (const token of scanXml(xml)) {
        const top = stack[stack.length - 1]!;
        if (token.kind === 'text') {
            top.nodes.push(token.text);
        } else if (token.kind === 'open') {
            const element: Element = { name: normName(token.name), attrs: token.attributes, nodes: [] };
            top.nodes.push(element);
            if (!token.selfClosing) stack.push(element);
        } else if (stack.length > 1) {
            stack.pop();
        }
    }
    return root;
}

const elements = (parent: Element, name?: string): Element[] =>
    parent.nodes.filter(
        (node): node is Element => typeof node !== 'string' && (name === undefined || node.name === name),
    );

/** A translation (`xml:lang`) of the untagged element before it; the untagged one is the source. */
const isTranslation = (element: Element): boolean => element.attrs['xml:lang'] !== undefined;

const INLINE_WRAP: Record<string, string> = { em: '*', i: '*', strong: '**', b: '**', code: '`', tt: '`' };

function inlineMarkdown(element: Element): string {
    let out = '';
    for (const node of element.nodes) {
        if (typeof node === 'string') {
            out += node;
            continue;
        }
        if (isTranslation(node)) continue;
        const inner = inlineMarkdown(node);
        const wrap = INLINE_WRAP[node.name];
        if (wrap !== undefined) out += inner.trim() === '' ? inner : `${wrap}${inner.trim()}${wrap}`;
        else if (node.name === 'a' && node.attrs.href) out += `[${inner}](${node.attrs.href})`;
        else out += inner;
    }
    return out;
}

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

function parseBlocks(description: Element): DescriptionBlock[] {
    const blocks: DescriptionBlock[] = [];
    for (const element of elements(description)) {
        if (isTranslation(element)) continue;
        if (element.name === 'p') {
            const text = clean(inlineMarkdown(element));
            if (text) blocks.push({ p: text });
        } else if (element.name === 'ul' || element.name === 'ol') {
            const items = elements(element, 'li')
                .filter((li) => !isTranslation(li))
                .map((li) => clean(inlineMarkdown(li)))
                .filter(Boolean);
            if (items.length) blocks.push({ ul: items });
        }
    }
    return blocks;
}

/** Document order is kept: metainfo lists the newest release first, which `--compare` relies on. */
export function parseMetainfoReleases(xml: string): ReleaseEntry[] {
    const component = elements(buildTree(xml), 'component')[0];
    if (!component) throw new Error('metainfo root must be <component>');
    const releases = elements(component, 'releases')[0];
    if (!releases) return [];
    return elements(releases, 'release').map((release) => {
        const timestamp = release.attrs.timestamp;
        const date =
            release.attrs.date ?? (timestamp ? new Date(Number(timestamp) * 1000).toISOString().slice(0, 10) : '');
        const description = elements(release, 'description').find((candidate) => !isTranslation(candidate));
        const blocks = description ? parseBlocks(description) : [];
        return {
            version: release.attrs.version ?? '',
            date,
            ...(blocks.length ? { description: blocks } : {}),
        };
    });
}
