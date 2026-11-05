// What a capability package records about each model it can fetch (ADR 0132 § 5).
//
// The manifest stays IN THE PACKAGE THAT USES THE MODEL, as a TS module: the
// store knows how to fetch, verify and place a file, never which files exist.
// Every field below is measured from the real file, and `bytes` + `sha256` are
// the whole verification — updating a model means re-measuring both.

/** One fetchable model. Capability packages extend it with their own fields. */
export interface ModelEntry {
    /** Stable id, unique within one store. */
    readonly id: string;
    /** File name inside the cache directory. Upstream's own name, so a hand-placed file matches. */
    readonly file: string;
    /** Where it is fetched from: upstream, never a mirror of ours (ADR 0132 § 5). */
    readonly url: string;
    /** Exact size in bytes. */
    readonly bytes: number;
    /** SHA-256 of the file, lowercase hex. */
    readonly sha256: string;
    /** SPDX id of the MODEL's licence, which is not the package's. */
    readonly license: string;
    /**
     * Whether the licence allows redistributing the file. An app may ship a
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
 * download much later: a duplicate id or file, a malformed digest, a size of
 * zero, a non-https URL, or a file name that would escape the cache dir.
 */
export function validateManifest(models: readonly ModelEntry[]): void {
    const ids = new Set<string>();
    const files = new Set<string>();
    for (const model of models) {
        const where = `model '${model.id}'`;
        if (ids.has(model.id)) throw new Error(`Manifest lists ${where} twice`);
        if (files.has(model.file)) throw new Error(`Manifest: ${where} reuses file '${model.file}'`);
        ids.add(model.id);
        files.add(model.file);
        if (!FILE.test(model.file) || model.file === '.' || model.file === '..') {
            throw new Error(`Manifest: ${where} has file '${model.file}', which is not a plain file name`);
        }
        if (!SHA256.test(model.sha256)) throw new Error(`Manifest: ${where} has no lowercase hex sha256`);
        if (!Number.isSafeInteger(model.bytes) || model.bytes <= 0) {
            throw new Error(`Manifest: ${where} has size ${model.bytes}`);
        }
        if (!model.url.startsWith('https://')) throw new Error(`Manifest: ${where} is not fetched over https`);
        if (model.license.length === 0) throw new Error(`Manifest: ${where} names no licence`);
    }
}
