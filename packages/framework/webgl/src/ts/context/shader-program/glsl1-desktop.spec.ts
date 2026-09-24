// The GLSL ES 1.00 → desktop respelling, checked without a GL context.
//
// `webgl1.spec.ts` proves a respelled shader compiles and draws on the hosts
// that need it (macOS). What a draw cannot show is WHAT the consumer sees when
// it goes wrong — which line an error names — and the branches a working
// shader never takes: `: require`, the extension left disabled, a consumer
// identifier that desktop GLSL claims.

import { describe, expect, it } from '@gjsify/unit';
import { translateGlsl1ToDesktop, usesStandardDerivatives } from './glsl1-desktop.js';

/** Replay `#line` the way GLSL ≥ 3.30 does: map each emitted line to the number an error would print. */
const numberLines = (glsl: string): Array<{ n: number; text: string }> => {
    const out: Array<{ n: number; text: string }> = [];
    let n = 1;
    for (const text of glsl.split('\n')) {
        const directive = /^\s*#\s*line\s+(\d+)/.exec(text);
        if (directive) {
            n = Number(directive[1]);
            continue;
        }
        out.push({ n, text });
        n += 1;
    }
    return out;
};

const DERIV_FS = [
    '#extension GL_OES_standard_derivatives : require',
    'precision mediump float;',
    'uniform sampler2D texture;',
    'varying vec2 vUv;',
    'void main() {',
    '#ifdef GL_OES_standard_derivatives',
    '    float d = fwidth(vUv.x);',
    '#else',
    '    float d = 0.0;',
    '#endif',
    '    gl_FragColor = texture2D(texture, vUv) * d;',
    '}',
].join('\n');

export default async () => {
    await describe('translateGlsl1ToDesktop', async () => {
        await it('recognises derivative calls and nothing else', async () => {
            expect(usesStandardDerivatives(DERIV_FS)).toBe(true);
            expect(usesStandardDerivatives('void main() { float dFdxScale = 1.0; }')).toBe(false);
        });

        await it('keeps every consumer line at its own number', async () => {
            const out = numberLines(translateGlsl1ToDesktop(DERIV_FS, 'fragment', '410', '', true));
            const consumer = DERIV_FS.split('\n');
            // `void main() {` is line 5 of the consumer's source and must be line 5
            // of the respelled one — the number a compile error would print.
            const main = out.find((l) => l.text === 'void main() {');
            expect(main?.n).toBe(consumer.indexOf('void main() {') + 1);
            const last = out.find((l) => l.text.includes('gl_FragColor = '));
            expect(last?.n).toBe(11);
        });

        await it('replaces `#version 100` without shifting the lines below it', async () => {
            const src = '#version 100\nprecision mediump float;\nvoid main() { gl_FragColor = vec4(dFdx(1.0)); }';
            const glsl = translateGlsl1ToDesktop(src, 'fragment', '410', '', true);
            expect(glsl.startsWith('#version 410\n')).toBe(true);
            expect(glsl.includes('version 100')).toBe(false);
            expect(numberLines(glsl).find((l) => l.text.startsWith('void main'))?.n).toBe(3);
        });

        await it('comments out the ES extension directive, `: require` included', async () => {
            const glsl = translateGlsl1ToDesktop(DERIV_FS, 'fragment', '410', '', true);
            expect(/^\s*#\s*extension/m.test(glsl)).toBe(false);
            expect(glsl.includes('// #extension GL_OES_standard_derivatives : require')).toBe(true);
        });

        await it('answers `#ifdef GL_OES_standard_derivatives` by whether the consumer enabled it', async () => {
            const on = translateGlsl1ToDesktop(DERIV_FS, 'fragment', '410', '', true);
            const off = translateGlsl1ToDesktop(DERIV_FS, 'fragment', '410', '', false);
            // No reserved `GL_` macro is ever defined, undefined or tested.
            for (const glsl of [on, off]) {
                expect(/#\s*(?:define|undef|ifdef|if)\s+GL_/.test(glsl)).toBe(false);
                expect(glsl.includes('#ifdef GJSIFY_OES_standard_derivatives')).toBe(true);
            }
            expect(on.includes('#define GJSIFY_OES_standard_derivatives 1')).toBe(true);
            expect(off.includes('#define GJSIFY_OES_standard_derivatives')).toBe(false);
        });

        await it('renames consumer identifiers desktop GLSL claims, not the ES built-ins', async () => {
            const glsl = translateGlsl1ToDesktop(DERIV_FS, 'fragment', '410', '', true);
            expect(glsl.includes('uniform sampler2D gjsify_texture;')).toBe(true);
            expect(glsl.includes('texture2D(gjsify_texture, vUv)')).toBe(true);
            expect(glsl.includes('#define texture2D texture')).toBe(true);
        });

        await it('declares the fragment output after the directives and maps the ES names', async () => {
            const glsl = translateGlsl1ToDesktop(DERIV_FS, 'fragment', '410', '', true);
            expect(glsl.includes('#define varying in')).toBe(true);
            expect(glsl.indexOf('out vec4 gjsify_FragColor;')).toBeGreaterThan(glsl.indexOf('// #extension'));
            const vs = translateGlsl1ToDesktop(
                'attribute vec2 p; varying vec2 v;\nvoid main() {}',
                'vertex',
                '410',
                '',
                true,
            );
            expect(vs.includes('#define attribute in')).toBe(true);
            expect(vs.includes('#define varying out')).toBe(true);
            expect(vs.includes('gjsify_FragColor')).toBe(false);
        });
    });
};
