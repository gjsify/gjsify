#!/usr/bin/env -S gjs -m
/**
 * gjsify universal installer — bootstraps `@gjsify/cli` (or any GJS app on npm)
 * on a system that has only `gjs` and libsoup: no Node, no npm. Decision and
 * history: docs/adr/0002-bootstrap-bundle-minimization.md.
 *
 * Two stages: download a self-contained GJS bundle of `@gjsify/cli`
 * (`cli.gjs.mjs`) from this repo's GitHub releases and verify its SHA-256, then
 * spawn it as `gjs -m <bundle> install -g <target>@<tag>`. Dependency
 * resolution, native prebuilds, lockfiles and the `~/.local/bin` launchers all
 * live in that bundle — this bootstrapper re-implements none of it on purpose.
 *
 * `gjsify generate-installer` re-emits this file for end-user GJS apps with the
 * marked constants substituted.
 *
 * `--help` documents the user-facing flags and env vars. Two more exist only for
 * tests/e2e/install-script/run.mjs: GJSIFY_INSTALL_BOOTSTRAP_SHA256_URL and
 * GJSIFY_INSTALL_BOOTSTRAP_CACHE.
 */

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import system, { exit } from 'system';

/**
 * Soup, loaded late and — on a macOS that cannot find it — through one re-exec.
 *
 * WHY THIS IS NOT A PLAIN IMPORT. GI resolves a typelib's shared library with a
 * bare-leaf `dlopen("libsoup-3.0.0.dylib")`. Homebrew installs that dylib in
 * `/usr/local/lib` (Intel) or `/opt/homebrew/lib` (arm64), and `gjs` carries an
 * rpath only for glib's own directory, so on a stock Homebrew macOS dyld never
 * looks where the library actually is. Measured 2026-08-13 on macOS 15.7.9:
 *
 *     $ curl -fsSL .../install.mjs -o /tmp/g.mjs && gjs -m /tmp/g.mjs
 *     Failed to load shared library 'libsoup-3.0.0.dylib' referenced by the typelib
 *     JS ERROR: Error: Unsupported type void, deriving from fundamental void
 *
 * That is the DOCUMENTED install path for a platform this project advertises,
 * and it fails before the first byte is downloaded — the bootstrap's own fetcher
 * is Soup. `DYLD_FALLBACK_LIBRARY_PATH=/usr/local/lib` fixes it, but nothing can
 * export that on the user's behalf from inside this process: the variable is
 * read by dyld at image load, long before any JS runs. Hence a re-exec.
 *
 * Repaired ONLY when the load actually fails, so a healthy host (arm64 Homebrew,
 * a distro-packaged gjs, anything with a working rpath) re-execs never.
 *
 * Note the probe touches `Session` rather than just importing the namespace:
 * `imports.gi.Soup` SUCCEEDS on a broken host — the library is resolved lazily,
 * when a type is first needed. A namespace-only check reports a healthy
 * environment and is the reason this looked like a network bug for so long.
 */
const DYLD_REEXEC_MARKER = 'GJSIFY_INSTALL_DYLD_REEXEC';

/** dyld's documented default fallback list, plus both Homebrew prefixes. */
function dyldFallbackDirs() {
    const home = GLib.get_home_dir();
    return [`${home}/lib`, '/usr/local/lib', '/opt/homebrew/lib', '/lib', '/usr/lib'].join(':');
}

async function loadSoup() {
    const mod = await import('gi://Soup?version=3.0');
    void mod.default.Session; // forces the dlopen; see above
    return mod.default;
}

let Soup;
try {
    Soup = await loadSoup();
} catch (error) {
    const onMacos = GLib.file_test('/usr/lib/dyld', GLib.FileTest.EXISTS);
    if (!onMacos || GLib.getenv(DYLD_REEXEC_MARKER)) throw error;

    const self = GLib.filename_from_uri(import.meta.url)[0];
    const gjs = GLib.find_program_in_path('gjs');
    if (!gjs) throw error;

    // SIP strips an INHERITED DYLD_* when a protected binary is exec'd, but a
    // value this process sets itself survives into Homebrew's unprotected `gjs`.
    const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
    launcher.setenv('DYLD_FALLBACK_LIBRARY_PATH', dyldFallbackDirs(), true);
    launcher.setenv(DYLD_REEXEC_MARKER, '1', true);
    const child = launcher.spawnv([gjs, '-m', self, ...(system?.programArgs ?? [])]);
    child.wait(null);
    exit(child.get_exit_status() === 0 ? 0 : 1);
}

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.Subprocess.prototype, 'wait_check_async');

