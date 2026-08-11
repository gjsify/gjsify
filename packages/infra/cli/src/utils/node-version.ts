// SPDX-License-Identifier: MIT
// Node-version preflight for the native install backend.
//
// Its prebuilt binaries are ABI-locked to the Node line gjsify targets (`.nvmrc`).
// On an older major they load a mismatched ABI and SIGSEGV mid-install instead of
// failing cleanly — measured: Node 22 in a Fedora container segfaults
// `gjsify install --backend native` during download/extract. This turns that into
// an actionable error.

import { isNode, gjsSystemVersion } from '@gjsify/rolldown-plugin-gjsify/runtime';

/** Minimum Node major the native install backend supports — keep in sync with `.nvmrc`. */
export const MIN_NODE_MAJOR = 24;

/** Parse the major from a `process.versions.node`-style string (`'24.18.0'` → 24). */
export function parseNodeMajor(version: string): number {
    return Number.parseInt(String(version).split('.', 1)[0] ?? '', 10);
}

/**
 * The preflight verdict, factored out so it can be unit-tested without spawning a
 * foreign Node. `null` (pass) on a supported Node, under GJS, and on a version
 * string that does not parse — an unparseable version must not block an install.
 */
export function nativeBackendNodeError(version: string, onRealNode: boolean): string | null {
    if (!onRealNode) return null;
    const major = parseNodeMajor(version);
    if (!Number.isFinite(major) || major >= MIN_NODE_MAJOR) return null;
    return (
        `gjsify install (native backend) requires Node ≥ ${MIN_NODE_MAJOR}, but this is Node ${version}. ` +
        `Its prebuilt native modules are ABI-locked to Node ${MIN_NODE_MAJOR} and crash on older majors. ` +
        `Use Node ${MIN_NODE_MAJOR} (nvm/asdf locally, actions/setup-node in CI), or run with --backend npm.`
    );
}

/**
 * True when the CLI runs on real Node. GJS must be ruled out FIRST: `@gjsify/process`
 * fakes `process.versions.node = '20.0.0'` for compat, so reading that field would
 * be a false Node positive there (and a false preflight failure, since 20 < 24).
 */
function onRealNode(): boolean {
    const sysVersion = gjsSystemVersion();
    if (sysVersion !== undefined) return false;
    return isNode();
}

/** Throw the preflight verdict as an error; no-op under GJS and on a supported Node. */
export function assertNativeBackendNodeVersion(): void {
    const message = nativeBackendNodeError(process.versions.node, onRealNode());
    if (message) throw new Error(message);
}
