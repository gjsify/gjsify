// The `libsecret` driver: the Secret Service on an unsandboxed Linux desktop (ADR 0152).
//
// One `Secret.Schema` for the whole package; the namespace and the key are its two attributes, so
// "which items belong to this namespace" is a search on `namespace` and nothing else. The calls
// are libsecret's async ones, wrapped over their `_finish`, so a prompt to unlock the keyring
// never blocks the main loop.
//
// The value of a secret is passed to libsecret and back, and appears nowhere else: not in a
// label, not in an attribute, not in an error. An error carries the operation and the message
// the Secret Service itself gave, which is about the service, never about our value.

import type Gio from 'gi://Gio?version=2.0';
import type Secret from 'gi://Secret?version=1';

import type { SecretStore, SecretStoreDriver } from './types.js';

type SecretNamespace = typeof Secret;

export interface LibsecretOptions {
    /** `gi://Secret`, or `undefined` when the typelib is not installed on this host. */
    secret: SecretNamespace | undefined;
    /** Running inside a sandbox (`/.flatpak-info`): libsecret is not chosen silently there. */
    sandboxed: boolean;
}

/** Names the schema in the keyring; part of the stored items, so it must never change. */
export const SCHEMA_NAME = 'org.gjsify.SecretStore';

const PREFIX = '@gjsify/secret-store (libsecret)';

/** Inside a Flatpak the Secret Service is not the way in; the portal is (not built yet). */
export function sandboxedError(): Error {
    return new Error(
        `${PREFIX}: this app runs inside a Flatpak sandbox, where the libsecret driver is not used. ` +
            `The sandboxed driver is 'portal-secret' (org.freedesktop.portal.Secret); it is not implemented yet (ADR 0152, step 3).`,
    );
}

function noTypelibError(): Error {
    return new Error(
        `${PREFIX}: the Secret typelib (libsecret, namespace Secret-1) is not installed on this host. ` +
            `Install libsecret with its GObject introspection data (Fedora: libsecret, Debian/Ubuntu: gir1.2-secret-1).`,
    );
}

function failure(what: string, cause: unknown): Error {
    const reason = cause instanceof Error ? cause.message : 'unknown error';
    return new Error(`${PREFIX}: ${what} failed: ${reason}`);
}

/** A libsecret `*_async` call as a promise: `start` hands over the callback, `finish` reads it. */
function asyncCall<T>(
    start: (callback: Gio.AsyncReadyCallback<any>) => void,
    finish: (result: Gio.AsyncResult) => T,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        try {
            start((_source, result) => {
                try {
                    resolve(finish(result));
                } catch (error) {
                    reject(error);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

export function createLibsecretDriver(options: LibsecretOptions): SecretStoreDriver {
    const { secret, sandboxed } = options;

    if (sandboxed) {
        return {
            get info(): never {
                throw sandboxedError();
            },
            async open(): Promise<SecretStore> {
                throw sandboxedError();
            },
        };
    }

    const info = { driver: 'libsecret', persistent: true, encryptedAtRest: true } as const;

    if (!secret) {
        return {
            info,
            async open(): Promise<SecretStore> {
                throw noTypelibError();
            },
        };
    }

    const api: SecretNamespace = secret;
    const schema = api.Schema.new(SCHEMA_NAME, api.SchemaFlags.NONE, {
        namespace: api.SchemaAttributeType.STRING,
        key: api.SchemaAttributeType.STRING,
    });

    // `Service.get` talks to the bus, so this is where a missing Secret Service is found: at
    // `open`, with its cause named, not at the first `set` of a login form.
    async function requireService(): Promise<void> {
        try {
            await asyncCall(
                (callback) => api.Service.get(api.ServiceFlags.OPEN_SESSION, null, callback),
                (result) => api.Service.get_finish(result),
            );
        } catch (error) {
            throw new Error(
                `${PREFIX}: no Secret Service is reachable on the session bus ` +
                    `(is gnome-keyring, KeePassXC or another provider running?): ${error instanceof Error ? error.message : 'unknown error'}`,
            );
        }
    }

    return {
        info,
        async open(namespace: string): Promise<SecretStore> {
            await requireService();

            const attributesOf = (key?: string): { [name: string]: string } =>
                key === undefined ? { namespace } : { namespace, key };

            async function listKeys(): Promise<string[]> {
                let items: Secret.Retrievable[];
                try {
                    items = await asyncCall(
                        (callback) =>
                            api.password_search(
                                schema,
                                attributesOf(),
                                api.SearchFlags.ALL | api.SearchFlags.UNLOCK,
                                null,
                                callback,
                            ),
                        (result) => api.password_search_finish(result),
                    );
                } catch (error) {
                    throw failure('listing the keys', error);
                }
                const keys = new Set<string>();
                for (const item of items ?? []) {
                    const key = item.get_attributes().key;
                    if (key !== undefined) keys.add(key);
                }
                return [...keys].sort();
            }

            return {
                namespace,
                async get(key) {
                    try {
                        const value = await asyncCall(
                            (callback) => api.password_lookup(schema, attributesOf(key), null, callback),
                            (result) => api.password_lookup_finish(result),
                        );
                        return value === null || value === undefined ? null : value;
                    } catch (error) {
                        throw failure('reading a secret', error);
                    }
                },
                async set(key, value) {
                    try {
                        await asyncCall(
                            (callback) =>
                                api.password_store(
                                    schema,
                                    attributesOf(key),
                                    api.COLLECTION_DEFAULT,
                                    `${namespace}: ${key}`,
                                    value,
                                    null,
                                    callback,
                                ),
                            (result) => api.password_store_finish(result),
                        );
                    } catch (error) {
                        throw failure('storing a secret', error);
                    }
                },
                async delete(key) {
                    try {
                        await asyncCall(
                            (callback) => api.password_clear(schema, attributesOf(key), null, callback),
                            (result) => api.password_clear_finish(result),
                        );
                    } catch (error) {
                        throw failure('deleting a secret', error);
                    }
                },
                keys: listKeys,
                async clear() {
                    try {
                        await asyncCall(
                            (callback) => api.password_clear(schema, attributesOf(), null, callback),
                            (result) => api.password_clear_finish(result),
                        );
                    } catch (error) {
                        throw failure('clearing the namespace', error);
                    }
                    // `password_clear` only removes what is unlocked; "forget this namespace" must
                    // not report success over items it could not reach.
                    const left = await listKeys();
                    if (left.length > 0) {
                        throw new Error(
                            `${PREFIX}: clearing the namespace left ${left.length} item(s); is the keyring locked?`,
                        );
                    }
                },
            };
        },
    };
}