// Substituted by `gjsify generate-installer` for end-user apps.
const DEFAULT_TARGET = '@gjsify/cli';
const DEFAULT_BIN_NAME = 'gjsify';
const DEFAULT_BOOTSTRAP_URL = 'https://github.com/gjsify/gjsify/releases/latest/download/cli.gjs.mjs';
const DEFAULT_BOOTSTRAP_SHA256_URL = `${DEFAULT_BOOTSTRAP_URL}.sha256`;

const USER_AGENT = 'gjsify-installer/1.0';

// Content-addressed cache: `cli-<sha256>.gjs.mjs`. Why the digest and not a
// fixed name keys it: `resolveBootstrap()`.
const CACHE_PREFIX = 'cli-';
const CACHE_SUFFIX = '.gjs.mjs';

/**
 * Under `--fetch-only` stdout carries nothing but the bundle path, so progress
 * goes to stderr. A caller does `BOOTSTRAP=$(gjs -m install.mjs --fetch-only)`,
 * where one stray `info()` line glues a log message to the front of the path and
 * surfaces later as a confusing "file not found".
 */
let logToStderr = false;

function info(msg) {
    if (logToStderr) printerr(`[gjsify] ${msg}`);
    else print(`[gjsify] ${msg}`);
}
function error(msg) {
    printerr(`[gjsify] ERROR: ${msg}`);
}

function parseArgs() {
    const argv = system?.programArgs ?? [];
    let target = DEFAULT_TARGET;
    let tag = 'latest';
    let force = false;
    let help = false;
    let fetchOnly = false;
    let bootstrapUrl = GLib.getenv('GJSIFY_INSTALL_BOOTSTRAP_URL') || DEFAULT_BOOTSTRAP_URL;
    let bootstrapSha256Url = GLib.getenv('GJSIFY_INSTALL_BOOTSTRAP_SHA256_URL');
    if (bootstrapSha256Url === null || bootstrapSha256Url === undefined) {
        bootstrapSha256Url =
            bootstrapUrl === DEFAULT_BOOTSTRAP_URL ? DEFAULT_BOOTSTRAP_SHA256_URL : `${bootstrapUrl}.sha256`;
    }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--force' || a === '-f') force = true;
        else if (a === '--help' || a === '-h') help = true;
        else if (a === '--target') target = argv[++i];
        else if (a.startsWith('--target=')) target = a.slice('--target='.length);
        else if (a === '--tag') tag = argv[++i];
        else if (a.startsWith('--tag=')) tag = a.slice('--tag='.length);
        else if (a === '--bootstrap-url') bootstrapUrl = argv[++i];
        else if (a.startsWith('--bootstrap-url=')) bootstrapUrl = a.slice('--bootstrap-url='.length);
        else if (a === '--fetch-only') fetchOnly = true;
    }
    return { target, tag, force, help, bootstrapUrl, bootstrapSha256Url, fetchOnly };
}

function printUsage() {
    print(`Usage: gjs -m install.mjs [options]

Installs (or updates) ${DEFAULT_TARGET} into the user-global XDG location,
using a self-contained GJS bundle of @gjsify/cli as a one-shot bootstrap.

Options:
  --target <pkg>     npm package to install   (default: ${DEFAULT_TARGET})
  --tag <tag>        npm dist-tag or version  (default: latest)
  --force, -f        Reinstall even when present.
  --bootstrap-url <url>  Override the cli.gjs.mjs download URL.
  --fetch-only       Download + verify the bootstrap bundle, print its cached
                     path to stdout and exit — no install. Lets a caller (CI)
                     reuse this downloader instead of growing a second one
                     beside it; progress goes to stderr so stdout is the path.
  --help, -h         Show this message.

Env vars:
  GJSIFY_INSTALL_BOOTSTRAP_URL   alternate bootstrap bundle URL (file:// OK)
  GJSIFY_GLOBAL_PREFIX           install prefix (default: ~/.local/share/gjsify/global)
  GJSIFY_GLOBAL_BIN_DIR          bin dir       (default: ~/.local/bin)
  GJSIFY_INSTALL_REGISTRY        npm registry override

Examples:
  # Install / update the gjsify CLI itself:
  gjs -m install.mjs

  # Install some other GJS-runnable package from npm:
  gjs -m install.mjs --target @ts-for-gir/cli

  # Pin a specific version:
  gjs -m install.mjs --tag 0.4.9
`);
}

