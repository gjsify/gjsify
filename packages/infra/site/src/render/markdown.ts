import { esc } from './html.js';

/**
 * The subset of Markdown a privacy/legal statement actually uses: headings up to three levels,
 * paragraphs (wrapped lines joined back into one), ordered and unordered lists, GFM pipe tables,
 * a horizontal rule, and inline links/bold/code. Nothing else — this is not a Markdown engine,
 * it is the smallest renderer that can show the statement files consumers already write by hand.
 *
 * Heading levels are shifted up by one (`#`→`h2`, `##`→`h3`, `###`→`h4`): the page already has its
 * own `<h1>` (the page title), and a statement file's own top-level heading restates it.
 */

interface HeadingBlock {
    kind: 'heading';
    level: 2 | 3 | 4;
    text: string;
}
interface ParagraphBlock {
    kind: 'paragraph';
    text: string;
}
interface ListBlock {
    kind: 'list';
    ordered: boolean;
    items: string[];
}
interface TableBlock {
    kind: 'table';
    header: string[];
    rows: string[][];
}
interface HrBlock {
    kind: 'hr';
}
type Block = HeadingBlock | ParagraphBlock | ListBlock | TableBlock | HrBlock;

const HEADING = /^(#{1,3})\s+(.*)$/;
const ORDERED = /^\d+\.\s+(.*)$/;
const UNORDERED = /^[-*]\s+(.*)$/;
const HR = /^-{3,}$/;
const TABLE_SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;

/** One pipe-table row, split on unescaped `|`, outer pipes dropped. */
function splitRow(line: string): string[] {
    return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());
}

function isTableStart(lines: readonly string[], index: number): boolean {
    const line = lines[index];
    const next = lines[index + 1];
    return line !== undefined && line.includes('|') && next !== undefined && TABLE_SEPARATOR.test(next.trim());
}

function isBlockStart(lines: readonly string[], index: number): boolean {
    const line = lines[index]!;
    return (
        line.trim() === '' ||
        HEADING.test(line) ||
        HR.test(line.trim()) ||
        ORDERED.test(line) ||
        UNORDERED.test(line) ||
        isTableStart(lines, index)
    );
}

function parseBlocks(source: string): Block[] {
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const blocks: Block[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i]!;
        if (line.trim() === '') {
            i++;
            continue;
        }
        if (HR.test(line.trim())) {
            blocks.push({ kind: 'hr' });
            i++;
            continue;
        }
        const heading = HEADING.exec(line);
        if (heading) {
            blocks.push({ kind: 'heading', level: (heading[1]!.length + 1) as 2 | 3 | 4, text: heading[2]!.trim() });
            i++;
            continue;
        }
        if (isTableStart(lines, i)) {
            const header = splitRow(line);
            i += 2;
            const rows: string[][] = [];
            while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
                rows.push(splitRow(lines[i]!));
                i++;
            }
            blocks.push({ kind: 'table', header, rows });
            continue;
        }
        if (ORDERED.test(line) || UNORDERED.test(line)) {
            const ordered = ORDERED.test(line);
            const pattern = ordered ? ORDERED : UNORDERED;
            const items: string[] = [];
            while (i < lines.length && pattern.test(lines[i]!)) {
                items.push(pattern.exec(lines[i]!)![1]!.trim());
                i++;
            }
            blocks.push({ kind: 'list', ordered, items });
            continue;
        }
        const paragraph: string[] = [];
        while (i < lines.length && !isBlockStart(lines, i)) {
            paragraph.push(lines[i]!.trim());
            i++;
        }
        blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    }
    return blocks;
}

/** Escapes first, then marks up the already-escaped text — a link's URL and label are both safe. */
function renderInline(text: string): string {
    let html = esc(text);
    html = html.replace(
        /\[([^\]]+)\]\(([^)\s]+)\)/g,
        (_match, label: string, url: string) => `<a href="${url}">${label}</a>`,
    );
    html = html.replace(/`([^`]+)`/g, (_match, code: string) => `<code>${code}</code>`);
    html = html.replace(/\*\*([^*]+)\*\*/g, (_match, bold: string) => `<strong>${bold}</strong>`);
    return html;
}

function renderBlock(block: Block): string {
    switch (block.kind) {
        case 'heading':
            return `<h${block.level}>${renderInline(block.text)}</h${block.level}>`;
        case 'paragraph':
            return `<p>${renderInline(block.text)}</p>`;
        case 'list': {
            const tag = block.ordered ? 'ol' : 'ul';
            return `<${tag}>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`;
        }
        case 'table': {
            const head = `<thead><tr>${block.header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead>`;
            const body = `<tbody>${block.rows
                .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
                .join('')}</tbody>`;
            return `<table>${head}${body}</table>`;
        }
        case 'hr':
            return '<hr>';
    }
}

export function renderMarkdown(source: string): string {
    return parseBlocks(source).map(renderBlock).join('\n');
}
