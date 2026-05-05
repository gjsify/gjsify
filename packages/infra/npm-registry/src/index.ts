// npm registry client for the gjsify install backend.
// Cross-platform (Node + GJS) - uses globalThis.fetch + SubtleCrypto only.
// Reference: refs/npm-cli/workspaces/libnpmfetch + refs/bun/src/install/npm.zig.

export const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

export interface NpmrcConfig {
    /** Default registry URL (trailing slash kept as written). */
    registry: string;
    /** Registry overrides per scope: `{"@scope": "https://registry/"}`. */
    scopes: Record<string, string>;
    /** Auth tokens keyed by `//host/path/:` prefix (npm convention). */
    authTokens: Record<string, string>;
    /** Basic-auth credentials keyed by host prefix. */
    basicAuth: Record<string, { username: string; password: string }>;
}

/** Distribution metadata for a single version. */
export interface PackumentDist {
    tarball: string;
    integrity?: string;
    shasum?: string;
}

/** Single version record inside a packument. */
export interface PackumentVersion {
    name: string;
    version: string;
    dist: PackumentDist;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    bin?: string | Record<string, string>;
    deprecated?: string;
    [key: string]: unknown;
}

/** Top-level packument shape returned by `GET /<pkg>`. */
export interface Packument {
    name: string;
    "dist-tags": Record<string, string>;
    versions: Record<string, PackumentVersion>;
    time?: Record<string, string>;
    [key: string]: unknown;
}

export interface FetchOptions {
    /** Override registry URL. Default: $npm_config_registry || DEFAULT_REGISTRY. */
    registry?: string;
    /** Pre-parsed .npmrc; if omitted, no auth is sent. */
    npmrc?: NpmrcConfig;
    /** Pre-built header map (overrides anything else). */
    headers?: Record<string, string>;
    /** AbortSignal forwarded to fetch. */
    signal?: AbortSignal;
    /** Custom fetch implementation; default = globalThis.fetch. */
    fetch?: typeof fetch;
}

/** Strict-validate a packument shape. Throws on schema mismatch. */
export function assertPackument(name: string, body: unknown): asserts body is Packument {
    if (!body || typeof body !== "object") {
        throw new TypeError(`registry: ${name} packument is not an object`);
    }
    const p = body as Record<string, unknown>;
    if (typeof p.name !== "string") {
        throw new TypeError(`registry: ${name} packument missing string name`);
    }
    if (!p.versions || typeof p.versions !== "object") {
        throw new TypeError(`registry: ${name} packument missing versions map`);
    }
}

/** Pick the right registry URL for a package name (scoped overrides win). */
export function registryFor(name: string, npmrc: NpmrcConfig | undefined): string {
    if (npmrc && name.startsWith("@")) {
        const scope = name.slice(0, name.indexOf("/"));
        const override = npmrc.scopes[scope];
        if (override) return ensureTrailingSlash(override);
    }
    if (npmrc?.registry) return ensureTrailingSlash(npmrc.registry);
    return DEFAULT_REGISTRY;
}

/** Build the GET URL for a packument. Handles `@scope/name` URL-encoding. */
export function packumentUrl(name: string, registry: string): string {
    const base = ensureTrailingSlash(registry);
    if (name.startsWith("@")) {
        const slash = name.indexOf("/");
        if (slash < 0) throw new TypeError(`Invalid scoped package name: ${name}`);
        const scope = name.slice(0, slash);
        const rest = name.slice(slash + 1);
        return `${base}${encodeURIComponent(scope)}/${encodeURIComponent(rest)}`;
    }
    return `${base}${encodeURIComponent(name)}`;
}

