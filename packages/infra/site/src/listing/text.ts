import { esc } from '../render/html.js';
import type { DescriptionBlock, Localized } from '../site-data/types.js';

type Resolve = (text: Localized) => string;

/** Paragraphs separated by a blank line, list items as `• item` — what every store's textarea shows. */
export function descriptionText(blocks: readonly DescriptionBlock[], resolve: Resolve): string {
    return blocks
        .map((block) =>
            block.type === 'paragraph'
                ? resolve(block.text)
                : block.items.map((item) => `• ${resolve(item)}`).join('\n'),
        )
        .join('\n\n');
}

/** The conservative subset (`p`, `ul`, `li`) every HTML sanitiser a store runs keeps. */
export function descriptionHtml(blocks: readonly DescriptionBlock[], resolve: Resolve): string {
    return blocks
        .map((block) =>
            block.type === 'paragraph'
                ? `<p>${esc(resolve(block.text))}</p>`
                : `<ul>\n${block.items.map((item) => `  <li>${esc(resolve(item))}</li>`).join('\n')}\n</ul>`,
        )
        .join('\n');
}

/** Code points, not UTF-16 units: the stores count what a person sees. */
export function characters(value: string): number {
    return [...value].length;
}

/**
 * Drops the paragraphs and list items whose source-language text equals an `omit` entry. A block is
 * one `Localized`, so its translations go with it in every language. An entry that matches nothing
 * throws: a typo must not leave the sentence in a store listing.
 */
export function omitBlocks(blocks: readonly DescriptionBlock[], omit: readonly string[]): DescriptionBlock[] {
    const hit = new Set<string>();
    const drop = (text: Localized): boolean => {
        const entry = omit.find((candidate) => candidate === text.source);
        if (entry === undefined) return false;
        hit.add(entry);
        return true;
    };
    const kept: DescriptionBlock[] = [];
    for (const block of blocks) {
        if (block.type === 'paragraph') {
            if (!drop(block.text)) kept.push(block);
            continue;
        }
        const items = block.items.filter((item) => !drop(item));
        if (items.length > 0) kept.push({ type: 'list', items });
    }
    const missing = omit.filter((entry) => !hit.has(entry));
    if (missing.length > 0)
        throw new Error(
            `gjsify.webext.listing.omit matches no description paragraph or list item: ${missing.map((entry) => `"${entry}"`).join(', ')} (use the source-language text exactly as in the metainfo)`,
        );
    return kept;
}
