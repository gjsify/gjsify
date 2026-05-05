// `extractTarball()` — decompress + parse + write to disk. Cross-platform
// (Node + GJS) — node:fs is polyfilled by @gjsify/fs on GJS.

import * as fs from "node:fs";
import * as path from "node:path";

import { type TarEntry, parseTar } from "./parser.js";

export interface ExtractOptions {
    /**
     * Strip N leading path components from every entry name. npm tarballs put
     * everything under `package/`, so the default is 1 (matches `npm install`).
     */
    strip?: number;
    /** Filter — return false to skip an entry. */
    filter?: (entry: TarEntry, resolvedPath: string) => boolean;
    /** Override file mode bits (after umask). Useful for `.bin/` to add +x. */
    chmod?: (entry: TarEntry, resolvedPath: string) => number | undefined;
    /** Reject entries whose resolved path escapes destDir. Default: true. */
    preventEscape?: boolean;
    /** Treat input as gzipped. Default: auto-detect via gzip magic bytes. */
    gzip?: boolean;
}

export interface ExtractResult {
    files: string[];
    directories: string[];
    symlinks: string[];
    skipped: number;
}

/** Extract a `.tar` or `.tar.gz` buffer into `destDir`, creating dirs as needed. */
export async function extractTarball(
    input: Uint8Array | ArrayBuffer,
    destDir: string,
    opts: ExtractOptions = {},
): Promise<ExtractResult> {
    const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
    const isGz = opts.gzip ?? (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b);
    const tarBytes = isGz ? await gunzip(buf) : buf;
    const entries = parseTar(tarBytes);

    fs.mkdirSync(destDir, { recursive: true });

    const strip = opts.strip ?? 1;
    const preventEscape = opts.preventEscape ?? true;
    const result: ExtractResult = { files: [], directories: [], symlinks: [], skipped: 0 };

    for (const entry of entries) {
        const stripped = stripComponents(entry.name, strip);
        if (stripped === null || stripped === "") {
            result.skipped++;
            continue;
        }
        const resolved = path.resolve(destDir, stripped);
        if (preventEscape && !isInside(resolved, destDir)) {
            throw new Error(
                `tar: refusing to extract ${entry.name} outside ${destDir} (resolved=${resolved})`,
            );
        }
        if (opts.filter && !opts.filter(entry, resolved)) {
            result.skipped++;
            continue;
        }

        if (entry.type === "directory") {
            fs.mkdirSync(resolved, { recursive: true });
            result.directories.push(resolved);
            continue;
        }
        if (entry.type === "file") {
            fs.mkdirSync(path.dirname(resolved), { recursive: true });
            fs.writeFileSync(resolved, entry.body);
            const overrideMode = opts.chmod?.(entry, resolved);
            const finalMode = overrideMode ?? (entry.mode & 0o777);
            if (finalMode > 0) {
                try {
                    fs.chmodSync(resolved, finalMode);
                } catch {
                    /* mode-set is best-effort — Windows-style FS will reject */
                }
            }
            result.files.push(resolved);
            continue;
        }
        if (entry.type === "symlink") {
            fs.mkdirSync(path.dirname(resolved), { recursive: true });
            try {
                fs.symlinkSync(entry.linkname, resolved);
                result.symlinks.push(resolved);
            } catch {
                // Symlinks may fail on platforms without permission (Windows).
                // Fall back to writing the link target as a plain file so the
                // package layout is still complete.
                fs.writeFileSync(resolved, entry.linkname);
                result.files.push(resolved);
            }
            continue;
        }
        // hardlink/unknown/PAX/GNU-* — count as skipped.
        result.skipped++;
    }

    return result;
}

/** Decompress a gzip buffer using Web DecompressionStream (cross-platform). */
export async function gunzip(input: Uint8Array): Promise<Uint8Array> {
    const Decomp = (globalThis as { DecompressionStream?: typeof DecompressionStream })
        .DecompressionStream;
    if (typeof Decomp !== "function") {
        throw new Error(
            "@gjsify/tar: globalThis.DecompressionStream is not available — " +
                "import '@gjsify/compression-streams/register' on GJS to register it",
        );
    }
    const stream = new Blob([new Uint8Array(input)]).stream().pipeThrough(new Decomp("gzip"));
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = stream.getReader();
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        chunks.push(chunk);
        total += chunk.length;
    }
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
        out.set(c, pos);
        pos += c.length;
    }
    return out;
}

function stripComponents(name: string, n: number): string | null {
    if (n <= 0) return name;
    const parts = name.split("/").filter((s) => s !== "");
    if (parts.length <= n) return null;
    return parts.slice(n).join("/");
}

function isInside(child: string, parent: string): boolean {
    const rel = path.relative(parent, child);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
