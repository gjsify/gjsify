import { esc } from './html.js';

/**
 * The subset of Markdown a privacy/legal statement actually uses: headings up to three levels,
 * paragraphs (wrapped lines joined back into one), ordered and unordered lists, GFM pipe tables,
 * a horizontal rule, inline links/bold/code, fenced code blocks, images, blockquotes, and
 * emphasis. Also used for blog posts. Nothing else — this is not a Markdown engine,
 * it is the smallest renderer that can show the statement files consumers already write by hand.
 *
 * Heading levels are shifted up by one (`#`→`h2`, `##`→`h3`, `###`→`h4`): the page already has its
 * own `<h1>` (the page title), and a statement file's own top-level heading restates it.
 */

export interface MarkdownOptions {
    /** Rewrites a link href or image src; absolute and `#` URLs are passed in too. */
    resolveUrl?: (url: string) => string;
}

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
interface CodeBlock {
    kind: 'code';
    lang?: string;
    content: string;
}
interface BlockquoteBlock {
    kind: 'blockquote';
    content: string;
}
interface ImageBlock {
    kind: 'image';
    src: string;
    alt: string;
    title?: string;
    isFigure: boolean;
}
type Block =
    | HeadingBlock
    | ParagraphBlock
    | ListBlock
    | TableBlock
    | HrBlock
    | CodeBlock
    | BlockquoteBlock
    | ImageBlock;

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
    const trimmed = line.trim();
    if (trimmed === '') {
        return true;
    }
    if (HEADING.test(line)) {
        return true;
    }
    if (HR.test(trimmed)) {
        return true;
    }
    if (ORDERED.test(line) || UNORDERED.test(line)) {
        return true;
    }
    if (isTableStart(lines, index)) {
        return true;
    }
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
        return true;
    }
    if (trimmed.startsWith('>')) {
        return true;
    }
    // Image paragraph check - handled separately, but treat as block start
    if (
        /^!\[([^\]]*)\]\([^)]+\)$/.test(trimmed) ||
        /^!\[([^\]]*)\]\([^)]+\s+"[^"]*"\)$/.test(trimmed) ||
        /^!\[([^\]]*)\]\([^)]+\s+'[^']*'\)$/.test(trimmed)
    ) {
        return true;
    }
    return false;
}

