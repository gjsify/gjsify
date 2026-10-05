import { translateRegex, UnsupportedRegexError } from './regex.js';
import type { ContextNode, LanguageDefinition, LanguageStyle, PatternSource, Unsupported } from './types.js';
import { childElements, parseXml, textContent } from './xml.js';
import type { XmlElement } from './xml.js';

export interface ParseLanguageOptions {
    /** Throw, listing every unsupported construct, instead of returning them in `unsupported`. */
    readonly strict?: boolean;
}

const LANGUAGE_ATTRIBUTES = ['id', 'name', '_name', 'version', '_section'];
const STYLE_ATTRIBUTES = ['id', 'name', '_name', 'map-to'];
const CONTEXT_ATTRIBUTES = ['id', 'style-ref', 'end-at-line-end', 'sub-pattern', 'ref'];
const PATTERN_ATTRIBUTES = ['extended'];
const CONTEXT_CHILDREN = ['match', 'start', 'end', 'keyword', 'prefix', 'suffix', 'include'];

/**
 * The regex GtkSourceView puts before and after a `<keyword>` list when the context gives no
 * `<prefix>`/`<suffix>`: `\%[` and `\%]`, a word boundary on each side.
 */
export function keywordPattern(context: ContextNode): string {
    const prefix = context.prefix ?? '\\%[';
    const suffix = context.suffix ?? '\\%]';
    return `${prefix}(?:${context.keywords.join('|')})${suffix}`;
}

function describe(element: XmlElement): string {
    const id = element.attributes.id ?? element.attributes.ref;
    return id === undefined
        ? element.name
        : `${element.name}[${element.attributes.id !== undefined ? 'id' : 'ref'}=${id}]`;
}

class Reader {
    readonly unsupported: Unsupported[] = [];
    readonly styleIds = new Set<string>();
    readonly contextIds = new Set<string>();
    readonly styleRefs: { value: string; where: string }[] = [];
    readonly refs: { value: string; where: string }[] = [];

    flag(construct: string, where: string): void {
        this.unsupported.push({ construct, where });
    }

    attributes(element: XmlElement, allowed: readonly string[], where: string): void {
        for (const name of Object.keys(element.attributes)) {
            if (!allowed.includes(name)) this.flag(`attribute ${name}`, where);
        }
    }

    pattern(element: XmlElement, where: string): PatternSource {
        this.attributes(element, PATTERN_ATTRIBUTES, where);
        const source = textContent(element);
        const extended = element.attributes.extended === 'true';
        try {
            translateRegex(source, { extended });
        } catch (error) {
            if (!(error instanceof UnsupportedRegexError)) throw error;
            this.flag(`regex: ${error.construct}`, where);
        }
        return { source, extended };
    }

    context(element: XmlElement, parentPath: string): ContextNode {
        const where = `${parentPath}/${describe(element)}`;
        this.attributes(element, CONTEXT_ATTRIBUTES, where);

        const id = element.attributes.id;
        if (id !== undefined) this.contextIds.add(id);
        const styleRef = element.attributes['style-ref'];
        if (styleRef !== undefined) this.styleRefs.push({ value: styleRef, where });
        const ref = element.attributes.ref;
        if (ref !== undefined) this.refs.push({ value: ref, where });
        const subPattern = element.attributes['sub-pattern'];

        let match: PatternSource | undefined;
        let start: PatternSource | undefined;
        let end: PatternSource | undefined;
        let prefix: string | undefined;
        let suffix: string | undefined;
        const keywords: string[] = [];
        const include: ContextNode[] = [];

        for (const child of childElements(element)) {
            const childWhere = `${where}/${child.name}`;
            if (!CONTEXT_CHILDREN.includes(child.name)) {
                this.flag(`element ${child.name}`, where);
            } else if (child.name === 'match') match = this.pattern(child, childWhere);
            else if (child.name === 'start') start = this.pattern(child, childWhere);
            else if (child.name === 'end') end = this.pattern(child, childWhere);
            else if (child.name === 'keyword') keywords.push(textContent(child).trim());
            else if (child.name === 'prefix') prefix = textContent(child).trim();
            else if (child.name === 'suffix') suffix = textContent(child).trim();
            else {
                this.attributes(child, [], childWhere);
                for (const nested of childElements(child)) {
                    if (nested.name === 'context') include.push(this.context(nested, childWhere));
                    else this.flag(`element ${nested.name}`, childWhere);
                }
            }
        }

        return {
            id,
            styleRef,
            endAtLineEnd: element.attributes['end-at-line-end'] === 'true',
            subPattern: subPattern === undefined ? undefined : Number.parseInt(subPattern, 10),
            ref,
            match,
            start,
            end,
            keywords,
            prefix,
            suffix,
            include,
        };
    }
}

