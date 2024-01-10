/**
 * Extracts code blocks from a Markdown string.
 * @param markdown - The Markdown string.
 * @returns An array of code blocks.
 */
export function extractCodeBlocks(markdown: string): string[] {
    const codeBlockRegex = /^```[\s\S]*?^```/gm;
    const codeBlocks = markdown.match(codeBlockRegex);
    if(!codeBlocks) return [];
    return codeBlocks.map(block => removeCodeLines(block).trim());
}

/**
 * Removes markdown code lines like ```rust ... ``` from a code block.
 */
export function removeCodeLines(codeBlock: string): string {
    const codeLineRegex = /^```[a-z]*(\n|$)/gm;
    return codeBlock.replace(codeLineRegex, '');
}

/**
 * Detect language of a Markdown code block.
 */
export function detectLanguage(codeBlock: string): string {
    const languageRegex = /```([a-z]*)/g;
    const language = (codeBlock.match(languageRegex) || [])[1];
    return language || 'unknown';
}