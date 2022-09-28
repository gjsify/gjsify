declare module 'glsl-tokenizer/string' {

    export interface Options {
        version: '100' | '300 es';
    }

    export type TokenType = 'block-comment' | 'line-comment' | 'preprocessor' | 'operator' | 'float' | 'ident' | 'builtin' | 'eof' | 'integer' | 'whitespace' | 'keyword';

    export interface Token {
        type: TokenType;
        data: string;
        position: number;
        line: number;
        column: number;
    }

    export default function tokenString(src: string, opt?: Options): Token[];
}
