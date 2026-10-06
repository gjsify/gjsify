import { keywordPattern } from './lang.js';
import { translateRegex } from './regex.js';
import type { ContextNode, LanguageDefinition, PatternSource } from './types.js';

/** A styled run of one line. `style` is the context's `style-ref`: a language style id or a `def:` name. */
export interface Token {
    readonly start: number;
    readonly end: number;
    readonly style: string;
}

/** What carries from one line to the next: the span contexts still open, outermost first. */
export interface LineState {
    readonly stack: readonly ContextNode[];
}

export const INITIAL_STATE: LineState = { stack: [] };

export interface LineResult {
    readonly tokens: readonly Token[];
    readonly state: LineState;
}

interface Candidate {
    readonly node: ContextNode;
    readonly kind: 'match' | 'span';
    readonly regex: RegExp;
    readonly subPatterns: readonly ContextNode[];
}

/** The first match at or after `from`; an empty match does not count unless `allowEmpty`, so no pattern can stall the scan. */
function search(regex: RegExp, line: string, from: number, allowEmpty = false): RegExpExecArray | null {
    regex.lastIndex = from;
    for (;;) {
        const found = regex.exec(line);
        if (!found) return null;
        if (allowEmpty || found[0].length > 0) return found;
        regex.lastIndex = found.index + 1;
        if (regex.lastIndex > line.length) return null;
    }
}

const compile = (pattern: PatternSource, flags: string): RegExp =>
    translateRegex(pattern.source, { extended: pattern.extended, flags });

/**
 * Highlights a language line by line, the way GtkSourceView's context engine reads a `.lang`:
 * inside a span the earliest of its end and its children wins (the end first on a tie), at the
 * top level the earliest child wins (the one defined first on a tie), a `<context ref>` and an
 * id-less container are flattened into their parent, text inside a span keeps the span's style
 * unless a child overrides it, and `sub-pattern` children colour a capture group of their parent.
 *
 * Deliberately not modelled (see {@link parseLanguage}'s `unsupported`): `extend-parent`,
 * `once-only`, `\%{id@start}` back references, case-insensitive contexts.
 */
export class Tokenizer {
    readonly root: ContextNode;

    private readonly byId = new Map<string, ContextNode>();
    private readonly candidatesOf = new Map<ContextNode, readonly Candidate[]>();
    private readonly endOf = new Map<ContextNode, RegExp>();

    constructor(language: LanguageDefinition) {
        const index = (nodes: readonly ContextNode[]): void => {
            for (const node of nodes) {
                if (node.id !== undefined) this.byId.set(node.id, node);
                index(node.include);
            }
        };
        index(language.definitions);
        const root = this.byId.get(language.id) ?? language.definitions[0];
        if (root === undefined) throw new Error(`Tokenizer: language ${language.id} has no definitions`);
        this.root = root;
    }

    /** Tokenizes one line (without its newline) from the state the previous line ended in. */
    tokenize(line: string, state: LineState = INITIAL_STATE): LineResult {
        const stack = [...state.stack];
        const tokens: Token[] = [];
        let pos = 0;

        const emit = (start: number, end: number, style: string | undefined): void => {
            if (end <= start || style === undefined) return;
            const last = tokens[tokens.length - 1];
            if (last && last.end === start && last.style === style)
                tokens[tokens.length - 1] = { start: last.start, end, style };
            else tokens.push({ start, end, style });
        };
        const baseStyle = (): string | undefined => {
            for (let i = stack.length - 1; i >= 0; i--) {
                const style = stack[i].styleRef;
                if (style !== undefined) return style;
            }
            return undefined;
        };

        for (;;) {
            const owner = stack.length > 0 ? stack[stack.length - 1] : this.root;
            const endRegex = stack.length > 0 ? this.endRegex(owner) : undefined;
            const end = endRegex ? search(endRegex, line, pos, true) : null;

            let best: { candidate: Candidate; found: RegExpExecArray } | undefined;
            for (const candidate of this.candidates(owner)) {
                const found = search(candidate.regex, line, pos);
                if (found && (!best || found.index < best.found.index)) best = { candidate, found };
            }

            if (end && (!best || end.index <= best.found.index)) {
                emit(pos, end.index, baseStyle());
                emit(end.index, end.index + end[0].length, owner.styleRef ?? baseStyle());
                stack.pop();
                pos = end.index + end[0].length;
                continue;
            }
            if (!best) {
                emit(pos, line.length, baseStyle());
                break;
            }

            const { candidate, found } = best;
            const inherited = baseStyle();
            const style = candidate.node.styleRef ?? inherited;
            const from = found.index;
            const to = from + found[0].length;
            emit(pos, from, inherited);
            if (candidate.kind === 'span') {
                emit(from, to, style);
                stack.push(candidate.node);
            } else {
                this.emitMatch(found, style, candidate.subPatterns, emit);
            }
            pos = to;
        }

        while (stack.length > 0 && stack[stack.length - 1].endAtLineEnd) stack.pop();
        return { tokens, state: { stack } };
    }

