// The prompt formats an instruction-tuned embedding model was trained on, and
// cutting input to its context. Pure, so neither needs the native addon.

import type { EmbedDocument } from './engine.js';
import type { EmbeddingModelEntry } from './llama-models.js';

type Templates = Pick<EmbeddingModelEntry, 'queryTemplate' | 'documentTemplate' | 'emptyTitle'>;

export function queryPrompt(model: Templates, text: string): string {
    return model.queryTemplate.replace('{text}', () => text);
}

/** The title goes into its own field only; repeating it in the text would weigh it twice. */
export function documentPrompt(model: Templates, document: EmbedDocument): string {
    const title = document.title?.trim() || model.emptyTitle;
    return model.documentTemplate.replace('{title}', () => title).replace('{text}', () => document.text);
}

/** The two tokenizer calls {@link fitTokens} needs; a loaded model has both. */
export interface Tokenizing {
    tokenize(text: string): readonly number[];
    detokenize(tokens: readonly number[]): string;
}

/** Room for the begin and end tokens the model adds around the text. */
const SPECIAL_TOKEN_ROOM = 8;

/**
 * Cut the text to what a context of `contextTokens` holds. A character limit
 * is only a guess: digits and rare scripts cost about one token per
 * character, and llama.cpp rejects an over-long input instead of truncating.
 */
export function fitTokens(model: Tokenizing, text: string, contextTokens: number): string {
    const limit = contextTokens - SPECIAL_TOKEN_ROOM;
    const tokens = model.tokenize(text);
    if (tokens.length <= limit) return text;
    return model.detokenize(tokens.slice(0, limit));
}
