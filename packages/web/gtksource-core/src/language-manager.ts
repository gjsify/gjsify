// GtkSource.Language and GtkSource.LanguageManager over `@gjsify/gtksource-core`.
//
// Nothing is bundled: `def.lang` and the stock languages are LGPL data, so the manager starts
// empty and the consumer adds the `.lang` files it ships (Learn6502 adds its 6502 grammar).

import { parseLanguage } from './lang.js';
import { Tokenizer } from './tokenizer.js';
import type { LanguageDefinition } from './types.js';

const splitList = (value: string | undefined): string[] =>
    (value ?? '')
        .split(';')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');

/** `*.asm`-style globs, matched against a whole file name, case-sensitively like GtkSourceView. */
function globMatches(glob: string, name: string): boolean {
    const source = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${source}$`).test(name);
}

export class Language {
    private cached: Tokenizer | undefined;

    constructor(readonly definition: LanguageDefinition) {}

    get id(): string {
        return this.definition.id;
    }

    get name(): string {
        return this.definition.name ?? this.definition.id;
    }

    get section(): string {
        return this.definition.section ?? 'Others';
    }

    get globs(): string[] {
        return splitList(this.definition.metadata['globs']);
    }

    get mimeTypes(): string[] {
        return splitList(this.definition.metadata['mimetypes']);
    }

    /** Built on first use: compiling every pattern is the expensive part of loading a language. */
    get tokenizer(): Tokenizer {
        return (this.cached ??= new Tokenizer(this.definition));
    }
}

export class LanguageManager {
    private static instance: LanguageManager | undefined;

    /** `GtkSource.LanguageManager.get_default()`. */
    static getDefault(): LanguageManager {
        return (LanguageManager.instance ??= new LanguageManager());
    }

    /** GJS spelling of {@link getDefault}. */
    static get_default(): LanguageManager {
        return LanguageManager.getDefault();
    }

    private readonly languages = new Map<string, Language>();

    get languageIds(): string[] {
        return [...this.languages.keys()].sort();
    }

    /**
     * Parses and registers a `.lang` file. Constructs the core does not model land in
     * `language.definition.unsupported`; pass `strict` to throw on them instead.
     */
    addLanguageFromXml(xml: string, options: { strict?: boolean } = {}): Language {
        const language = new Language(parseLanguage(xml, options));
        this.languages.set(language.id, language);
        return language;
    }

    getLanguage(id: string): Language | null {
        return this.languages.get(id) ?? null;
    }

    /** GJS spelling of {@link getLanguage}. */
    get_language(id: string): Language | null {
        return this.getLanguage(id);
    }

    /** `gtk_source_language_manager_guess_language()`: by file name first, then by content type. */
    guessLanguage(filename: string | null, contentType: string | null): Language | null {
        const all = [...this.languages.values()].sort((a, b) => a.id.localeCompare(b.id));
        if (filename !== null) {
            // posix-path-ok: both separators are taken, so a win32 path splits the same way.
            const base = filename.slice(Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1);
            const byName = all.find((language) => language.globs.some((glob) => globMatches(glob, base)));
            if (byName) return byName;
        }
        if (contentType !== null) return all.find((language) => language.mimeTypes.includes(contentType)) ?? null;
        return null;
    }
}
