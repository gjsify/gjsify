// Short-lived, CROSS-INVOCATION cache for the npm 2FA one-time code.
//
// A TOTP stays valid for its ~30 s window, so a `login → onboard → publish →
// trust` sequence of SEPARATE `gjsify` processes should reuse ONE typed code
// instead of prompting per command. The in-process `OtpProvider` cache
// (utils/npm-otp.ts) only survives a single command; this file is the layer
// under it that survives across invocations.
//
// Design:
//   - Stored in a temp file (under `$XDG_RUNTIME_DIR`, else the OS temp dir —
//     NEVER the repo), perms 0600, with a stamped absolute `expiresAt`.
//   - TTL = one TOTP window (30 s), deliberately short. A read past the expiry
//     ignores AND deletes the file.
//   - Keyed by the REGISTRY URL, so a code for one registry is never replayed
//     against another.
//   - Best-effort: a cache miss/error NEVER breaks the command — a stale or
//     unreadable entry degrades to "no cached code" (re-prompt).
//   - Opt-out: `GJSIFY_NO_OTP_CACHE=1` disables it entirely; `gjsify logout`
//     clears it.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** TTL for a cached OTP — one TOTP window. Short by design (never raise past ~60 s). */
export const OTP_CACHE_TTL_MS = 30_000;

/** Env var that disables the cross-invocation OTP cache entirely. */
export const OTP_CACHE_OPT_OUT_ENV = 'GJSIFY_NO_OTP_CACHE';

const CACHE_DIR_NAME = 'gjsify-otp';

/** On-disk shape of a cached entry. */
interface OtpCacheEntry {
    otp: string;
    /** Absolute epoch-ms after which the entry is dead. */
    expiresAt: number;
    /** Normalized registry the code belongs to (guards against a filename collision). */
    registry: string;
}

/** Injectable knobs so the unit tests stay hermetic (real callers pass nothing). */
export interface OtpCacheOptions {
    /** Override the cache base dir. Defaults to `$XDG_RUNTIME_DIR` → OS temp dir. */
    dir?: string;
    /** Injected clock (epoch-ms). Defaults to `Date.now()`. */
    now?: number;
    /** Override the TTL for a write. Defaults to {@link OTP_CACHE_TTL_MS}. */
    ttlMs?: number;
}

/** `true` unless `GJSIFY_NO_OTP_CACHE` is set to a truthy value. */
export function isOtpCacheEnabled(): boolean {
    const v = process.env[OTP_CACHE_OPT_OUT_ENV];
    return !(v === '1' || v === 'true' || v === 'yes');
}

/** Trailing-slash-insensitive registry key so `…/` and `…` map to one entry. */
function normalizeRegistry(registry: string): string {
    return registry.endsWith('/') ? registry.slice(0, -1) : registry;
}

function cacheBaseDir(opts?: OtpCacheOptions): string {
    if (opts?.dir) return opts.dir;
    const xdg = process.env.XDG_RUNTIME_DIR;
    const base = xdg && xdg.length > 0 ? xdg : tmpdir();
    return join(base, CACHE_DIR_NAME);
}

/** Registry-scoped cache file path (filename derived from the registry). */
function cacheFileFor(registry: string, opts?: OtpCacheOptions): string {
    const safe = normalizeRegistry(registry)
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
    return join(cacheBaseDir(opts), `otp-${safe || 'default'}.json`);
}

/**
 * Read the cached code for `registry`, or `undefined` on a miss / expiry /
 * opt-out. An EXPIRED entry is deleted as a side effect.
 */
export function readCachedOtp(registry: string, opts?: OtpCacheOptions): string | undefined {
    if (!isOtpCacheEnabled()) return undefined;
    const now = opts?.now ?? Date.now();
    const file = cacheFileFor(registry, opts);
    try {
        if (!existsSync(file)) return undefined;
        const entry = JSON.parse(readFileSync(file, 'utf8')) as OtpCacheEntry;
        if (!entry || typeof entry.otp !== 'string' || typeof entry.expiresAt !== 'number') {
            deleteCacheFile(file);
            return undefined;
        }
        // Registry mismatch (sanitized filename collision) → miss, don't delete.
        if (entry.registry !== normalizeRegistry(registry)) return undefined;
        if (now >= entry.expiresAt) {
            deleteCacheFile(file); // expired → ignore + delete
            return undefined;
        }
        return entry.otp.length > 0 ? entry.otp : undefined;
    } catch {
        // Corrupt / unreadable — treat as a miss, best-effort remove.
        deleteCacheFile(file);
        return undefined;
    }
}

/**
 * Persist `otp` for `registry` with a fresh TTL, perms 0600. No-op on opt-out
 * or empty code. Best-effort — a write failure never throws.
 */
export function writeCachedOtp(registry: string, otp: string, opts?: OtpCacheOptions): void {
    if (!isOtpCacheEnabled()) return;
    if (!otp || otp.length === 0) return;
    const now = opts?.now ?? Date.now();
    const ttl = opts?.ttlMs ?? OTP_CACHE_TTL_MS;
    try {
        const dir = cacheBaseDir(opts);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const file = cacheFileFor(registry, opts);
        const entry: OtpCacheEntry = { otp, expiresAt: now + ttl, registry: normalizeRegistry(registry) };
        writeFileSync(file, JSON.stringify(entry), { mode: 0o600 });
        // Enforce 0600 even when the file pre-existed with looser perms (writeFile
        // only applies `mode` on create) — the code is a live secret.
        chmodSync(file, 0o600);
    } catch {
        /* best-effort — a cache write must never break the command */
    }
}

/** Drop the cached code for a single registry (invalid/consumed OTP, or logout). */
export function clearCachedOtp(registry: string, opts?: OtpCacheOptions): void {
    deleteCacheFile(cacheFileFor(registry, opts));
}

/** Drop the entire cache dir (e.g. a broad logout). Best-effort. */
export function clearAllCachedOtp(opts?: OtpCacheOptions): void {
    try {
        rmSync(cacheBaseDir(opts), { recursive: true, force: true });
    } catch {
        /* ignore */
    }
}

/** POSIX file-mode bits of the cache file (test helper); `undefined` if absent. */
export function cachedOtpFileMode(registry: string, opts?: OtpCacheOptions): number | undefined {
    const file = cacheFileFor(registry, opts);
    try {
        if (!existsSync(file)) return undefined;
        return statSync(file).mode & 0o777;
    } catch {
        return undefined;
    }
}

function deleteCacheFile(file: string): void {
    try {
        if (existsSync(file)) rmSync(file, { force: true });
    } catch {
        /* ignore */
    }
}
