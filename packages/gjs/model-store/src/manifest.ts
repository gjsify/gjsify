// What a capability package records about each model it can fetch (ADR 0132 § 5).
//
// The manifest stays IN THE PACKAGE THAT USES THE MODEL, as a TS module: the
// store knows how to fetch, verify and place files, never which files exist.
// Every field below is measured from the real file, and `bytes` + `sha256` are
// the whole verification — updating a model means re-measuring both.

/** One file that belongs to a model entry. */
export interface ModelFile {
    /** File name inside the entry directory. Upstream's own name, so a hand-placed file matches. */
    readonly file: string;
    /** Where it is fetched from: upstream, never a mirror of ours (ADR 0132 § 5). */
    readonly url: string;
    /** Exact size in bytes. */
    readonly bytes: number;
    /** SHA-256 of the file, lowercase hex. */
    readonly sha256: string;
}

/** One fetchable model, made of one or more verified files placed together. */
export interface ModelEntry {
    /** Stable id, unique within one store. */
    readonly id: string;
    /** The files that make up this model. Non-empty; file names are unique within the entry. */
    readonly files: readonly ModelFile[];
    /** SPDX id of the MODEL's licence, which is not the package's. */
    readonly license: string;
    /**
     * Whether the licence allows redistributing the files. An app may ship a
     * model in its data dir only when this is `true`; the store fetches from
     * `url` either way.
     */
    readonly redistributable: boolean;
    /** One line for a settings panel or a download prompt. */
    readonly description?: string;
}

const SHA256 = /^[0-9a-f]{64}$/;
const FILE = /^[^/\\]+$/;

/**
 * Throws on the manifest mistakes that would otherwise surface as a refused
 * download much later: a duplicate id, an empty `files` array, a duplicate file
 * name inside one entry, a malformed digest, a size of zero, a non-https URL,
 * or a file name that would escape the entry directory.
 */
export function validateManifest(models: readonly ModelEntry[]): void {
    const ids = new Set<string>();
    for (const model of models) {
        const where = `model '${model.id}'`;
        if (ids.has(model.id)) throw new Error(`Manifest lists ${where} twice`);
        ids.add(model.id);
        if (!Array.isArray(model.files) || model.files.length === 0) {
            throw new Error(`Manifest: ${where} has no files`);
        }
        const files = new Set<string>();
        for (const { file, url, bytes, sha256 } of model.files) {
            if (files.has(file)) throw new Error(`Manifest: ${where} lists file '${file}' twice`);
            files.add(file);
            if (!FILE.test(file) || file === '.' || file === '..') {
                throw new Error(`Manifest: ${where} has file '${file}', which is not a plain file name`);
            }
            if (!SHA256.test(sha256)) throw new Error(`Manifest: ${where} file '${file}' has no lowercase hex sha256`);
            if (!Number.isSafeInteger(bytes) || bytes <= 0) {
                throw new Error(`Manifest: ${where} file '${file}' has size ${bytes}`);
            }
            if (!url.startsWith('https://')) {
                throw new Error(`Manifest: ${where} file '${file}' is not fetched over https`);
            }
        }
        if (model.license.length === 0) throw new Error(`Manifest: ${where} names no licence`);
    }
}