function checkGjsVersion() {
    // `system.version` is packed: major*10000 + minor*100 + micro
    const v = system?.version;
    if (typeof v !== 'number') return;
    const major = Math.floor(v / 10000);
    const minor = Math.floor((v - major * 10000) / 100);
    if (major < 1 || (major === 1 && minor < 86)) {
        error(`gjs ${major}.${minor} is too old — gjsify requires gjs 1.86 or newer.`);
        error('Install hints:');
        error('  Fedora 43+:      sudo dnf install gjs');
        error('  Arch:            sudo pacman -S gjs');
        // NOT "Debian 13+". Measured 2026-08-16 against tracker.debian.org: trixie
        // (13, stable) ships 1.82.3, forky (testing) 1.88.1, sid 1.89.2 — 1.84 and
        // 1.86 were skipped entirely. Sending a trixie user to `apt install gjs`
        // hands them the very version this branch just rejected, from the branch
        // that rejected it. Same fact, same wording as `utils/ship/depends.ts`.
        error('  Debian forky/sid: sudo apt install gjs   (trixie ships 1.82.3 — too old)');
        exit(1);
    }
}

/** Total attempts per URL, and the wait before each retry. Override for tests / slow links. */
const FETCH_ATTEMPTS = Number(GLib.getenv('GJSIFY_INSTALL_FETCH_ATTEMPTS') || '5');
const RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000];

function sleepMs(ms) {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

async function fetchOnce(session, url, { forceHttp1 = false } = {}) {
    const message = Soup.Message.new('GET', url);
    message.request_headers.append('User-Agent', USER_AGENT);
    // The failure this retries against announces its own protocol — libsoup reports it
    // verbatim as `HTTP/2 Error: NO_ERROR`, a stream closed mid-response. Retrying over
    // HTTP/1.1 sidesteps the multiplexing that produces it, so the first attempt keeps the
    // faster protocol and every retry drops to the one that cannot fail that way. Guarded:
    // `set_force_http1` is libsoup 3.4+, and this script must still run on older hosts.
    if (forceHttp1 && typeof message.set_force_http1 === 'function') message.set_force_http1(true);
    const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
    const status = message.get_status();
    if (status !== Soup.Status.OK) {
        const err = new Error(`HTTP ${status} from ${url}`);
        err.httpStatus = status;
        throw err;
    }
    return bytes.get_data();
}

/**
 * A dropped connection is a HICCUP; an HTTP answer is an ANSWER.
 *
 * THE INCIDENT. `https://github.com/gjsify/gjsify/releases/latest/download/…` dropped
 * HTTP/2 connections for a stretch on 2026-08-12 and took four CI jobs across two PRs
 * with it, each dying in `gjsify-setup` before a line of the change under test ran.
 * Measured from a workstation during the same window: one in three `curl` attempts
 * returned `Connection died, tried 5 times before giving up`. A single-shot fetch turns
 * that into "Refusing to install an UNVERIFIED bootstrap bundle", which reads like the
 * digest is missing or hostile — the one message that must never be a false alarm, since
 * the correct response to it is to disable verification.
 *
 * So retries are scoped to what CANNOT be an answer: a transport failure (no status at
 * all), plus 429 and 5xx. A 404 is the registry saying the asset does not exist and a 403
 * is it saying no; retrying either would only delay the same result while making a real
 * outage look like a hang.
 *
 * FIVE attempts, not three, and the numbers come from a run rather than a preference:
 * with three the CI log showed `retry 2/3` and `retry 3/3` and still failed, because each
 * attempt takes ~20 s to give up — so the 500ms/1500ms backoff was noise beside it and the
 * whole sequence covered barely 40 s of a longer wobble. 1/2/4/8 s over five attempts
 * covers about two minutes. Beyond that it is an outage, not a hiccup, and waiting longer
 * only turns a clear failure into a hang.
 */
async function fetchBytes(session, url) {
    if (url.startsWith('file://')) {
        const path = url.slice('file://'.length);
        const file = Gio.File.new_for_path(path);
        const [, bytes] = file.load_contents(null);
        return bytes;
    }
    const attempts = Number.isFinite(FETCH_ATTEMPTS) && FETCH_ATTEMPTS >= 1 ? FETCH_ATTEMPTS : 1;
    let lastErr = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fetchOnce(session, url, { forceHttp1: attempt > 1 });
        } catch (err) {
            lastErr = err;
            const status = err.httpStatus;
            const retriable = status === undefined || status === 429 || status >= 500;
            if (!retriable || attempt === attempts) break;
            const wait = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)];
            info(`Fetch of ${url} failed (${err.message}) — retry ${attempt + 1}/${attempts} in ${wait}ms`);
            await sleepMs(wait);
        }
    }
    throw lastErr;
}

function sha256Hex(bytes) {
    const checksum = GLib.Checksum.new(GLib.ChecksumType.SHA256);
    checksum.update(bytes);
    return checksum.get_string();
}

