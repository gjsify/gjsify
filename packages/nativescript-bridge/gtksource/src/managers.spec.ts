import { describe, expect, it } from '@gjsify/unit';
import { learnStyle, learnStyleDark, sixAssemblerLang } from '@gjsify/gtksource-core/fixtures';

import { LanguageManager } from './language-manager.js';
import { paletteOf, StyleSchemeManager } from './style-scheme.js';
import { TokenStyler } from './token-styler.js';

export default async () => {
    await describe('gtksource-nativescript: managers', async () => {
        await it('registers a language and guesses it by glob and mime type', () => {
            const manager = new LanguageManager();
            const language = manager.addLanguageFromXml(sixAssemblerLang);
            expect(manager.getLanguage('6502-assembler')).toBe(language);
            expect(manager.guessLanguage('/x/prog.asm', null)).toBe(language);
            expect(manager.guessLanguage(null, 'text/x-asm')).toBe(language);
            expect(manager.guessLanguage('prog.txt', null)).toBe(null);
        });

        await it('resolves a Learn6502 scheme through the fallback Adwaita parent', () => {
            const schemes = new StyleSchemeManager();
            const learn = schemes.addSchemeFromXml(learnStyle);
            expect(learn.getStyle('current-line')?.background).toBe('#00000018');
            expect(learn.getStyle('text')?.foundIn).toBe('Adwaita');
            expect(schemes.isFallback('Adwaita')).toBe(true);
        });

        await it('lets a consumer replace the fallback scheme', () => {
            const schemes = new StyleSchemeManager();
            schemes.addSchemeFromXml(
                '<style-scheme id="Adwaita" name="Real"><style name="text" foreground="#111111"/></style-scheme>',
            );
            expect(schemes.isFallback('Adwaita')).toBe(false);
            expect(schemes.getScheme('Adwaita')?.name).toBe('Real');
        });

        await it('finds the dark sibling by naming convention', () => {
            const schemes = new StyleSchemeManager();
            const light = schemes.addSchemeFromXml(learnStyle);
            const dark = schemes.addSchemeFromXml(learnStyleDark);
            expect(schemes.variantOf(light, 'dark').id).toBe(dark.id);
            expect(schemes.variantOf(dark, 'light').id).toBe(light.id);
            expect(schemes.variantOf(light, 'light')).toBe(light);
        });

        await it('reads the editor palette off a scheme', () => {
            const schemes = new StyleSchemeManager();
            const palette = paletteOf(schemes.addSchemeFromXml(learnStyleDark), 'dark');
            expect(palette.dark).toBe(true);
            expect(palette.background).toBe(0xff1e1e1e | 0);
            expect(palette.currentLineBackground).toBe(0x10ffffff);
        });

        await it('styles 6502 tokens through map-to', () => {
            const schemes = new StyleSchemeManager();
            const language = new LanguageManager().addLanguageFromXml(sixAssemblerLang);
            const styler = new TokenStyler(language.definition, schemes.getDefaultFor('light')!);
            const tokens = language.tokenizer.tokenize('lda #$01 ; hi').tokens;
            const runs = styler.runsOf(tokens);
            expect(runs.length > 0).toBe(true);
            const comment = runs[runs.length - 1];
            expect(comment.style.italic).toBe(true);
        });
    });
};
