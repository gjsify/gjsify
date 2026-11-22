import type { SecretStore, SecretStoreDriver, SecretStoreInfo } from './types.js';

let installed: SecretStoreDriver | null = null;

/** Install the driver of this platform, or `null` to remove it. Called by driver packages and tests. */
export function useSecretStoreDriver(driver: SecretStoreDriver | null): void {
    installed = driver;
}

function platformName(): string {
    const proc = (globalThis as { process?: { platform?: string } }).process;
    return proc?.platform ?? 'this platform';
}

// No fallback on purpose: an app that cannot keep its own password is broken, and a silent
// downgrade to plaintext would hide that (ADR 0101: a refusal throws).
function requireDriver(): SecretStoreDriver {
    if (!installed) {
        throw new Error(`@gjsify/secret-store has no driver for ${platformName()}`);
    }
    return installed;
}

/** Throws, naming the platform, where this build has no driver (ADR 0101). */
export async function openSecretStore(namespace: string): Promise<SecretStore> {
    return requireDriver().open(namespace);
}

/** Diagnostics only; throws like `openSecretStore` where there is no driver. */
export function secretStoreInfo(): SecretStoreInfo {
    return requireDriver().info;
}