/** Fetch + parse a packument. */
export async function fetchPackument(name: string, opts: FetchOptions = {}): Promise<Packument> {
    const registry = opts.registry ?? registryFor(name, opts.npmrc);
    const url = packumentUrl(name, registry);
    const headers = buildHeaders(url, opts);
    headers["accept"] ??= "application/vnd.npm.install-v1+json";

    const fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!fetchImpl) throw new Error("@gjsify/npm-registry: globalThis.fetch is missing");

    const res = await fetchImpl(url, { headers, signal: opts.signal });
    if (!res.ok) {
        if (res.status === 404) throw new PackageNotFoundError(name, url);
        throw new Error(`registry GET ${url} -> ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as unknown;
    assertPackument(name, body);
    return body;
}

/** Download a tarball as bytes. Verifies SRI `integrity` when supplied. */
export async function fetchTarball(
    url: string,
    opts: FetchOptions & { integrity?: string } = {},
): Promise<Uint8Array> {
    const headers = buildHeaders(url, opts);
    headers["accept"] ??= "application/octet-stream";

    const fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!fetchImpl) throw new Error("@gjsify/npm-registry: globalThis.fetch is missing");

    const res = await fetchImpl(url, { headers, signal: opts.signal });
    if (!res.ok) throw new Error(`tarball GET ${url} -> ${res.status} ${res.statusText}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (opts.integrity) {
        const ok = await verifyIntegrity(buf, opts.integrity);
        if (!ok) throw new IntegrityError(url, opts.integrity);
    }
    return buf;
}

/**
 * Verify an SRI string (e.g. `sha512-base64==`) against bytes.
 * Multiple hashes (space-separated) accepted; any match passes.
 */
export async function verifyIntegrity(data: Uint8Array, integrity: string): Promise<boolean> {
    const parts = integrity.trim().split(/\s+/);
    for (const part of parts) {
        const dash = part.indexOf("-");
        if (dash < 0) continue;
        const algo = part.slice(0, dash).toLowerCase();
        const expected = part.slice(dash + 1);
        const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
        if (!subtle) throw new Error("@gjsify/npm-registry: globalThis.crypto.subtle is missing");
        const algoName = subriToWebCryptoAlgo(algo);
        if (!algoName) continue;
        const digest = await subtle.digest(algoName, dataAsArrayBuffer(data));
        const got = bytesToBase64(new Uint8Array(digest));
        if (got === expected) return true;
    }
    return false;
}

function subriToWebCryptoAlgo(sri: string): "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512" | null {
    switch (sri) {
        case "sha1":
            return "SHA-1";
        case "sha256":
            return "SHA-256";
        case "sha384":
            return "SHA-384";
        case "sha512":
            return "SHA-512";
        default:
            return null;
    }
}

function dataAsArrayBuffer(data: Uint8Array): ArrayBuffer {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
        return data.buffer as ArrayBuffer;
    }
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
    // Standard base64 — no URL-safe variant. Cross-platform: btoa exists in
    // both Node and GJS (the latter via @gjsify/web-globals).
    let bin = "";
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
}

/** Parse a `.npmrc` text body. Unknown keys are kept on the result for callers. */
export function parseNpmrc(text: string): NpmrcConfig {
    const out: NpmrcConfig & { [k: string]: unknown } = {
        registry: DEFAULT_REGISTRY,
        scopes: {},
        authTokens: {},
        basicAuth: {},
    };
    const lines = text.split(/\r?\n/);
    const basic: Record<string, { user?: string; pass?: string }> = {};
    for (const raw of lines) {
        const line = raw.replace(/^\s+|\s+$/g, "");
        if (!line || line.startsWith("#") || line.startsWith(";")) continue;
        const eq = line.indexOf("=");
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        const value = expandEnv(stripQuotes(line.slice(eq + 1).trim()));
        if (key === "registry") {
            out.registry = ensureTrailingSlash(value);
            continue;
        }
        const scopeRegistry = key.match(/^(@[^:]+):registry$/);
        if (scopeRegistry) {
            out.scopes[scopeRegistry[1]] = ensureTrailingSlash(value);
            continue;
        }
        const tokenMatch = key.match(/^\/\/(.+):_authToken$/);
        if (tokenMatch) {
            out.authTokens[normalizeAuthHost(tokenMatch[1])] = value;
            continue;
        }
        const userMatch = key.match(/^\/\/(.+):username$/);
        if (userMatch) {
            (basic[normalizeAuthHost(userMatch[1])] ??= {}).user = value;
            continue;
        }
        const passMatch = key.match(/^\/\/(.+):_password$/);
        if (passMatch) {
            const decoded = base64Decode(value);
            (basic[normalizeAuthHost(passMatch[1])] ??= {}).pass = decoded;
            continue;
        }
    }
    for (const [host, creds] of Object.entries(basic)) {
        if (creds.user && creds.pass !== undefined) {
            out.basicAuth[host] = { username: creds.user, password: creds.pass };
        }
    }
    return out;
}

