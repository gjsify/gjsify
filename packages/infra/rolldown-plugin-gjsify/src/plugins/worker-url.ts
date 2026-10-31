// `new Worker(new URL('./x.ts', import.meta.url))` — ship the worker next to the bundle.
//
// A bundle is ONE file, so after `gjsify build` the literal still names `./x.ts`, a path
// that exists beside the SOURCE and nowhere beside the artifact: at runtime the Worker dies
// with `Cannot find module …/x.ts` (#2338). esbuild and Vite turn the same expression into a
// second entry and rewrite the URL; this does the same.
//
// THE SPLIT, AND WHY IT IS NOT ALL IN THE PLUGIN. A plugin could `emitFile` the worker as a
// chunk, but the native rolldown engine (`@gjsify/rolldown-native`, the only engine under
// GJS) exposes no `emitFile` — `applyBrowserHtml` is a CLI step for the same reason. So the
// plugin does the half every engine can do, the URL rewrite, and records each worker it saw
// in a {@link WorkerEntries} registry; the CLI then bundles every registered source as its
// own app build, next to the main output, with the main build's config. A nested build runs
// this plugin again, so a worker that starts a worker is followed with no extra rule, and the
// shared registry is what ends a cycle (a worker that spawns itself).
//
// WHAT COUNTS. `new <Worker>(new URL(<string literal>, import.meta.url), …)` where `<Worker>`
// is the identifier `Worker` (the WHATWG global from `@gjsify/web-worker`, or the name imported
// from `worker_threads` — also under an alias) or a `<x>.Worker` member (`wt.Worker`,
// `import * as wt`). Anything else is left byte-identical, on purpose: a computed specifier
// has no build-time answer, and a rewrite of the wrong `new URL` would break a program that
// was fine.
//
// WHY AN AST: `new Worker(new URL(` inside a string, a comment or a template shares the bytes
// of the shape. The parser is the shared one (`utils/inline-static-reads.ts`), so a `.ts`
// source arrives with its type syntax intact.

import { basename, extname } from 'node:path';
import type { Plugin } from 'rolldown';

import { parseSource } from '../utils/inline-static-reads.js';
import { REWRITE_FILTER } from './rewrite-node-modules-paths.js';

export const WORKER_URL_PLUGIN = 'gjsify-worker-url';

const WORKER_THREADS = /^(?:node:)?worker_threads$/;

interface SrcNode {
    readonly type: string;
    readonly start: number;
    readonly end: number;
    readonly name?: string;
    readonly value?: unknown;
    readonly raw?: string;
    readonly computed?: boolean;
    readonly callee?: SrcNode;
    readonly arguments?: readonly SrcNode[];
    readonly object?: SrcNode;
    readonly property?: SrcNode;
    readonly meta?: SrcNode;
    readonly source?: SrcNode;
    readonly specifiers?: readonly SrcNode[];
    readonly imported?: SrcNode;
    readonly local?: SrcNode;
}

/** One `new URL('<spec>', import.meta.url)` argument of a Worker constructor. */
export interface WorkerUrlSite {
    /** The specifier as written — what the registry resolves relative to the importer. */
    readonly specifier: string;
    /** Inclusive start offset of the string literal, quotes included. */
    readonly start: number;
    /** Exclusive end offset of the string literal. */
    readonly end: number;
}

function childrenOf(node: SrcNode): SrcNode[] {
    const out: SrcNode[] = [];
    for (const value of Object.values(node as unknown as Record<string, unknown>)) {
        const items = Array.isArray(value) ? value : [value];
        for (const item of items) {
            if (item !== null && typeof item === 'object' && typeof (item as { type?: unknown }).type === 'string') {
                out.push(item as SrcNode);
            }
        }
    }
    return out;
}

/** Local names that `worker_threads`' `Worker` is bound to — `import { Worker as W }` yields `W`. */
function workerAliases(program: SrcNode): Set<string> {
    const aliases = new Set(['Worker']);
    for (const stmt of childrenOf(program)) {
        if (stmt.type !== 'ImportDeclaration' || typeof stmt.source?.value !== 'string') continue;
        if (!WORKER_THREADS.test(stmt.source.value)) continue;
        for (const spec of stmt.specifiers ?? []) {
            if (spec.type === 'ImportSpecifier' && spec.imported?.name === 'Worker' && spec.local?.name) {
                aliases.add(spec.local.name);
            }
        }
    }
    return aliases;
}

function isWorkerCallee(callee: SrcNode | undefined, aliases: ReadonlySet<string>): boolean {
    if (!callee) return false;
    if (callee.type === 'Identifier') return callee.name !== undefined && aliases.has(callee.name);
    return (
        callee.type === 'MemberExpression' &&
        callee.computed !== true &&
        callee.property?.type === 'Identifier' &&
        callee.property.name === 'Worker'
    );
}

function isImportMetaUrl(node: SrcNode | undefined): boolean {
    return (
        node?.type === 'MemberExpression' &&
        node.computed !== true &&
        node.property?.name === 'url' &&
        node.object?.type === 'MetaProperty' &&
        node.object.meta?.name === 'import'
    );
}

