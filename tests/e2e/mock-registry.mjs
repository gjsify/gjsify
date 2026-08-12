// The npm harness every install-flavoured e2e suite needs: an ustar tarball
// writer, its SRI integrity, and an in-process registry that serves both.
//
// WHY IT IS ONE MODULE. This block was hand-copied into fifteen `run.mjs` files
// and had drifted into nine distinct variants — the tar writer alone appeared with
// and without its explicit NUL terminators, taking a `package.json` object in some
// copies and a file MAP in others. A correction to the writer therefore landed in
// one suite of fifteen, and the fourteen that kept the old bytes were the ones
// still asserting against them. `helpers.mjs` was already the shared home and
// exported none of it.
//
// SCOPE. This serves the COMMON registry shape: an index document per package,
// `dist-tags.latest`, a gzipped tarball per version, 404 for anything unknown. A
// suite that needs the registry to misbehave — stall mid-body, close early, count
// requests — passes `onRequest`, which sees every request first and reports
// whether it handled it. That hook exists so those suites keep the shared writer
// instead of forking the whole module again, which is how this started.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';

const BLOCK = 512;

/**
 * One ustar v0 header block.
 *
 * The checksum is computed over the header with its own checksum field read as
 * spaces (`fill(0x20, 148, 156)`), which is the format's rule and the field most
 * often wrong in a hand-written writer.
 */
function tarHeader(name, size, type = '0') {
    const buf = Buffer.alloc(BLOCK);
    buf.write(name, 0, Math.min(name.length, 100));
    buf.write('0000644', 100, 7);
    buf.write('0000000', 108, 7);
    buf.write('0000000', 116, 7);
    buf.write(size.toString(8).padStart(11, '0'), 124, 11);
    buf.write('0'.repeat(11), 136, 11);
    buf.fill(0x20, 148, 156);
    buf.write(type, 156, 1);
    buf.write('ustar\0', 257, 6);
    buf.write('00', 263, 2);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += buf[i];
    buf.write(sum.toString(8).padStart(6, '0'), 148, 6);
    buf[154] = 0;
    buf[155] = 0x20;
    return buf;
}

/**
 * A package tarball's uncompressed bytes, with every entry under `package/` — the
 * prefix npm strips on extract.
 *
 * Parent directories get their own headers, emitted before the files in them. Real
 * npm tarballs carry them, and one of the copies this replaced wrote them by hand
 * for exactly one fixture (a prebuild directory) because its extractor path reads
 * them — a writer that omits them is a fixture that differs from production in a
 * way no assertion states.
 *
 * @param {Record<string, string | Buffer>} files path inside `package/` → contents
 */
export function packageTar(files) {
    const parts = [];
    const dirs = new Set();
    const dirEntry = (path) => {
        if (dirs.has(path)) return;
        dirs.add(path);
        parts.push(tarHeader(path, 0, '5'));
    };
    dirEntry('package/');

    for (const [name, contents] of Object.entries(files)) {
        const segments = name.split('/');
        for (let i = 1; i < segments.length; i++) dirEntry(`package/${segments.slice(0, i).join('/')}/`);
        const body = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
        const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK);
        body.copy(padded);
        parts.push(tarHeader(`package/${name}`, body.length), padded);
    }
    parts.push(Buffer.alloc(BLOCK * 2)); // two zero blocks = end of archive
    return Buffer.concat(parts);
}