    /** Tokenizes a whole text, line by line, carrying the state; the result has one entry per line. */
    tokenizeText(text: string): readonly LineResult[] {
        const results: LineResult[] = [];
        let state = INITIAL_STATE;
        for (const line of text.split('\n')) {
            const result = this.tokenize(line, state);
            results.push(result);
            state = result.state;
        }
        return results;
    }

    private emitMatch(
        found: RegExpExecArray,
        style: string | undefined,
        subPatterns: readonly ContextNode[],
        emit: (start: number, end: number, style: string | undefined) => void,
    ): void {
        const from = found.index;
        const to = from + found[0].length;
        const indices = found.indices;
        const pieces: { start: number; end: number; style: string | undefined }[] = [];
        for (const sub of subPatterns) {
            const range =
                sub.subPattern === undefined
                    ? undefined
                    : sub.subPattern === 0
                      ? [from, to]
                      : indices?.[sub.subPattern];
            if (range) pieces.push({ start: range[0], end: range[1], style: sub.styleRef ?? style });
        }
        pieces.sort((a, b) => a.start - b.start);
        let cursor = from;
        for (const piece of pieces) {
            if (piece.start < cursor) continue;
            emit(cursor, piece.start, style);
            emit(piece.start, piece.end, piece.style);
            cursor = piece.end;
        }
        emit(cursor, to, style);
    }

    private endRegex(span: ContextNode): RegExp {
        let regex = this.endOf.get(span);
        if (!regex) {
            if (!span.end) throw new Error(`Tokenizer: span context ${span.id ?? '(anonymous)'} has no <end>`);
            regex = compile(span.end, 'g');
            this.endOf.set(span, regex);
        }
        return regex;
    }

    private candidates(owner: ContextNode): readonly Candidate[] {
        const cached = this.candidatesOf.get(owner);
        if (cached) return cached;

        const out: Candidate[] = [];
        const visiting = new Set<ContextNode>();
        const visit = (children: readonly ContextNode[]): void => {
            for (const child of children) {
                let node = child;
                if (child.ref !== undefined) {
                    const target = this.byId.get(child.ref);
                    if (!target) continue;
                    node = { ...target, styleRef: child.styleRef ?? target.styleRef };
                }
                if (node.subPattern !== undefined && !node.match && !node.start && node.keywords.length === 0) continue;
                const subPatterns = node.include.filter((sub) => sub.subPattern !== undefined);
                if (node.match) {
                    out.push({ node, kind: 'match', regex: compile(node.match, 'gd'), subPatterns });
                } else if (node.keywords.length > 0) {
                    out.push({
                        node,
                        kind: 'match',
                        regex: translateRegex(keywordPattern(node), { extended: false, flags: 'gd' }),
                        subPatterns,
                    });
                } else if (node.start) {
                    out.push({ node, kind: 'span', regex: compile(node.start, 'g'), subPatterns: [] });
                } else {
                    const key = child.ref !== undefined ? (this.byId.get(child.ref) ?? node) : node;
                    if (visiting.has(key)) continue;
                    visiting.add(key);
                    visit(node.include);
                    visiting.delete(key);
                }
            }
        };
        visit(owner.include);

        this.candidatesOf.set(owner, out);
        return out;
    }
}

/**
 * The scheme style a token takes: a `def:` name is looked up as it stands, a language style id goes
 * through its `map-to`, and a style with neither is addressed as `<language>:<id>` like GtkSourceView.
 */
export function schemeStyleName(language: LanguageDefinition, style: string): string {
    if (style.startsWith('def:')) return style;
    return language.styles.find((entry) => entry.id === style)?.mapTo ?? `${language.id}:${style}`;
}
