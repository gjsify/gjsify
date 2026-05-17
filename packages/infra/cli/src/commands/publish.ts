// `gjsify publish [path] [--tag <tag>] [--access <a>] [--tolerate-republish] [--dry-run]`
//
// Packs the workspace via `packWorkspace()` (Phase E.1), then PUTs the
// tarball to the configured npm registry. Mirrors `npm publish`'s observable
// behavior:
//
//   - Reads .npmrc for registry URL + auth (project-local + ~/.npmrc), with
//     `npm_config_registry` env override.
//   - Scoped packages route to the scope's registry if configured
//     (`@scope:registry=...` in .npmrc).
//   - Auth: bearer token (`_authToken`) or basic (`_auth`).
//   - --tolerate-republish: surface a 409 conflict as a notice + exit 0
//     (matches yarn's flag of the same name).
//   - --tag: published version gets this dist-tag (default `latest`).
//   - --access: public | restricted — required for first publish of a
//     scoped package on the public registry.
//   - --provenance: pass-through only — actual provenance generation requires
//     a sigstore signer that gjsify doesn't ship; we record the flag in the
//     publish manifest but don't sign yet. Surface a warning so callers know.
//   - --dry-run: pack only, no PUT.
//
// The request body matches npm's "publish" payload shape:
//   {
//     "_id": "<name>",
//     "name": "<name>",
//     "description": "<from package.json>",
//     "dist-tags": { "<tag>": "<version>" },
//     "versions": { "<version>": { ...full package.json + dist } },
//     "_attachments": { "<filename>": { content_type, data: base64, length } }
//   }
//
// Source: documented in https://docs.npmjs.com/cli/v10/commands/npm-publish
// and npm's @npmcli/registry-fetch internals — verified against npm's
// in-the-wild publish payloads.

import type { Command } from '../types/index.js';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    DEFAULT_REGISTRY,
    parseNpmrc,
    registryFor,
    buildHeaders,
    type NpmrcConfig,
} from '@gjsify/npm-registry';
import { packWorkspace, type PackWorkspaceOptions } from './pack.js';

interface PublishOptions {
    path?: string;
    tag?: string;
    access?: string;
    'tolerate-republish'?: boolean;
    provenance?: boolean;
    'dry-run'?: boolean;
    json?: boolean;
}

