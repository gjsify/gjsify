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
