// The 1200×630 link-preview card, drawn as SVG and rasterised by GdkPixbuf's SVG loader
// (`renderCardPng` in `images.ts`) — the same backend as the screenshots, no extra dependency.

import { esc } from './html.js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface OgCardInput {
    name: string;
    summary: string;
    background: string;
    foreground: string;
    /** The app icon as a data URI; the card has no text column offset without one. */
    iconHref?: string;
}

/** Greedy word wrap on character count; what does not fit in `maxLines` is cut with an ellipsis. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
    const lines: string[] = [];
    let current = '';
    let rest = text.split(/\s+/).filter(Boolean);
    while (rest.length > 0) {
        const [word, ...others] = rest;
        const next = current ? `${current} ${word}` : word!;
        if (next.length <= maxChars || !current) {
            current = next;
            rest = others;
            continue;
        }
        lines.push(current);
        current = '';
    }
    if (current) lines.push(current);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.slice(0, Math.max(1, maxChars - 1)).replace(/[\s,;:.]+$/, '')}…`;
    return kept;
}

const PADDING = 80;
const ICON = 256;

export function ogCardSvg(input: OgCardInput): string {
    const textX = input.iconHref ? PADDING + ICON + 64 : PADDING;
    const textWidth = OG_WIDTH - textX - PADDING;
    // Average glyph advance of a bold sans face is about 0.58 em, a regular one 0.5 em.
    const nameSize = Math.max(48, Math.min(88, Math.floor(textWidth / (Math.max(input.name.length, 1) * 0.58))));
    const summarySize = 40;
    const summaryLines = wrapText(input.summary, Math.floor(textWidth / (summarySize * 0.5)), 3);
    const lineHeight = 54;
    const height = nameSize * 1.1 + (summaryLines.length > 0 ? 28 + summaryLines.length * lineHeight : 0);
    const top = (OG_HEIGHT - height) / 2;
    const nameY = top + nameSize;
    const summary = summaryLines
        .map(
            (line, index) =>
                `<text x="${textX}" y="${Math.round(nameY + 28 + (index + 1) * lineHeight - 12)}" font-size="${summarySize}" opacity="0.9">${esc(line)}</text>`,
        )
        .join('');
    const icon = input.iconHref
        ? `<image x="${PADDING}" y="${(OG_HEIGHT - ICON) / 2}" width="${ICON}" height="${ICON}" xlink:href="${esc(input.iconHref)}"/>`
        : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}"><rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${esc(input.background)}"/>${icon}<g font-family="Cantarell, Inter, sans-serif" fill="${esc(input.foreground)}"><text x="${textX}" y="${Math.round(nameY)}" font-size="${nameSize}" font-weight="700">${esc(input.name)}</text>${summary}</g></svg>`;
}
