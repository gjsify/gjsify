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
//   - --tolerate-republish: surface a 409 conflict (or 403 with a
//     "previously published" body — the OIDC-path response shape) as a
//     notice + exit 0 (matches yarn's flag of the same name).
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
import {
    getNpmTrustedToken,
    hasGithubOidcEnv,
    OidcExchangeError,
    OidcUnavailableError,
} from '../utils/npm-oidc.js';

interface PublishOptions {
    path?: string;
    tag?: string;
    access?: string;
    'tolerate-republish'?: boolean;
    provenance?: boolean;
    'dry-run'?: boolean;
    json?: boolean;
    trusted?: boolean | 'auto';
    'check-trusted'?: boolean;
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
                description: 'Treat "version already published" as success — covers both classic 409 Conflict and the npm OIDC-path 403 Forbidden + `"previously published"` body shape. Matches yarn `--tolerate-republish`.',
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
            })
            .option('trusted', {
                description:
                    'Authenticate via npm Trusted Publishing (OIDC): exchange the GitHub Actions id-token for a short-lived npm token. ' +
                    'Pass `--trusted` to force this mode (errors if env vars missing). ' +
                    'Omit to auto-detect: OIDC is used iff `ACTIONS_ID_TOKEN_REQUEST_URL`+`_TOKEN` are set AND no `_authToken` is present in the resolved npmrc; otherwise the long-lived token path is used. ' +
                    'Requires the calling workflow to declare `permissions: id-token: write` AND the target package to have a Trusted Publisher configured on npmjs.com.',
                type: 'boolean',
                default: undefined,
            })
            .option('check-trusted', {
                description:
                    'Diagnostic mode: perform the OIDC id-token request + npm token exchange, report success/failure, then exit WITHOUT publishing. Useful as a bulk-verifier (e.g. via `gjsify foreach publish --check-trusted`) to confirm Trusted Publisher config across many packages.',
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
        const checkTrustedOnly = args['check-trusted'] === true;
        const trustedFlag = args.trusted;
        const verbose = Boolean(process.env.GJSIFY_PUBLISH_DEBUG);

        if (provenance) {
            console.warn('gjsify publish: --provenance recorded but not signed (no sigstore integration yet).');
        }

        // `--check-trusted` short-circuits the entire pack + publish flow.
        // Reports the OIDC exchange result for the workspace's package and
        // exits 0 either way — by design, so `gjsify foreach publish
        // --check-trusted` walks every workspace without bailing on the
        // first misconfigured one. CI can grep `^✗ ` (or parse `--json`
        // entries with `ok: false`) to surface failures.
        if (checkTrustedOnly) {
            const rawPkgPath = join(wsDir, 'package.json');
            const rawPkg = JSON.parse(readFileSync(rawPkgPath, 'utf-8')) as { name?: string; private?: boolean };
            if (typeof rawPkg.name !== 'string') {
                process.stderr.write(`gjsify publish --check-trusted: ${rawPkgPath} has no \`name\` field\n`);
                process.exit(2);
            }
            if (rawPkg.private === true) {
                const out = { ok: true, action: 'check-trusted', name: rawPkg.name, skipped: 'private' };
                if (args.json) process.stdout.write(`${JSON.stringify(out)}\n`);
                else process.stdout.write(`- ${rawPkg.name}: skipped (private package)\n`);
                return;
            }
            const npmrcCheck = await loadNpmrc(wsDir);
            const registry =
                process.env.npm_config_registry ?? registryFor(rawPkg.name, npmrcCheck) ?? DEFAULT_REGISTRY;
            try {
                await getNpmTrustedToken({
                    packageName: rawPkg.name,
                    registry,
                    log: verbose ? (m) => console.error(m) : undefined,
                });
                const out = { ok: true, action: 'check-trusted', name: rawPkg.name, registry };
                if (args.json) process.stdout.write(`${JSON.stringify(out)}\n`);
                else process.stdout.write(`✓ ${rawPkg.name}: trusted publisher OK\n`);
                return;
            } catch (err) {
                handleOidcFailure(err, rawPkg.name, args.json === true);
                // Report-mode: exit 0 so `gjsify foreach` keeps walking. The
                // `✗ <name>: <reason>` (or JSON `ok:false`) line is the
                // failure signal for CI to grep / parse.
                return;
            }
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
        // npm-package-arg's escapedName convention for scoped packages:
        // `@${scope-without-leading-@}%2f${name}` (lowercase %2f, literal @).
        // Unscoped: `encodeURIComponent(name)`. Match it exactly — the
        // npm registry is picky about the publish PUT URL shape.
        const escapedName = packed.name.startsWith('@')
            ? (() => {
                const slash = packed.name.indexOf('/');
                const scope = packed.name.slice(1, slash);
                const base = packed.name.slice(slash + 1);
                return `@${encodeURIComponent(scope)}%2f${encodeURIComponent(base)}`;
            })()
            : encodeURIComponent(packed.name);
        const url = `${registryClean}/${escapedName}`;
        // npm publish convention: the dist.tarball URL + _attachments key both
        // use the UNSCOPED basename — `cli-0.4.5.tgz`, not
        // `gjsify-cli-0.4.5.tgz`. This is what libnpmpublish does (see
        // `attachments[\`${unscopedName}-${version}.tgz\`]` in
        // libnpmpublish/lib/publish.js). The full scoped filename is what
        // `npm pack` writes to disk, but the registry stores tarballs at
        // the unscoped path.
        const unscopedName = packed.name.includes('/')
            ? packed.name.slice(packed.name.indexOf('/') + 1)
            : packed.name;
        const wireFilename = `${unscopedName}-${packed.version}.tgz`;
        const tarballUrl = `${registryClean}/${packed.name}/-/${wireFilename}`;

        // 4. Build payload + PUT
        const payload = buildPublishPayload({
            pkg: rewrittenPkg,
            tag,
            access,
            tarballBytes: tarBytes,
            tarballUrl,
            packed: { ...packed, wireFilename },
            provenance,
        });

        const headers = buildHeaders(url, { npmrc });
        headers['content-type'] = 'application/json';
        headers['accept'] = '*/*';

        // Trusted Publishing path. `--trusted` forces OIDC (errors if env
        // vars are missing); the default `undefined` triggers auto-detect:
        // OIDC is used iff GitHub OIDC env vars are present AND no
        // `NODE_AUTH_TOKEN` is set. With `NODE_AUTH_TOKEN` set the user has
        // explicitly opted into token auth, so we don't shadow their choice.
        const wantTrusted =
            trustedFlag === true ||
            (trustedFlag === undefined && hasGithubOidcEnv() && !process.env.NODE_AUTH_TOKEN);
        let authMode: 'token' | 'oidc' = 'token';
        if (wantTrusted) {
            try {
                const { token: oidcToken, audience } = await getNpmTrustedToken({
                    packageName: packed.name,
                    registry,
                    log: verbose ? (m) => console.error(m) : undefined,
                });
                headers['authorization'] = `Bearer ${oidcToken}`;
                authMode = 'oidc';
                if (verbose) {
                    console.error(`gjsify publish: OIDC token obtained (audience=${audience})`);
                }
            } catch (err) {
                if (trustedFlag === true) {
                    // Explicit --trusted: bail with a clear error.
                    handleOidcFailure(err, packed.name, args.json === true);
                    process.exit(1);
                }
                // Auto-detect: fall back to whatever buildHeaders found.
                if (verbose) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.error(`gjsify publish: OIDC auto-detect failed (${msg}) — falling back to token auth`);
                }
            }
        }

        if (verbose) {
            console.error(`gjsify publish: PUT ${url} (${packed.name}@${packed.version})`);
            console.error(`  auth-mode:     ${authMode}`);
            console.error(`  authorization: ${headers['authorization'] ? '(set)' : '(none)'}`);
            console.error(`  payload size:  ${JSON.stringify(payload).length} bytes`);
        }

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
        // npm signals "version already published" via two distinct shapes:
        //   - HTTP 409 Conflict (classic libnpmpublish behaviour)
        //   - HTTP 403 Forbidden with body
        //     `{"error":"You cannot publish over the previously published
        //     versions: <ver>."}` (observed on the OIDC publish path
        //     starting around npm registry's 2026-05 changes — same
        //     idempotency outcome, different status code)
        // Both are intentionally tolerated under --tolerate-republish so
        // that re-running a release workflow after a partial failure does
        // not error on the already-published packages.
        const isRepublishConflict =
            res.status === 409 ||
            (res.status === 403 && /previously published/i.test(text));
        if (isRepublishConflict && tolerate) {
            const out = {
                ok: true,
                action: 'republish-tolerated',
                name: packed.name,
                version: packed.version,
                status: res.status,
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
    // npm CLI's npmrc resolution order (lowest → highest precedence):
    //   1. globalconfig:  /etc/npmrc  (system)
    //   2. userconfig:    $NPM_CONFIG_USERCONFIG  (overrides ~/.npmrc)
    //                     or ~/.npmrc  (default)
    //   3. projectconfig: ./.npmrc  (closest)
    //
    // actions/setup-node writes the auth-token npmrc to $RUNNER_TEMP/.npmrc
    // and exports NPM_CONFIG_USERCONFIG pointing at it — it does NOT touch
    // ~/.npmrc. Honor the env var so CI authentication works end-to-end.
    const sources: string[] = [];
    const projectNpmrc = join(cwd, '.npmrc');
    if (existsSync(projectNpmrc)) sources.push(readFileSync(projectNpmrc, 'utf-8'));
    const userConfig = process.env.NPM_CONFIG_USERCONFIG;
    if (userConfig && existsSync(userConfig)) {
        sources.push(readFileSync(userConfig, 'utf-8'));
    } else {
        const homeNpmrc = join(homedir(), '.npmrc');
        if (existsSync(homeNpmrc)) sources.push(readFileSync(homeNpmrc, 'utf-8'));
    }
    // Inline `${VAR}` placeholders (npm CLI's expand-on-read behavior).
    // The auth-token npmrc from actions/setup-node ships
    // `_authToken=${NODE_AUTH_TOKEN}` as a literal placeholder; the env var
    // is set on the publish step.
    const merged = sources.join('\n').replace(/\$\{([A-Z_][A-Z0-9_]*)\}/gi, (_, name) => process.env[name as string] ?? '');
    return parseNpmrc(merged);
}

interface BuildPayloadOptions {
    pkg: Record<string, unknown>;
    tag: string;
    access?: string;
    tarballBytes: Uint8Array;
    tarballUrl: string;
    packed: { name: string; version: string; filename: string; integrity: string; shasum: string; wireFilename: string };
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
            [packed.wireFilename]: {
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

function handleOidcFailure(err: unknown, packageName: string, asJson: boolean): void {
    if (err instanceof OidcUnavailableError) {
        const msg = `gjsify publish: OIDC not available — ${err.message}`;
        if (asJson) process.stdout.write(`${JSON.stringify({ ok: false, name: packageName, error: 'oidc-unavailable', reason: err.reason, message: err.message })}\n`);
        else process.stderr.write(`${msg}\n`);
        return;
    }
    if (err instanceof OidcExchangeError) {
        const friendly = err.status === 401 || err.status === 403
            ? `npm rejected the OIDC exchange (${err.status}) — check that ${packageName} has a Trusted Publisher configured at https://www.npmjs.com/package/${encodeURIComponent(packageName)}/access pointing at this workflow.`
            : err.message;
        if (asJson) process.stdout.write(`${JSON.stringify({ ok: false, name: packageName, error: 'oidc-exchange', status: err.status, body: err.body, message: err.message })}\n`);
        else process.stderr.write(`✗ ${packageName}: ${friendly}\n`);
        return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (asJson) process.stdout.write(`${JSON.stringify({ ok: false, name: packageName, error: 'unknown', message: msg })}\n`);
    else process.stderr.write(`✗ ${packageName}: ${msg}\n`);
}
