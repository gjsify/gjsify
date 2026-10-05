import type { ResolvedStyle, SchemeColor, SchemeStyle, StyleSchemeDefinition, Unsupported } from './types.js';
import { childElements, parseXml, textContent } from './xml.js';

const SCHEME_ATTRIBUTES = ['id', 'name', '_name', 'parent-scheme', 'version'];
const KNOWN_STYLE_ATTRIBUTES = [
    'name',
    'foreground',
    'background',
    'line-background',
    'bold',
    'italic',
    'strikethrough',
    'underline',
];

const asBoolean = (value: string | undefined): boolean | undefined =>
    value === undefined ? undefined : value === 'true';

/** Parses a GtkSourceView 5 style scheme. Attributes it does not interpret are kept in `extra`; unknown elements are reported. */
export function parseStyleScheme(xml: string): StyleSchemeDefinition {
    const root = parseXml(xml);
    if (root.name !== 'style-scheme')
        throw new Error(`parseStyleScheme: root element is <${root.name}>, not <style-scheme>`);
    const id = root.attributes.id;
    if (id === undefined) throw new Error('parseStyleScheme: <style-scheme> has no id');

    const unsupported: Unsupported[] = [];
    for (const name of Object.keys(root.attributes)) {
        if (!SCHEME_ATTRIBUTES.includes(name))
            unsupported.push({ construct: `attribute ${name}`, where: 'style-scheme' });
    }

    const authors: string[] = [];
    const colors: SchemeColor[] = [];
    const styles: SchemeStyle[] = [];
    for (const child of childElements(root)) {
        if (child.name === 'author') {
            authors.push(textContent(child).trim());
        } else if (child.name === 'description') {
            continue;
        } else if (child.name === 'color') {
            const { name, value } = child.attributes;
            if (name === undefined || value === undefined)
                unsupported.push({ construct: 'color without name or value', where: 'style-scheme/color' });
            else colors.push({ name, value });
        } else if (child.name === 'style') {
            const name = child.attributes.name;
            if (name === undefined) {
                unsupported.push({ construct: 'style without name', where: 'style-scheme/style' });
                continue;
            }
            const extra: Record<string, string> = {};
            for (const [key, value] of Object.entries(child.attributes)) {
                if (!KNOWN_STYLE_ATTRIBUTES.includes(key)) extra[key] = value;
            }
            const attributes = child.attributes;
            styles.push({
                name,
                foreground: attributes.foreground,
                background: attributes.background,
                lineBackground: attributes['line-background'],
                bold: asBoolean(attributes.bold),
                italic: asBoolean(attributes.italic),
                strikethrough: asBoolean(attributes.strikethrough),
                underline: attributes.underline,
                extra,
            });
        } else {
            unsupported.push({ construct: `element ${child.name}`, where: 'style-scheme' });
        }
    }

    return {
        id,
        name: root.attributes.name ?? root.attributes._name,
        parentScheme: root.attributes['parent-scheme'],
        version: root.attributes.version,
        authors,
        colors,
        styles,
        unsupported,
    };
}

/** Where {@link resolveStyle} finds the scheme a `parent-scheme` id names. */
export type SchemeLookup = (id: string) => StyleSchemeDefinition | undefined;

/**
 * Resolves `styleName` the way GtkSourceView does: the scheme's own style wins, otherwise the
 * `parent-scheme` chain is walked; a colour value that names a `<color>` is replaced by it
 * (looked up in the scheme the style was found in, then its ancestors). A language style's
 * `map-to="def:keyword"` resolves by passing `def:keyword` as the name. A `parent-scheme` loop,
 * or a parent the lookup does not know, throws: it is a broken install, not a missing style.
 */
export function resolveStyle(
    scheme: StyleSchemeDefinition,
    styleName: string,
    lookup: SchemeLookup,
): ResolvedStyle | undefined {
    const chain: StyleSchemeDefinition[] = [];
    for (let current: StyleSchemeDefinition | undefined = scheme; current;) {
        if (chain.some((seen) => seen.id === current?.id)) {
            throw new Error(`style scheme ${scheme.id}: parent-scheme loop through ${current.id}`);
        }
        chain.push(current);
        if (current.parentScheme === undefined) break;
        current = lookup(current.parentScheme);
        if (current === undefined)
            throw new Error(
                `style scheme ${chain[chain.length - 1].id}: parent-scheme ${chain[chain.length - 1].parentScheme} not found`,
            );
    }

    const foundAt = chain.findIndex((candidate) => candidate.styles.some((style) => style.name === styleName));
    if (foundAt === -1) return undefined;
    const style = chain[foundAt].styles.find((candidate) => candidate.name === styleName);
    if (style === undefined) return undefined;

    const color = (value: string | undefined): string | undefined => {
        if (value === undefined) return undefined;
        for (const candidate of chain.slice(foundAt)) {
            const named = candidate.colors.find((entry) => entry.name === value);
            if (named) return named.value;
        }
        return value;
    };

    return {
        name: styleName,
        foundIn: chain[foundAt].id,
        foreground: color(style.foreground),
        background: color(style.background),
        lineBackground: color(style.lineBackground),
        bold: style.bold,
        italic: style.italic,
        strikethrough: style.strikethrough,
        underline: style.underline,
    };
}