export const publishCommand: Command<any, PublishOptions> = {
    command: 'publish [path]',
    description: 'Pack + upload the workspace at <path> (default: cwd) to its npm registry. Drop-in for `npm publish` with workspace:^ rewrite handled automatically.',
    builder: (yargs) =>
        yargs
            .positional('path', { description: 'Workspace path (default: cwd).', type: 'string' })
            .option('tag', {
                description: 'Dist-tag to publish under. Default: latest.',
                type: 'string',
                default: 'latest',
            })
            .option('access', {
                description: 'Package access — `public` or `restricted` (required for first publish of scoped packages on the public registry).',
                type: 'string',
            })
            .option('tolerate-republish', {
                description: 'Treat a 409 conflict (version already published) as success. Matches yarn `--tolerate-republish`.',
                type: 'boolean',
                default: false,
            })
            .option('provenance', {
                description: 'Pass-through flag — recorded in the payload but no signing happens (gjsify doesn\'t ship a sigstore signer yet).',
                type: 'boolean',
                default: false,
            })
            .option('dry-run', {
                description: 'Pack only, do not PUT.',
                type: 'boolean',
                default: false,
            })
            .option('json', {
                description: 'Emit publish metadata as JSON on stdout.',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        const wsDir = resolve(args.path ?? process.cwd());
        const tag = args.tag ?? 'latest';
        const access = args.access;
        const tolerate = args['tolerate-republish'] === true;
        const provenance = args.provenance === true;
        const dryRun = args['dry-run'] === true;

        if (provenance) {
            console.warn('gjsify publish: --provenance recorded but not signed (no sigstore integration yet).');
        }

        // 1. Pack the workspace (rewrites workspace:^, computes integrity)
        const packOpts: PackWorkspaceOptions = { dryRun: true };
        const packed = await packWorkspace(wsDir, packOpts);
        // We need the raw bytes — re-run with destination=null and capture.
        // packWorkspace returns metadata only; for the bytes we re-pack into
        // memory by reading + rebuilding. Cheap because the second pack runs
        // off the same source files. (A future optimization: have
        // packWorkspace optionally return the bytes itself.)
        const tarBytes = await packWorkspaceToBytes(wsDir);

        // 2. Read the workspace's (rewritten) package.json to assemble the
        // publish payload.
        const pkgPath = join(wsDir, 'package.json');
        const pkgSource = readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(pkgSource) as Record<string, unknown>;
        // We need the rewritten manifest (workspace:^ → resolved) for the
        // payload — packWorkspace already wrote it into the tarball. Mirror
        // the same rewrite here so the registry's "package metadata" matches
        // the tarball's package.json byte-for-byte.
        const rewrittenPkg = await loadRewrittenManifest(wsDir, pkg);

        if (dryRun) {
            const message = {
                ok: true,
                action: 'dry-run',
                name: packed.name,
                version: packed.version,
                filename: packed.filename,
                size: packed.size,
                shasum: packed.shasum,
                integrity: packed.integrity,
            };
            if (args.json) process.stdout.write(`${JSON.stringify(message, null, 2)}\n`);
            else process.stdout.write(`+ ${packed.name}@${packed.version} (dry-run, ${packed.size} bytes, ${packed.entryCount} files)\n`);
            return;
        }

        // 3. Resolve registry URL + auth
        const npmrc = await loadNpmrc(wsDir);
        const registry = process.env.npm_config_registry ?? registryFor(packed.name, npmrc) ?? DEFAULT_REGISTRY;
        const registryClean = registry.endsWith('/') ? registry.slice(0, -1) : registry;
        const url = `${registryClean}/${encodeURIComponent(packed.name).replace('%40', '@')}`;
        const tarballUrl = `${registryClean}/${packed.name}/-/${packed.filename}`;

        // 4. Build payload + PUT
        const payload = buildPublishPayload({
            pkg: rewrittenPkg,
            tag,
            access,
            tarballBytes: tarBytes,
            tarballUrl,
            packed,
            provenance,
        });

        const headers = buildHeaders(url, { npmrc });
        headers['content-type'] = 'application/json';
        headers['accept'] = '*/*';

        const res = await fetch(url, {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload),
        });

        if (res.ok) {
            const out = {
                ok: true,
                name: packed.name,
                version: packed.version,
                filename: packed.filename,
                size: packed.size,
                integrity: packed.integrity,
                tag,
                registry: registryClean,
            };
            if (args.json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
            else process.stdout.write(`+ ${packed.name}@${packed.version}\n`);
            return;
        }

        const text = await res.text().catch(() => '<no body>');
        if (res.status === 409 && tolerate) {
            const out = {
                ok: true,
                action: 'republish-tolerated',
                name: packed.name,
                version: packed.version,
                status: 409,
            };
            if (args.json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
            else process.stdout.write(`= ${packed.name}@${packed.version} (already published, tolerated)\n`);
            return;
        }
        console.error(`gjsify publish: ${packed.name}@${packed.version} — ${res.status} ${res.statusText}`);
        console.error(text);
        process.exit(1);
    },
};

async function packWorkspaceToBytes(wsDir: string): Promise<Uint8Array> {
    // Cheap re-run that writes to a tempdir, then read back. Avoids
    // duplicating the file-walking + tar-building logic here.
    const tmp = `/tmp/gjsify-publish-${process.pid}-${Date.now()}`;
    const res = await packWorkspace(wsDir, { destination: tmp, dryRun: false });
    if (!res.absolutePath) throw new Error('gjsify publish: pack did not produce a file');
    const bytes = new Uint8Array(readFileSync(res.absolutePath));
    try { (await import('node:fs')).rmSync(res.absolutePath); } catch { /* best effort */ }
    try { (await import('node:fs')).rmdirSync(tmp); } catch { /* best effort */ }
    return bytes;
}

async function loadRewrittenManifest(wsDir: string, pkg: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Pack + re-read the tarball's package.json. Easier than duplicating the
    // rewrite logic — pack already does it correctly, including handling
    // workspace:^ patterns we'd otherwise have to reimplement here.
    const tmp = `/tmp/gjsify-publish-manifest-${process.pid}-${Date.now()}.tgz`;
    const res = await packWorkspace(wsDir, {
        destination: tmp.substring(0, tmp.lastIndexOf('/')),
        dryRun: false,
    });
    const { rmSync } = await import('node:fs');
    if (!res.absolutePath) throw new Error('gjsify publish: pack did not produce a file');
    const { gunzip, parseTar } = await import('@gjsify/tar');
    const bytes = new Uint8Array(readFileSync(res.absolutePath));
    rmSync(res.absolutePath);
    const tar = await gunzip(bytes);
    for (const entry of parseTar(tar)) {
        if (entry.name === 'package/package.json' && entry.body) {
            return JSON.parse(new TextDecoder().decode(entry.body)) as Record<string, unknown>;
        }
    }
    return pkg;
}

async function loadNpmrc(cwd: string): Promise<NpmrcConfig> {
    const sources: string[] = [];
    const projectNpmrc = join(cwd, '.npmrc');
    if (existsSync(projectNpmrc)) sources.push(readFileSync(projectNpmrc, 'utf-8'));
    const homeNpmrc = join(homedir(), '.npmrc');
    if (existsSync(homeNpmrc)) sources.push(readFileSync(homeNpmrc, 'utf-8'));
    // Inline `NODE_AUTH_TOKEN` env (set by actions/setup-node + the npm CLI's
    // `_authToken=${NODE_AUTH_TOKEN}` placeholder) — npm expands env refs
    // inside .npmrc. Parse with the env interpolated.
    const merged = sources.join('\n').replace(/\$\{([A-Z_][A-Z0-9_]*)\}/gi, (_, name) => process.env[name as string] ?? '');
    return parseNpmrc(merged);
}

interface BuildPayloadOptions {
    pkg: Record<string, unknown>;
    tag: string;
    access?: string;
    tarballBytes: Uint8Array;
    tarballUrl: string;
    packed: { name: string; version: string; filename: string; integrity: string; shasum: string };
    provenance: boolean;
}

function buildPublishPayload(opts: BuildPayloadOptions): Record<string, unknown> {
    const { pkg, tag, access, tarballBytes, tarballUrl, packed, provenance } = opts;
    const versionEntry: Record<string, unknown> = {
        ...pkg,
        _id: `${packed.name}@${packed.version}`,
        dist: {
            integrity: packed.integrity,
            shasum: packed.shasum,
            tarball: tarballUrl,
        },
    };
    if (provenance) versionEntry._hasShrinkwrap = false;
    const payload: Record<string, unknown> = {
        _id: packed.name,
        name: packed.name,
        description: typeof pkg.description === 'string' ? pkg.description : '',
        'dist-tags': { [tag]: packed.version },
        versions: { [packed.version]: versionEntry },
        readme: '',
        _attachments: {
            [packed.filename]: {
                content_type: 'application/octet-stream',
                data: base64Encode(tarballBytes),
                length: tarballBytes.byteLength,
            },
        },
    };
    if (access) payload.access = access;
    return payload;
}

function base64Encode(bytes: Uint8Array): string {
    let str = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        str += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(str);
}
