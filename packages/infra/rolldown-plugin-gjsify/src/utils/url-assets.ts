// Sibling assets a bundled node_modules file loads with `new URL('./x.wasm', import.meta.url)`.
//
// The module-resolve shim answers such a URL from the installed package, and when no
// `node_modules` sits beside the bundle it falls back to the BUNDLE file itself — so the
// asset is looked up as `<bundle dir>/<relative path>`. `gjsify ship` stages the bundle
// directory wholesale, so copying the asset to exactly that place at build time makes dev and
// ship agree; when `node_modules` IS present the original path still wins (the shim resolves
// the package first). Real case: `@mtcute/wasm` loading `./mtcute-simd.wasm`.

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

import { parseSource } from './inline-static-reads.js';

/** Code is bundled, never copied: a `new URL` to one of these is a module reference. */
const CODE_EXT_RE = /\.(?:[cm]?[jt]sx?|node)$/i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export interface UrlAsset {
    /** Absolute path of the asset beside the original source file. */
    source: string;
    /** Bundle-dir-relative, POSIX-separated destination the runtime fallback resolves to. */
    dest: string;
}

interface Node {
    type?: string;
    [key: string]: unknown;
}

function isImportMetaUrl(node: Node | undefined): boolean {
    const object = node?.object as Node | undefined;
    const property = node?.property as Node | undefined;
    return (
        node?.type === 'MemberExpression' &&
        !node.computed &&
        object?.type === 'MetaProperty' &&
        property?.name === 'url'
    );
}

/** String-literal specifiers of every `new URL(<literal>, import.meta.url)` in `src`. */
function urlLiterals(src: string, path: string): string[] {
    let ast: unknown;
    try {
        ast = parseSource(src, path);
    } catch {
        // acorn trails the bundler on new syntax; no detection beats a failed build.
        return [];
    }
    const out: string[] = [];
    const stack: unknown[] = [ast];
    while (stack.length > 0) {
        const node = stack.pop() as Node | null;
        if (node === null || typeof node !== 'object') continue;
        if (Array.isArray(node)) {
            stack.push(...node);
            continue;
        }
        const callee = node.callee as Node | undefined;
        const args = node.arguments as Node[] | undefined;
        if (
            node.type === 'NewExpression' &&
            callee?.type === 'Identifier' &&
            callee.name === 'URL' &&
            args?.length === 2 &&
            args[0].type === 'Literal' &&
            typeof args[0].value === 'string' &&
            isImportMetaUrl(args[1])
        ) {
            out.push(args[0].value);
        }
        for (const value of Object.values(node)) if (value !== null && typeof value === 'object') stack.push(value);
    }
    return out;
}

/**
 * The non-code files `src` (living at `path`) references through `new URL(<literal>,
 * import.meta.url)` that exist on disk. JS/TS modules, non-literal specifiers, absolute or
 * scheme URLs, and anything that would land outside the bundle directory are ignored.
 */
export function findUrlAssets(src: string, path: string): UrlAsset[] {
    if (!src.includes('import.meta.url') || !src.includes('new URL')) return [];
    const assets: UrlAsset[] = [];
    for (const spec of new Set(urlLiterals(src, path))) {
        if (spec === '' || spec.startsWith('/') || SCHEME_RE.test(spec) || /[?#]/.test(spec)) continue;
        if (CODE_EXT_RE.test(spec)) continue;
        const dest = normalize(spec);
        if (isAbsolute(dest) || dest === '..' || dest.startsWith(`..${sep}`)) continue;
        const source = resolve(dirname(path), spec);
        if (!existsSync(source) || !statSync(source).isFile()) continue;
        assets.push({ source, dest: dest.split(sep).join('/') });
    }
    return assets;
}

/** Collects assets over a build; first source wins a destination, a clash is reported. */
export class UrlAssets {
    readonly #byDest = new Map<string, string>();

    add(asset: UrlAsset): string | null {
        const known = this.#byDest.get(asset.dest);
        if (known === undefined) {
            this.#byDest.set(asset.dest, asset.source);
            return null;
        }
        return known === asset.source
            ? null
            : `${asset.dest} is wanted from both ${known} and ${asset.source}; keeping the first`;
    }

    entries(): UrlAsset[] {
        return [...this.#byDest].map(([dest, source]) => ({ dest, source }));
    }

    /** Copy every collected asset beside the bundle; returns the bundle-relative files written. */
    writeTo(bundleDir: string): string[] {
        const written: string[] = [];
        for (const { source, dest } of this.entries()) {
            const target = join(bundleDir, dest);
            if (relative(bundleDir, target).startsWith('..')) continue;
            mkdirSync(dirname(target), { recursive: true });
            copyFileSync(source, target);
            written.push(dest);
        }
        return written;
    }
}
