// Incremental highlighting: keep one tokenizer result per line and, after an edit, re-tokenize
// only the lines it replaced plus however many following lines still start in a different
// context than before (a `/*` typed on line 3 re-colours down to the matching `*/`, and stops
// there — not at the end of the document).

import type { LineResult, LineState, Token, Tokenizer } from '@gjsify/gtksource-core';
import { INITIAL_STATE } from '@gjsify/gtksource-core';

/** Lines `first..last`, both inclusive. */
export interface LineRange {
    readonly first: number;
    readonly last: number;
}

/** `lines[first .. first + removed)` of the old text are now `lines[first .. first + inserted)`. */
export interface LineEdit {
    readonly first: number;
    readonly removed: number;
    readonly inserted: number;
}

/**
 * Two line states are the same when the same span contexts are open. The tokenizer hands out
 * the same node object for the same context every time (its candidate lists are cached), so
 * identity is the right comparison; if it ever returned fresh nodes this would only cost
 * speed — the propagation would run to the end of the document — never correctness.
 */
export function sameState(a: LineState, b: LineState): boolean {
    if (a.stack.length !== b.stack.length) return false;
    return a.stack.every((node, index) => node === b.stack[index]);
}

export class IncrementalHighlighter {
    private results: LineResult[] = [];

    constructor(readonly tokenizer: Tokenizer) {}

    get lineCount(): number {
        return this.results.length;
    }

    tokensOf(line: number): readonly Token[] {
        const result = this.results[line];
        if (!result)
            throw new RangeError(`IncrementalHighlighter: line ${line} is outside 0..${this.results.length - 1}`);
        return result.tokens;
    }

    /** Tokenizes the whole text; returns the range now valid, `null` for no lines. */
    reset(lines: readonly string[]): LineRange | null {
        this.results = [];
        let state = INITIAL_STATE;
        for (const line of lines) {
            const result = this.tokenizer.tokenize(line, state);
            this.results.push(result);
            state = result.state;
        }
        return lines.length === 0 ? null : { first: 0, last: lines.length - 1 };
    }

    /**
     * Applies one line edit. `lines` is the NEW full text, already edited. Returns the lines
     * whose tokens were recomputed — the ones a renderer must repaint.
     */
    update(lines: readonly string[], edit: LineEdit): LineRange {
        const { first, removed, inserted } = edit;
        if (first < 0 || removed < 1 || inserted < 1 || first + removed > this.results.length) {
            throw new RangeError(
                `IncrementalHighlighter: edit ${JSON.stringify(edit)} does not fit ${this.results.length} lines`,
            );
        }
        if (lines.length !== this.results.length - removed + inserted) {
            throw new RangeError(`IncrementalHighlighter: ${lines.length} lines do not match the edit`);
        }

        // What the old text's last replaced line ended in: where the new text must end up
        // for everything after it to keep its tokens.
        let expected: LineState = this.results[first + removed - 1].state;
        const fresh = Array.from({ length: inserted }, () => undefined as unknown as LineResult);
        this.results.splice(first, removed, ...fresh);

        let line = first;
        let state = first === 0 ? INITIAL_STATE : this.results[first - 1].state;
        for (; line < first + inserted; line++) {
            const result = this.tokenizer.tokenize(lines[line], state);
            this.results[line] = result;
            state = result.state;
        }
        let last = first + inserted - 1;

        while (!sameState(state, expected) && line < lines.length) {
            // The line sitting here still holds its old result, whose end state is what the
            // next one was computed against.
            expected = this.results[line].state;
            const result = this.tokenizer.tokenize(lines[line], state);
            this.results[line] = result;
            state = result.state;
            last = line;
            line++;
        }
        return { first, last };
    }
}