/** The `new URL('<literal>', import.meta.url)` shape, as the literal node, or null. */
function urlLiteral(node: SrcNode | undefined): SrcNode | null {
    if (node?.type !== 'NewExpression' || node.callee?.type !== 'Identifier' || node.callee.name !== 'URL') return null;
    const [spec, base] = node.arguments ?? [];
    if (spec?.type !== 'Literal' || typeof spec.value !== 'string') return null;
    return isImportMetaUrl(base) ? spec : null;
}

/** Every Worker constructor in `code` that names its script by a literal URL, source order. */
export function findWorkerUrls(code: string, id: string): WorkerUrlSite[] {
    let program: SrcNode;
    try {
        program = parseSource(code, id) as unknown as SrcNode;
    } catch {
        // A module the pinned parser cannot read keeps its literal; the bundler reports the parse itself.
        return [];
    }
    const aliases = workerAliases(program);
    const sites: WorkerUrlSite[] = [];
    const stack: SrcNode[] = [program];
    while (stack.length > 0) {
        const node = stack.pop() as SrcNode;
        if (node.type === 'NewExpression' && isWorkerCallee(node.callee, aliases)) {
            const literal = urlLiteral(node.arguments?.[0]);
            if (literal) {
                sites.push({ specifier: literal.value as string, start: literal.start, end: literal.end });
            }
        }
        for (const child of childrenOf(node)) stack.push(child);
    }
    return sites.sort((a, b) => a.start - b.start);
}

/** Only a relative specifier names a file beside the importer; `file:`, `http:` and `/abs` do not. */
const isRelative = (specifier: string) => /^\.\.?\//.test(specifier);

/**
 * What a worker script is called next to the bundle, and which sources still need building.
 *
 * ONE instance per `gjsify build`, shared with every nested worker build: the name a source
 * gets must be the same in the bundle that spawns it and in the one that spawns it from
 * another worker, and a source already built must not be built again.
 */
export class WorkerEntries {
    readonly #names = new Map<string, string>();
    readonly #taken = new Set<string>();
    readonly #built = new Set<string>();

    /** @param extension the main bundle's extension (`.js`, `.mjs`), mirrored so a worker loads like its parent. */
    constructor(readonly extension: string = '.js') {}

    /** The file name (no directory) the worker built from `source` gets beside the bundle. */
    register(source: string): string {
        const known = this.#names.get(source);
        if (known !== undefined) return known;
        const stem = basename(source, extname(source));
        let name = `${stem}.worker${this.extension}`;
        // Two sources with one stem (`a/worker.ts`, `b/worker.ts`) must not overwrite each other.
        if (this.#taken.has(name)) name = `${stem}-${pathHash(source)}.worker${this.extension}`;
        this.#taken.add(name);
        this.#names.set(source, name);
        return name;
    }

    /** Registered sources not yet handed out, with their file names; each is returned once. */
    takePending(): { source: string; fileName: string }[] {
        const pending: { source: string; fileName: string }[] = [];
        for (const [source, fileName] of this.#names) {
            if (this.#built.has(source)) continue;
            this.#built.add(source);
            pending.push({ source, fileName });
        }
        return pending;
    }
}

/** FNV-1a over the path, base 36 — stable across builds and engines, no crypto dependency. */
function pathHash(path: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < path.length; i++) {
        hash ^= path.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

/** `code` with each resolvable worker URL pointed at its emitted file, or null when nothing changed. */
export async function rewriteWorkerUrls(
    code: string,
    id: string,
    resolveSource: (specifier: string) => Promise<string | null>,
    entries: WorkerEntries,
): Promise<string | null> {
    const sites = findWorkerUrls(code, id).filter((site) => isRelative(site.specifier));
    if (sites.length === 0) return null;
    let out = code;
    let changed = false;
    // Descending, so each splice leaves the offsets of the ones before it valid.
    for (const site of sites.sort((a, b) => b.start - a.start)) {
        const source = await resolveSource(site.specifier);
        if (source === null) continue;
        out = `${out.slice(0, site.start)}${JSON.stringify(`./${entries.register(source)}`)}${out.slice(site.end)}`;
        changed = true;
    }
    return changed ? out : null;
}

/**
 * Composed by `--app gjs|node|browser` when the CLI hands over a {@link WorkerEntries}; absent
 * registry, absent plugin — a library build keeps its `new URL` for the consumer's own bundler.
 */
export function workerUrlPlugin(entries: WorkerEntries): Plugin {
    return {
        name: WORKER_URL_PLUGIN,
        transform: {
            filter: { id: REWRITE_FILTER },
            async handler(code, id) {
                if (!REWRITE_FILTER.test(id)) return null;
                // Cheap gate: the parse is paid only by a module that can contain the shape.
                if (!code.includes('import.meta.url') || !code.includes('Worker')) return null;
                const out = await rewriteWorkerUrls(
                    code,
                    id,
                    async (specifier) => {
                        const resolved = await this.resolve(specifier, id);
                        if (!resolved || resolved.external) {
                            this.warn(`${id}: cannot resolve worker script ${specifier}; left as written`);
                            return null;
                        }
                        return resolved.id.split('?')[0];
                    },
                    entries,
                );
                return out === null ? null : { code: out, map: null };
            },
        },
    };
}
