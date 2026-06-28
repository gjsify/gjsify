// SPDX-License-Identifier: MIT
// Node-version preflight for the native install backend.
//
// The native backend composes native deps whose prebuilt binaries are ABI-locked
// to the Node line gjsify targets (see `.nvmrc`). On an older Node major they load
// a mismatched ABI and SIGSEGV mid-install instead of failing cleanly — a
// confusing crash with no actionable message (observed: Node 22 in a Fedora
// container segfaults `gjsify install --backend native` during download/extract).
// This preflight turns that into a clear, actionable error.

import { isNode } from '@gjsify/rolldown-plugin-gjsify/runtime';

/**
 * Minimum Node.js major the native install backend supports — its prebuilt native
 * modules are ABI-locked to this line (kept in sync with `.nvmrc`).
 */
export const MIN_NODE_MAJOR = 24;

/** Parse the major from a `process.versions.node`-style string (`'24.18.0'` → 24). */
export function parseNodeMajor(version: string): number {
    return Number.parseInt(String(version).split('.', 1)[0] ?? '', 10);
}

/**
 * The preflight verdict for the native install backend, factored out so it can be
 * unit-tested without spawning a foreign Node. Returns an error message when the
 * runtime is real Node older than {@link MIN_NODE_MAJOR}, else `null` — i.e. on a
 * supported Node, on GJS (which fakes `process.versions.node` and does not use
 * these prebuilds), or on a version string that does not parse.
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

/** True when the CLI runs on real Node — NOT GJS, which fakes `process.versions.node`. */
function onRealNode(): boolean {
    // GJS exposes `imports.system.version`; @gjsify/process fakes
    // `process.versions.node = '20.0.0'` for compat, so check GJS FIRST — a plain
    // `process.versions.node` read would be a false Node positive under GJS.
    const sysVersion = (globalThis as { imports?: { system?: { version?: number } } }).imports?.system?.version;
    if (sysVersion !== undefined) return false;
    return isNode();
}

/**
 * Guard the native install backend: throw a clear error on an unsupported Node
 * major instead of letting the ABI-mismatched prebuilds SIGSEGV mid-install.
 * No-op under GJS and on supported Node.
 */
export function assertNativeBackendNodeVersion(): void {
    const message = nativeBackendNodeError(process.versions.node, onRealNode());
    if (message) throw new Error(message);
}
