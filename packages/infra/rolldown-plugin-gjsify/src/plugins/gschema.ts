// `./x.gschema.xml?schema` (ADR 0099 § 1): the schema a `Settings` is registered with.
//
// The `.gschema.xml` stays the single source. On the targets with no Gio.Settings (browser,
// NativeScript) the build reads it and emits `{ id, path, keys: { name: { type, default } } }`;
// the runtime never parses XML. On GJS and Node the compiled schema is what GSettings reads
// (`gjsify gsettings` builds it), so the import evaluates to the file's path and is ignored by
// the no-op `Settings.register`.
//
// What the subset cannot honour is refused HERE, naming the key and the line, rather than
// compiled into a schema that behaves differently from GNOME's: a key type outside `b i u d s`,
// `<range>`, `<choices>`, `<enum>`, `<flags>`, `<child>`, `<override>`, and a schema without
// `path` (the storage key is `<path><key>`).

import { readFile } from 'node:fs/promises';

import type { Plugin } from 'rolldown';

export const GSCHEMA_PLUGIN = 'gjsify-gschema';

const KEY_TYPES = new Set(['b', 'i', 'u', 'd', 's']);
const REFUSED_TAGS = ['range', 'choices', 'enum', 'flags', 'child', 'override'];

export interface GschemaKey {
    type: 'b' | 'i' | 'u' | 'd' | 's';
    default: boolean | number | string;
}
export interface GschemaOut {
    id: string;
    path: string;
    keys: Record<string, GschemaKey>;
}

function lineOf(xml: string, index: number): number {
    return xml.slice(0, index).split('\n').length;
}

function attr(tag: string, name: string): string | undefined {
    return new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)
        .exec(tag)
        ?.slice(1)
        .find((v) => v !== undefined);
}

function unescapeXml(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/** GVariant text format for the five supported types. */
function parseDefault(raw: string, type: GschemaKey['type'], where: string): GschemaKey['default'] {
    const text = unescapeXml(raw.trim());
    if (type === 'b') {
        if (text === 'true' || text === 'false') return text === 'true';
    } else if (type === 's') {
        const m = /^(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")$/.exec(text);
        if (m) return (m[1] ?? m[2]).replace(/\\(.)/g, '$1');
    } else {
        const n = Number(text);
        if (text !== '' && Number.isFinite(n) && (type === 'd' || Number.isInteger(n)) && !(type === 'u' && n < 0)) {
            return n;
        }
    }
    throw new Error(`${where}: default '${text}' is not a valid '${type}' value`);
}

export function parseGschema(xml: string, file: string): GschemaOut {
    const source = xml.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
    for (const tag of REFUSED_TAGS) {
        const hit = new RegExp(`<${tag}[\\s>/]`).exec(source);
        if (hit) {
            throw new Error(
                `${file}:${lineOf(source, hit.index)}: <${tag}> is not part of the Gio.Settings subset (ADR 0099 § 1)`,
            );
        }
    }
    const schemas = [...source.matchAll(/<schema\b[^>]*>/g)];
    if (schemas.length !== 1) {
        throw new Error(`${file}: expected exactly one <schema>, found ${schemas.length} (ADR 0099 § 1)`);
    }
    const head = schemas[0];
    const id = attr(head[0], 'id');
    const path = attr(head[0], 'path');
    const at = `${file}:${lineOf(source, head.index!)}`;
    if (!id) throw new Error(`${at}: <schema> has no id`);
    if (!path)
        throw new Error(
            `${at}: <schema id="${id}"> has no path; the browser and Android need one to build a storage key`,
        );

    const keys: Record<string, GschemaKey> = {};
    for (const m of source.matchAll(/<key\b([^>]*)>([\s\S]*?)<\/key>/g)) {
        const where = `${file}:${lineOf(source, m.index!)}`;
        const name = attr(m[1], 'name');
        const type = attr(m[1], 'type');
        if (!name) throw new Error(`${where}: <key> has no name`);
        if (!type || !KEY_TYPES.has(type)) {
            throw new Error(`${where}: key '${name}' has type '${type}'; the subset supports b, i, u, d, s`);
        }
        const def = /<default\b[^>]*>([\s\S]*?)<\/default>/.exec(m[2]);
        if (!def) throw new Error(`${where}: key '${name}' has no <default>`);
        keys[name] = {
            type: type as GschemaKey['type'],
            default: parseDefault(def[1], type as GschemaKey['type'], `${where}: key '${name}'`),
        };
    }
    return { id, path, keys };
}

const SUFFIX = /\.gschema\.xml\?schema(?:&|$)/;

export interface GschemaPluginOptions {
    /** `emit`: the schema object (browser, NativeScript). `ignore`: the file path, for GJS/Node. */
    mode: 'emit' | 'ignore';
}

export function gschemaPlugin({ mode }: GschemaPluginOptions): Plugin {
    return {
        name: GSCHEMA_PLUGIN,
        async resolveId(source, importer) {
            if (!SUFFIX.test(source)) return null;
            const file = source.slice(0, source.indexOf('?'));
            const resolved = await this.resolve(file, importer, { skipSelf: true });
            return resolved === null ? null : `${resolved.id}${source.slice(source.indexOf('?'))}`;
        },
        async load(id) {
            if (!SUFFIX.test(id)) return null;
            const file = id.slice(0, id.indexOf('?'));
            if (mode === 'ignore') return `export default ${JSON.stringify(file)};`;
            const schema = parseGschema(await readFile(file, 'utf8'), file);
            this.addWatchFile(file);
            return `export default ${JSON.stringify(schema)};`;
        },
    };
}
