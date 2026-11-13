import { esc } from '../render/html.js';
import { wrapText } from '../render/og-card.js';
import type { PromoSpec } from './limits.js';

export interface PromoInput {
    name: string;
    summary: string;
    background: string;
    foreground: string;
    /** The app icon as a data URI; the tile is text only without one. */
    iconHref?: string;
}

/** Both stores' promo tiles are text on the brand colour; a wide tile sets the icon beside the text. */
export function promoSvg(spec: Pick<PromoSpec, 'width' | 'height'>, input: PromoInput): string {
    const { width, height } = spec;
    const wide = width / height >= 2;
    const lines = (size: number, textWidth: number, max: number) =>
        wrapText(input.summary, Math.max(8, Math.floor(textWidth / (size * 0.5))), max);
    const fit = (textWidth: number, cap: number) =>
        Math.round(Math.max(12, Math.min(cap, textWidth / (Math.max(input.name.length, 1) * 0.58))));
    let icon = '';
    let body: string;
    if (wide) {
        const pad = Math.round(height * 0.16);
        const iconSize = Math.round(height * 0.5);
        const x = input.iconHref ? pad + iconSize + pad : pad;
        const textWidth = width - x - pad;
        const nameSize = fit(textWidth, height * 0.2);
        const summarySize = Math.round(height * 0.085);
        const rows = lines(summarySize, textWidth, 3);
        const block = nameSize * 1.1 + rows.length * summarySize * 1.4;
        const top = (height - block) / 2 + nameSize;
        if (input.iconHref)
            icon = `<image x="${pad}" y="${Math.round((height - iconSize) / 2)}" width="${iconSize}" height="${iconSize}" xlink:href="${esc(input.iconHref)}"/>`;
        body =
            `<text x="${x}" y="${Math.round(top)}" font-size="${nameSize}" font-weight="700">${esc(input.name)}</text>` +
            rows
                .map(
                    (row, index) =>
                        `<text x="${x}" y="${Math.round(top + summarySize * 1.5 + index * summarySize * 1.4)}" font-size="${summarySize}" opacity="0.9">${esc(row)}</text>`,
                )
                .join('');
    } else {
        const iconSize = Math.round(height * 0.34);
        const iconTop = Math.round(height * 0.1);
        const textWidth = width * 0.86;
        const nameSize = fit(textWidth, height * 0.12);
        const summarySize = Math.round(height * 0.065);
        const rows = lines(summarySize, textWidth, 2);
        const nameY = (input.iconHref ? iconTop + iconSize : iconTop) + Math.round(height * 0.14);
        const centre = Math.round(width / 2);
        if (input.iconHref)
            icon = `<image x="${Math.round((width - iconSize) / 2)}" y="${iconTop}" width="${iconSize}" height="${iconSize}" xlink:href="${esc(input.iconHref)}"/>`;
        body =
            `<text x="${centre}" y="${nameY}" font-size="${nameSize}" font-weight="700" text-anchor="middle">${esc(input.name)}</text>` +
            rows
                .map(
                    (row, index) =>
                        `<text x="${centre}" y="${Math.round(nameY + summarySize * 1.6 + index * summarySize * 1.4)}" font-size="${summarySize}" opacity="0.9" text-anchor="middle">${esc(row)}</text>`,
                )
                .join('');
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${esc(input.background)}"/>${icon}<g font-family="Cantarell, Inter, sans-serif" fill="${esc(input.foreground)}">${body}</g></svg>`;
}

export const promoFileName = (spec: Pick<PromoSpec, 'kind' | 'width' | 'height'>) =>
    `promo-${spec.kind}-${spec.width}x${spec.height}.png`;