/** Build auth + UA headers for a request URL. Pure (no I/O). */
export function buildHeaders(url: string, opts: FetchOptions): Record<string, string> {
    const headers: Record<string, string> = { "user-agent": "gjsify-install/0.3.7" };
    if (opts.npmrc) {
        const auth = resolveAuthForUrl(url, opts.npmrc);
        if (auth) headers["authorization"] = auth;
    }
    if (opts.headers) {
        for (const [k, v] of Object.entries(opts.headers)) headers[k.toLowerCase()] = v;
    }
    return headers;
}

/** Resolve an `Authorization` header for a URL given a parsed .npmrc. */
export function resolveAuthForUrl(url: string, npmrc: NpmrcConfig): string | null {
    const u = new URL(url);
    // npm matches keys against the URL by walking from the deepest path back to
    // the host root, picking the longest prefix match.
    const candidates = pathPrefixes(u);
    for (const prefix of candidates) {
        const token = npmrc.authTokens[prefix];
        if (token) return `Bearer ${token}`;
        const basic = npmrc.basicAuth[prefix];
        if (basic) {
            const enc = btoa(`${basic.username}:${basic.password}`);
            return `Basic ${enc}`;
        }
    }
    return null;
}

function pathPrefixes(u: URL): string[] {
    // Walk the URL path from deepest to shallowest. Match npm's nerf-dart
    // convention of NO trailing slash on stored keys: `//host`, `//host/api`,
    // `//host/api/npm`. Keys with trailing slashes are normalized in
    // parseNpmrc so a longest-prefix scan compares apples to apples.
    const segments = u.pathname.split("/").filter(Boolean);
    const prefixes: string[] = [];
    for (let i = segments.length; i >= 0; i--) {
        const tail = segments.slice(0, i).join("/");
        prefixes.push(tail ? `//${u.host}/${tail}` : `//${u.host}`);
    }
    return prefixes;
}

function normalizeAuthHost(captured: string): string {
    // npm strips the trailing slash from `//host/path/:_authToken` keys so the
    // path-prefix matcher can compare host-rooted ("//host") and nested
    // ("//host/path") entries on the same axis.
    const trimmed = captured.replace(/\/+$/, "");
    return `//${trimmed}`;
}

function ensureTrailingSlash(s: string): string {
    return s.endsWith("/") ? s : s + "/";
}

function stripQuotes(s: string): string {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    return s;
}

function expandEnv(s: string): string {
    // Handles `${VAR}` only — npm config does not support `$VAR`.
    return s.replace(/\$\{([A-Z0-9_]+)\}/gi, (_m, name: string) => {
        const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env;
        return env?.[name] ?? "";
    });
}

function base64Decode(s: string): string {
    return atob(s);
}

export class PackageNotFoundError extends Error {
    constructor(public readonly name: string, public readonly url: string) {
        super(`Package not found in registry: ${name} (${url})`);
        this.name = "PackageNotFoundError";
    }
}

export class IntegrityError extends Error {
    constructor(public readonly url: string, public readonly integrity: string) {
        super(`Tarball integrity mismatch for ${url} (expected ${integrity})`);
        this.name = "IntegrityError";
    }
}