function cacheDir() {
    const override = GLib.getenv('GJSIFY_INSTALL_BOOTSTRAP_CACHE');
    if (override) return override;
    const xdg = GLib.getenv('XDG_CACHE_HOME') || GLib.build_filenamev([GLib.get_home_dir(), '.cache']);
    return GLib.build_filenamev([xdg, 'gjsify', 'bootstrap']);
}

function ensureDir(dir) {
    Gio.File.new_for_path(dir).make_directory_with_parents(null);
}

function writeBytes(path, bytes) {
    Gio.File.new_for_path(path).replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

function readBytesOrNull(path) {
    try {
        const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
        return bytes;
    } catch {
        // An absent or unreadable entry (truncated by a killed earlier run) is a
        // MISS, not an error. `load_contents` is `throws="1"`, so this catch has
        // a genuine throw path.
        return null;
    }
}

/**
 * Drop every other cached bootstrap. Each entry is a ~6.6 MB bundle and the
 * digest changes every release, so without pruning, content-addressing would
 * trade "the cache can never be warm" for "the cache grows forever".
 */
function pruneCache(dir, keepBasename) {
    const children = Gio.File.new_for_path(dir).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    for (;;) {
        const info_ = children.next_file(null);
        if (info_ === null) break;
        const name = info_.get_name();
        if (name === keepBasename || !name.startsWith(CACHE_PREFIX) || !name.endsWith(CACHE_SUFFIX)) continue;
        Gio.File.new_for_path(GLib.build_filenamev([dir, name])).delete(null);
    }
}

/**
 * The newest cached bootstrap whose CONTENTS hash to the digest in its own name, or
 * null. Re-hashing is the whole point: the filename is a claim, and a truncated entry
 * keeps its name — the same reason the warm-cache path below re-hashes rather than
 * trusting it.
 */
function newestCachedBootstrap(dir) {
    let best = null;
    let children;
    try {
        children = Gio.File.new_for_path(dir).enumerate_children(
            'standard::name,time::modified',
            Gio.FileQueryInfoFlags.NONE,
            null,
        );
    } catch {
        // No cache directory yet — `enumerate_children` is `throws="1"`.
        return null;
    }
    for (;;) {
        const entry = children.next_file(null);
        if (entry === null) break;
        const name = entry.get_name();
        if (!name.startsWith(CACHE_PREFIX) || !name.endsWith(CACHE_SUFFIX)) continue;
        const claimed = name.slice(CACHE_PREFIX.length, name.length - CACHE_SUFFIX.length).toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(claimed)) continue;
        const path = GLib.build_filenamev([dir, name]);
        const bytes = readBytesOrNull(path);
        if (!bytes || sha256Hex(bytes).toLowerCase() !== claimed) continue;
        const mtime = entry.get_modification_date_time()?.to_unix() ?? 0;
        if (!best || mtime > best.mtime) best = { path, basename: name, mtime };
    }
    return best;
}

/**
 * Resolve a VERIFIED bootstrap bundle and return its path.
 *
 * Fetching the digest BEFORE the bundle, and keying the cache by it, is the
 * mechanism rather than an optimisation; the reverse order cost two defects.
 * Verifying after downloading made verification skippable by anyone who could
 * break ONE request — a failed `.sha256` fetch logged "skipping verification"
 * and carried on, so a proxy, a 404 or a captive portal silently downgraded the
 * install. And a fixed `cli.gjs.mjs` name that was never read back meant every
 * run re-downloaded ~6.6 MB; a content-addressed name short-circuits that.
 *
 * Skipping verification remains possible only as an EXPLICIT act
 * (`GJSIFY_INSTALL_BOOTSTRAP_SHA256_URL=''`), and it says so on stderr.
 */