/** The `integrity` string npm puts in `dist`, over the GZIPPED bytes. */
export function sriSha512(bytes) {
    return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/**
 * A gzipped package tarball plus its integrity, which are never wanted apart.
 *
 * @param {Record<string, string | Buffer>} files as {@link packageTar}
 */
export function packageTarball(files) {
    const tgz = gzipSync(packageTar(files));
    return { tgz, integrity: sriSha512(tgz) };
}

/**
 * Split a version entry into the `package.json` it becomes and the extra files
 * that ship beside it.
 *
 * Everything is a manifest field, so a fixture reads as the package.json it
 * produces — EXCEPT an OBJECT under `files`, which is the tarball's file map.
 * The type is what disambiguates, and it has to: `files` is also a real npm
 * manifest field, and there it is an ARRAY of publish globs. Reserving the key
 * outright would silently swallow that array out of any fixture that declares
 * one, which is the manifest half of what `install-workspace-source-safety`
 * exists to test.
 */
function splitVersionSpec(name, version, spec) {
    const { files, ...rest } = spec ?? {};
    const isFileMap = files !== undefined && !Array.isArray(files) && typeof files === 'object';
    const manifest = isFileMap ? rest : (spec ?? {});
    const extra = isFileMap ? files : {};
    const pkgJson = { name, version, ...manifest };
    return { pkgJson, files: { 'package.json': JSON.stringify(pkgJson, null, 2) + '\n', ...extra } };
}

/**
 * Start an in-process npm registry over a fixture tree.
 *
 * @param {Record<string, Record<string, object>>} packages `name → version → manifest fields (+ optional `files`)`
 * @param {{ onRequest?: (req, res, ctx) => boolean, distTags?: Record<string, Record<string, string>> }} [options]
 *        `onRequest` sees every request BEFORE the default routes and returns
 *        `true` when it has answered — the seam for suites testing a registry that
 *        stalls, truncates or fails.
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void>,
 *          tarball: (name: string, version: string) => Buffer,
 *          integrity: (name: string, version: string) => string,
 *          requests: string[] }>}
 */
export async function startMockRegistry(packages, options = {}) {
    const { onRequest, distTags = {} } = options;

    /** name → { indexDoc, versions: Map<version, {tgz, integrity}> } */
    const store = new Map();
    for (const [name, versions] of Object.entries(packages)) {
        const doc = { name, 'dist-tags': {}, versions: {} };
        const built = new Map();
        let last = '';
        for (const [version, spec] of Object.entries(versions)) {
            const { pkgJson, files } = splitVersionSpec(name, version, spec);
            const { tgz, integrity } = packageTarball(files);
            built.set(version, { tgz, integrity });
            doc.versions[version] = {
                ...pkgJson,
                dist: { tarball: `__BASE__/-/${name}/${version}.tgz`, integrity },
            };
            last = version;
        }
        doc['dist-tags'] = { latest: last, ...distTags[name] };
        store.set(name, { doc, versions: built });
    }

    const requests = [];
    const server = createServer((req, res) => {
        const url = req.url ?? '';
        requests.push(url);
        try {
            if (onRequest?.(req, res, { store, baseUrl: baseUrl() })) return;

            const tarMatch = url.match(/^\/-\/(.+)\/([^/]+)\.tgz$/);
            if (tarMatch) {
                const entry = store.get(decodeURIComponent(tarMatch[1]))?.versions.get(tarMatch[2]);
                if (!entry) return void res.writeHead(404).end('not found');
                res.writeHead(200, { 'content-type': 'application/octet-stream' });
                return void res.end(entry.tgz);
            }

            const pkgName = decodeURIComponent(url.replace(/^\//, '').split('?')[0]);
            const entry = store.get(pkgName);
            if (!entry) return void res.writeHead(404).end('not found');
            const wire = JSON.parse(JSON.stringify(entry.doc));
            for (const v of Object.values(wire.versions)) {
                v.dist.tarball = v.dist.tarball.replace('__BASE__', baseUrl());
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(wire));
        } catch (e) {
            // A throw here would hang the client on a socket nobody answers, and
            // the suite would report a timeout instead of the programming error.
            res.writeHead(500).end(String(e));
        }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = () => `http://127.0.0.1:${port}`;

    return {
        url: `${baseUrl()}/`,
        port,
        requests,
        tarball: (name, version) => store.get(name)?.versions.get(version)?.tgz,
        integrity: (name, version) => store.get(name)?.versions.get(version)?.integrity,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

/**
 * Run the CLI entry in a child Node and resolve with its outcome.
 *
 * RESOLVES on a non-zero exit and rejects only on a spawn error: an exit code is
 * an ANSWER for most of these suites, and a helper that rejects on it forces every
 * caller into a try/catch that then swallows real spawn failures too.
 *
 * The timeout kills with SIGKILL and still resolves, carrying `timedOut: true` —
 * a caller that asserts on `status` alone must not silently read a killed run as a
 * clean failure.
 */
/**
 * The SYNCHRONOUS sibling: run the CLI and return its stdout as a string.
 *
 * Kept beside {@link runCli} rather than folded into it because the two answer
 * different questions — this one THROWS on a non-zero exit (that is `execFileSync`'s
 * contract, and the suites using it assert on the thrown `status`/`stderr`), while
 * `runCli` resolves with the code. Four suites had hand-rolled this identically.
 */
export function runCliSync(cliEntry, args, opts = {}) {
    return execFileSync(process.execPath, [cliEntry, ...args], {
        stdio: opts.stdio ?? 'pipe',
        timeout: opts.timeout ?? 60_000,
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        encoding: 'utf8',
    });
}

export function runCli(cliEntry, args, { cwd, env, timeoutMs = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliEntry, ...args], {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => {
            stdout += c;
        });
        child.stderr.on('data', (c) => {
            stderr += c;
        });
        // `kill` with a known signal never throws — a failure to deliver just
        // returns false, which means the process had already exited.
        const kill = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, timeoutMs);
        child.on('close', (code) => {
            clearTimeout(kill);
            resolve({ status: code, stdout, stderr, timedOut });
        });
        child.on('error', (e) => {
            clearTimeout(kill);
            reject(e);
        });
    });
}
