// The keystore-file driver, free of Java — ADR 0152. Everything that is "which bytes go where"
// lives here and is specced off-device; android.ts only supplies the cipher and the files.
//
// One file per namespace holds the whole namespace as AES-256-GCM(JSON). A write replaces the
// file with a fresh random IV; a read re-reads the file, so what `get` returns is what is on
// disk, not a cache.

import type { SecretStore, SecretStoreDriver } from '@gjsify/secret-store';

/**
 * The platform half: sealing keys that never leave the keystore, and app-private files. There
 * is one key per namespace (`keyId`), so forgetting one namespace cannot strand another.
 */
export interface RawBackend {
    /** Returns `iv ‖ ciphertext ‖ tag`. A new IV every call; creates the key on first use. */
    encrypt(keyId: string, plain: Uint8Array): Uint8Array;
    /** Throws when the blob was tampered with or its key is gone. */
    decrypt(keyId: string, blob: Uint8Array): Uint8Array;
    /** Drop the sealing key. The next `encrypt` creates a new one. */
    deleteKey(keyId: string): void;
    /** `null` when the file does not exist. */
    readFile(name: string): Uint8Array | null;
    /** Atomic: a reader sees the old file or the new one, never half of one. */
    writeFileAtomic(name: string, data: Uint8Array): void;
    deleteFile(name: string): void;
}

export interface KeystoreFileOptions {
    /** `clear()` also drops the namespace's sealing key. Default `true`, see the README. */
    dropKeyOnClear?: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A namespace is opaque, so it becomes hex: no path separators, no case-folding clash. */
export function fileNameFor(namespace: string): string {
    let hex = '';
    for (const byte of encoder.encode(namespace)) hex += byte.toString(16).padStart(2, '0');
    return `secrets-${hex}.bin`;
}

/** Never names a key or a value: those are the secret, and an error travels into logs. */
function failure(what: string, cause: unknown): Error {
    const reason = cause instanceof Error ? cause.name : 'unknown error';
    return new Error(`@gjsify/native-secret-store-bridge: ${what} failed (${reason})`);
}

export function createKeystoreFileDriver(
    backend: RawBackend,
    options: KeystoreFileOptions = {},
): SecretStoreDriver {
    const opened = new Map<string, Promise<unknown>>();

    return {
        info: { driver: 'keystore-file', persistent: true, encryptedAtRest: true },
        async open(namespace: string): Promise<SecretStore> {
            const file = fileNameFor(namespace);

            const load = (): Record<string, string> => {
                let blob: Uint8Array | null;
                try {
                    blob = backend.readFile(file);
                } catch (error) {
                    throw failure('reading the secret file', error);
                }
                if (blob === null) return Object.create(null);
                try {
                    return Object.assign(
                        Object.create(null),
                        JSON.parse(decoder.decode(backend.decrypt(file, blob))),
                    );
                } catch (error) {
                    throw failure('decrypting the secret file', error);
                }
            };

            const save = (entries: Record<string, string>): void => {
                try {
                    backend.writeFileAtomic(file, backend.encrypt(file, encoder.encode(JSON.stringify(entries))));
                } catch (error) {
                    throw failure('writing the secret file', error);
                }
            };

            // Read-modify-write per namespace, one at a time: two overlapping `set`s must
            // not lose one of the two keys.
            const serial = <T>(work: () => T): Promise<T> => {
                const previous = opened.get(file) ?? Promise.resolve();
                const next = previous.then(work, work);
                opened.set(file, next.catch(() => undefined));
                return next;
            };

            return {
                namespace,
                get: (key) => serial(() => load()[key] ?? null),
                set: (key, secret) =>
                    serial(() => {
                        const entries = load();
                        entries[key] = secret;
                        save(entries);
                    }),
                delete: (key) =>
                    serial(() => {
                        const entries = load();
                        if (!(key in entries)) return;
                        delete entries[key];
                        save(entries);
                    }),
                keys: () => serial(() => Object.keys(load())),
                clear: () =>
                    serial(() => {
                        try {
                            backend.deleteFile(file);
                            if (options.dropKeyOnClear !== false) backend.deleteKey(file);
                        } catch (error) {
                            throw failure('clearing the namespace', error);
                        }
                    }),
            };
        },
    };
}