async function resolveBootstrap(session, bootstrapUrl, sha256Url) {
    let expected = null;
    if (sha256Url) {
        info(`Fetching published SHA-256 from ${sha256Url} ...`);
        let sumBytes;
        try {
            sumBytes = await fetchBytes(session, sha256Url);
        } catch (err) {
            // Before refusing: a bundle already in the cache carries its own digest in
            // its NAME, and re-hashing the bytes proves the name. Those bytes were
            // verified against a digest that WAS fetched, on an earlier run — so reusing
            // them installs nothing unverified. That is a different thing from the defect
            // this function's header records, where a failed digest fetch waved a FRESH
            // download through with no digest at all.
            //
            // What it does concede is FRESHNESS: someone who can block the network can
            // hold you on the release you already have. So it is loud, it names the
            // digest, and it only ever runs after the retries above are exhausted — which
            // on 2026-08-12 was a GitHub release CDN dropping every connection from the
            // CI runners for over an hour, with a warm cache sitting right there, unusable
            // because the digest fetch comes first.
            const cached = newestCachedBootstrap(cacheDir());
            if (cached) {
                error(`Could not fetch ${sha256Url}: ${err.message}`);
                info(`Falling back to the cached bootstrap verified earlier: ${cached.basename}`);
                info('It may be OLDER than `latest` — re-run once the network recovers.');
                return cached.path;
            }
            error(`Could not fetch ${sha256Url}: ${err.message}`);
            error('Refusing to install an UNVERIFIED bootstrap bundle.');
            error("To bootstrap without verification, set GJSIFY_INSTALL_BOOTSTRAP_SHA256_URL='' explicitly.");
            exit(1);
        }
        expected = (new TextDecoder().decode(sumBytes).trim().split(/\s+/)[0] ?? '').toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(expected)) {
            error(`${sha256Url} did not contain a SHA-256 digest (read ${JSON.stringify(expected.slice(0, 80))}).`);
            exit(1);
        }
    } else {
        error("SHA-256 verification is DISABLED (GJSIFY_INSTALL_BOOTSTRAP_SHA256_URL='') — the bundle is unverified.");
    }

    const dir = cacheDir();
    const basename = expected
        ? `${CACHE_PREFIX}${expected}${CACHE_SUFFIX}`
        : `${CACHE_PREFIX}unverified${CACHE_SUFFIX}`;
    const bundlePath = GLib.build_filenamev([dir, basename]);

    if (expected) {
        // Re-hash rather than trusting the filename: the name is only a CLAIM
        // about the contents, and a truncated entry keeps its name.
        const cached = readBytesOrNull(bundlePath);
        if (cached && sha256Hex(cached).toLowerCase() === expected) {
            info(`Reusing verified bootstrap ${bundlePath} (${cached.length} bytes)`);
            return bundlePath;
        }
    }

    info(`Downloading bootstrap from ${bootstrapUrl} ...`);
    const bundleBytes = await fetchBytes(session, bootstrapUrl);
    if (expected) {
        const actual = sha256Hex(bundleBytes).toLowerCase();
        if (actual !== expected) {
            error(`SHA-256 mismatch: expected ${expected}, got ${actual}`);
            exit(1);
        }
        info('SHA-256 verified.');
    }

    try {
        ensureDir(dir);
    } catch {
        /* exists */
    }
    writeBytes(bundlePath, bundleBytes);
    info(`Bootstrap cached at ${bundlePath} (${bundleBytes.length} bytes)`);
    try {
        pruneCache(dir, basename);
    } catch (err) {
        // Housekeeping only: a read-only or concurrently-modified cache dir
        // must never fail an install.
        info(`Could not prune the bootstrap cache: ${err.message}`);
    }
    return bundlePath;
}

function buildSpec(target, tag) {
    if (!tag || tag === 'latest') return target;
    return `${target}@${tag}`;
}

async function runInstall(bundlePath, spec) {
    // `gjsify install -g <spec>` rewrites the tree unconditionally, so there is
    // no force flag to forward and `--force` needs nothing here.
    info(`Running: gjs -m <bootstrap> install -g ${spec}`);
    const argv = ['gjs', '-m', bundlePath, 'install', '-g', spec];
    // No `envp`: the launcher inherits ours, so override env vars set by tests
    // and power-users reach the spawned CLI.
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.NONE,
    });
    const proc = launcher.spawnv(argv);
    await proc.wait_check_async(null);
}

async function main() {
    const opts = parseArgs();
    if (opts.help) {
        printUsage();
        exit(0);
    }
    // Set BEFORE the first `info()` — resolveBootstrap logs while downloading,
    // and those lines would otherwise land on stdout ahead of the path.
    logToStderr = opts.fetchOnly;
    checkGjsVersion();

    const session = new Soup.Session();
    let bundlePath;
    try {
        bundlePath = await resolveBootstrap(session, opts.bootstrapUrl, opts.bootstrapSha256Url);
    } catch (err) {
        error(`Bootstrap download failed: ${err.message}`);
        exit(1);
    }

    if (opts.fetchOnly) {
        print(bundlePath);
        exit(0);
    }

    const spec = buildSpec(opts.target, opts.tag);
    try {
        await runInstall(bundlePath, spec);
    } catch (err) {
        error(`Install failed: ${err.message}`);
        exit(1);
    }

    info('');
    info(`Installed ${spec}`);
    info(`Run: ${DEFAULT_BIN_NAME} --help`);
}

await main();
