/** What a store does. Opaque namespaces; two namespaces never see each other. */
export interface SecretStore {
    readonly namespace: string;
    /** The stored secret, or `null` when this namespace has no such key. */
    get(key: string): Promise<string | null>;
    /** Store or replace. The value is never logged, cached or put in an error by this package. */
    set(key: string, secret: string): Promise<void>;
    /** Missing is not an error. */
    delete(key: string): Promise<void>;
    /** Keys only, never values — for cleaning up after an account the app removed. */
    keys(): Promise<string[]>;
    /** Forget this namespace: sign-out, account removal, "delete my data". */
    clear(): Promise<void>;
}

/** Diagnostics for an about dialog or a bug report. An app reports it; it never branches on it. */
export interface SecretStoreInfo {
    readonly driver: 'libsecret' | 'portal-secret' | 'keystore-file' | 'keychain' | 'memory';
    /** False when the secrets live only as long as the process. */
    readonly persistent: boolean;
    /** False when nothing but file permissions protects the bytes. */
    readonly encryptedAtRest: boolean;
}

/** One platform's implementation, installed with `useSecretStoreDriver`. */
export interface SecretStoreDriver {
    readonly info: SecretStoreInfo;
    open(namespace: string): Promise<SecretStore>;
}