/**
 * Parses a GtkSourceView 5 `.lang` file into a tree. What it does not model (`extend-parent`,
 * `once-only`, `<define-regex>`, `<replace>`, cross-language references, patterns the JS regex
 * engine cannot run, a `ref` or `style-ref` with no target, …) lands in `unsupported` with its
 * path — or throws with `strict`. Nothing is ever dropped without a trace.
 */
export function parseLanguage(xml: string, options: ParseLanguageOptions = {}): LanguageDefinition {
    const root = parseXml(xml);
    const reader = new Reader();
    if (root.name !== 'language') throw new Error(`parseLanguage: root element is <${root.name}>, not <language>`);
    reader.attributes(root, LANGUAGE_ATTRIBUTES, 'language');

    const metadata: Record<string, string> = {};
    const styles: LanguageStyle[] = [];
    const definitions: ContextNode[] = [];

    for (const section of childElements(root)) {
        if (section.name === 'metadata') {
            for (const property of childElements(section)) {
                const name = property.attributes.name;
                if (property.name !== 'property' || name === undefined)
                    reader.flag(`element ${property.name}`, 'language/metadata');
                else metadata[name] = textContent(property).trim();
            }
        } else if (section.name === 'styles') {
            for (const style of childElements(section)) {
                const where = `language/styles/${describe(style)}`;
                reader.attributes(style, STYLE_ATTRIBUTES, where);
                const id = style.attributes.id;
                if (style.name !== 'style' || id === undefined) {
                    reader.flag(`element ${style.name}`, 'language/styles');
                    continue;
                }
                reader.styleIds.add(id);
                styles.push({
                    id,
                    name: style.attributes.name ?? style.attributes._name,
                    mapTo: style.attributes['map-to'],
                });
            }
        } else if (section.name === 'definitions') {
            for (const context of childElements(section)) {
                if (context.name === 'context') definitions.push(reader.context(context, 'language/definitions'));
                else reader.flag(`element ${context.name}`, 'language/definitions');
            }
        } else {
            reader.flag(`element ${section.name}`, 'language');
        }
    }

    for (const { value, where } of reader.styleRefs) {
        if (value.includes(':')) {
            if (!value.startsWith('def:')) reader.flag(`cross-language style-ref ${value}`, where);
        } else if (!reader.styleIds.has(value)) reader.flag(`style-ref ${value} names no style`, where);
    }
    for (const { value, where } of reader.refs) {
        if (value.includes(':')) reader.flag(`cross-language ref ${value}`, where);
        else if (!reader.contextIds.has(value)) reader.flag(`ref ${value} names no context`, where);
    }

    const id = root.attributes.id;
    if (id === undefined) throw new Error('parseLanguage: <language> has no id');
    if (options.strict && reader.unsupported.length > 0) {
        const list = reader.unsupported.map((entry) => `${entry.construct} at ${entry.where}`).join('; ');
        throw new Error(`parseLanguage(${id}): unsupported constructs: ${list}`);
    }

    return {
        id,
        name: root.attributes.name ?? root.attributes._name,
        version: root.attributes.version,
        section: root.attributes._section,
        metadata,
        styles,
        definitions,
        unsupported: reader.unsupported,
    };
}