function parseBlocks(source: string, options: MarkdownOptions = {}): Block[] {
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const blocks: Block[] = [];
    let i = 0;
    const resolveUrl = options.resolveUrl;
    while (i < lines.length) {
        const line = lines[i]!;
        if (line.trim() === '') {
            i++;
            continue;
        }
        const trimmed = line.trim();
        // Fenced code blocks
        const fenceMatch = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
        if (fenceMatch) {
            const fence = fenceMatch[1]!;
            const fenceChar = fence[0]!;
            const infoString = (fenceMatch[2] || '').trim();
            i++;
            const codeLines: string[] = [];
            while (i < lines.length) {
                const currentLine = lines[i]!;
                const currentTrimmed = currentLine.trim();
                // Check if it's the closing fence
                if (fenceChar === '`') {
                    if (/^`{3,}\s*$/.test(currentTrimmed) && currentTrimmed.length >= fence.length) {
                        i++;
                        break;
                    }
                } else if (fenceChar === '~') {
                    if (/^~{3,}\s*$/.test(currentTrimmed) && currentTrimmed.length >= fence.length) {
                        i++;
                        break;
                    }
                }
                codeLines.push(currentLine);
                i++;
            }
            // Remove trailing newline inside code? "no trailing newline inside code"
            let content = codeLines.join('\n');
            if (content.endsWith('\n')) {
                content = content.slice(0, -1);
            }
            blocks.push({ kind: 'code', lang: infoString || undefined, content });
            continue;
        }
        if (HR.test(trimmed)) {
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
        // Blockquote
        if (trimmed.startsWith('>')) {
            const quoteLines: string[] = [];
            while (i < lines.length) {
                const qline = lines[i]!;
                const qtrimmed = qline.trim();
                if (qtrimmed.startsWith('>')) {
                    // Remove > and optional space
                    const content = qline.replace(/^\s*>\s?/, '');
                    quoteLines.push(content);
                    i++;
                    continue;
                }
                break;
            }
            blocks.push({ kind: 'blockquote', content: quoteLines.join('\n') });
            continue;
        }
        // Image
        const imgMatch =
            trimmed.match(/^!\[([^\]]*)\]\(([^)]+?)(?:\s+"([^"]*)")?\)$/) ||
            trimmed.match(/^!\[([^\]]*)\]\(([^)]+?)(?:\s+'([^']*)')?\)$/);
        if (imgMatch) {
            let src = imgMatch[2]!.trim();
            if (resolveUrl) {
                src = resolveUrl(src);
            }
            const alt = imgMatch[1] || '';
            const title = imgMatch[3];
            blocks.push({ kind: 'image', src, alt, title, isFigure: true });
            i++;
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
function renderInline(text: string, options: MarkdownOptions = {}): string {
    const resolveUrl = options.resolveUrl;
    let html = esc(text);
    // Images
    html = html.replace(
        /!\[([^\]]*)\]\(([^)\s]+?)(?:\s+"([^"]*)")?\)/g,
        (_match, alt: string, src: string, title?: string) => {
            // Groups are from escaped text
            let resolvedSrc = src
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");
            if (resolveUrl) {
                resolvedSrc = resolveUrl(resolvedSrc);
            }
            let altUnesc = alt
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");
            const titleAttr = title ? ` title="${esc(title.replace(/&quot;/g, '"'))}"` : '';
            return `<img src="${esc(resolvedSrc)}" alt="${esc(altUnesc)}" loading="lazy"${titleAttr}>`;
        },
    );
    html = html.replace(
        /!\[([^\]]*)\]\(([^)\s]+?)(?:\s+'([^']*)')?\)/g,
        (_match, alt: string, src: string, title?: string) => {
            let resolvedSrc = src
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");
            if (resolveUrl) {
                resolvedSrc = resolveUrl(resolvedSrc);
            }
            let altUnesc = alt
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");
            const titleAttr = title ? ` title="${esc(title.replace(/&#39;/g, "'"))}"` : '';
            return `<img src="${esc(resolvedSrc)}" alt="${esc(altUnesc)}" loading="lazy"${titleAttr}>`;
        },
    );
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+?)(?:\s+"([^"]*)")?\)/g, (_match, label: string, url: string) => {
        let resolvedUrl = url
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        if (resolveUrl) {
            resolvedUrl = resolveUrl(resolvedUrl);
        }
        return `<a href="${esc(resolvedUrl)}">${label}</a>`;
    });
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+?)(?:\s+'([^']*)')?\)/g, (_match, label: string, url: string) => {
        let resolvedUrl = url
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        if (resolveUrl) {
            resolvedUrl = resolveUrl(resolvedUrl);
        }
        return `<a href="${esc(resolvedUrl)}">${label}</a>`;
    });
    // Also handle links without title
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
        let resolvedUrl = url
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        if (resolveUrl) {
            resolvedUrl = resolveUrl(resolvedUrl);
        }
        return `<a href="${esc(resolvedUrl)}">${label}</a>`;
    });
    html = html.replace(/`([^`]+)`/g, (_match, code: string) => `<code>${code}</code>`);
    // Bold first (** takes precedence) - be careful not to break
    html = html.replace(/\*\*([^*]+?)\*\*/g, (_match, bold: string) => `<strong>${bold}</strong>`);
    // Emphasis with * - single asterisks not part of **
    html = html.replace(/(?<!\*)\*([^*\s][^*]*?|[^*\s])\*(?!\*)/g, (_match, content: string) => {
        return `<em>${content}</em>`;
    });
    // Emphasis with _ - must not break snake_case (no word chars immediately adjacent on both sides)
    // Use word boundary checks
    html = html.replace(
        /(^|[^a-zA-Z0-9])_([^_\s][^_]*?|[^_\s])_([^a-zA-Z0-9]|$)/g,
        (_match, p1: string, content: string, p3: string) => {
            return p1 + `<em>${content}</em>` + p3;
        },
    );
    return html;
}

function renderBlock(block: Block, options: MarkdownOptions = {}): string {
    switch (block.kind) {
        case 'heading':
            return `<h${block.level}>${renderInline(block.text, options)}</h${block.level}>`;
        case 'paragraph':
            // Check if paragraph contains only an image
            const imgOnlyMatch =
                block.text.match(/^!\[([^\]]*)\]\(([^)]+?)(?:\s+"([^"]*)")?\)$/) ||
                block.text.match(/^!\[([^\]]*)\]\(([^)]+?)(?:\s+'([^']*)')?\)$/);
            if (imgOnlyMatch) {
                let src = imgOnlyMatch[2]!.trim();
                if (options.resolveUrl) {
                    src = options.resolveUrl(src);
                }
                const alt = imgOnlyMatch[1] || '';
                const title = imgOnlyMatch[3];
                const titleAttr = title ? ` title="${esc(title)}"` : '';
                if (title) {
                    return `<figure><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"${titleAttr}><figcaption>${esc(title)}</figcaption></figure>`;
                }
                return `<figure><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"${titleAttr}></figure>`;
            }
            return `<p>${renderInline(block.text, options)}</p>`;
        case 'list': {
            const tag = block.ordered ? 'ol' : 'ul';
            return `<${tag}>${block.items.map((item) => `<li>${renderInline(item, options)}</li>`).join('')}</${tag}>`;
        }
        case 'table': {
            const head = `<thead><tr>${block.header.map((cell) => `<th>${renderInline(cell, options)}</th>`).join('')}</tr></thead>`;
            const body = `<tbody>${block.rows
                .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell, options)}</td>`).join('')}</tr>`)
                .join('')}</tbody>`;
            return `<table>${head}${body}</table>`;
        }
        case 'hr':
            return '<hr>';
        case 'code': {
            if (block.lang) {
                return `<pre><code class="language-${esc(block.lang)}">${esc(block.content)}</code></pre>`;
            }
            return `<pre><code>${esc(block.content)}</code></pre>`;
        }
        case 'blockquote': {
            const inner = parseBlocks(block.content, options)
                .map((b) => renderBlock(b, options))
                .join('\n');
            return `<blockquote>${inner}</blockquote>`;
        }
        case 'image': {
            const titleAttr = block.title ? ` title="${esc(block.title)}"` : '';
            if (block.title && block.isFigure) {
                return `<figure><img src="${esc(block.src)}" alt="${esc(block.alt)}" loading="lazy"${titleAttr}><figcaption>${esc(block.title)}</figcaption></figure>`;
            }
            if (block.isFigure) {
                return `<figure><img src="${esc(block.src)}" alt="${esc(block.alt)}" loading="lazy"${titleAttr}></figure>`;
            }
            return `<img src="${esc(block.src)}" alt="${esc(block.alt)}" loading="lazy"${titleAttr}>`;
        }
    }
}

export function renderMarkdown(source: string, options: MarkdownOptions = {}): string {
    return parseBlocks(source, options)
        .map((b) => renderBlock(b, options))
        .join('\n');
}
