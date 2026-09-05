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
//   - --verify-timeout / --verify-defer: the post-PUT READ-BACK. npm's 2xx is an
//     accepted write, not a durable one, so a successful PUT is confirmed by
//     asking the registry for that exact version before `+ name@version` is
//     printed. The incident, the measured lag distribution and the choice of
//     window live in `utils/publish-readback.ts`; WHERE the read-back runs and
//     what it costs is argued at its call site below.
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
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { base64Encode } from '../utils/base64.js';
import { DEFAULT_REGISTRY, registryFor } from '@gjsify/npm-registry';
import { buildPublishHeaders, escapePackageName } from '../utils/publish-headers.js';
import { packWorkspace, type PackWorkspaceOptions } from './pack.js';
import { getNpmTrustedToken, hasGithubOidcEnv, OidcExchangeError, OidcUnavailableError } from '../utils/npm-oidc.js';
import { diagnose404, is404DiagnosticCandidate, type Diagnose404Result } from '../utils/publish-diagnose.js';
import {
    DEFAULT_VERIFY_BUDGET_MS,
    formatUnconfirmedPublish,
    verifyPublishedVersion,
    type ReadbackResult,
} from '../utils/publish-readback.js';
import { loadNpmrc } from '../utils/load-npmrc.js';
import { OtpProvider, withOtpRetry, isOtpChallenge } from '../utils/npm-otp.js';
import { promptLine } from '../utils/prompt.js';

interface PublishOptions {
    path?: string;
    tag?: string;
    access?: string;
    otp?: string;
    'tolerate-republish'?: boolean;
    'tolerate-untrusted-new'?: boolean;
    'verify-timeout'?: number;
    'verify-defer'?: boolean;
    provenance?: boolean;
    'dry-run'?: boolean;
    json?: boolean;
    trusted?: boolean | 'auto';
    'check-trusted'?: boolean;
}

export const publishCommand: Command<unknown, PublishOptions> = {
    command: 'publish [path]',
    description:
        'Pack + upload the workspace at <path> (default: cwd) to its npm registry. Drop-in for `npm publish` with workspace:^ rewrite handled automatically.',
    builder: (yargs) =>
        yargs
            .positional('path', { description: 'Workspace path (default: cwd).', type: 'string' })
            .option('tag', {
                description: 'Dist-tag to publish under. Default: latest.',
                type: 'string',
                default: 'latest',
            })
            .option('access', {
                description:
                    'Package access — `public` or `restricted` (required for first publish of scoped packages on the public registry).',
                type: 'string',
            })
            .option('otp', {
                description:
                    'npm 2FA one-time code; sent as the `npm-otp` header. Required for manual publishes from a 2FA-enabled account.',
                type: 'string',
            })
            .option('tolerate-republish', {
                description:
                    'Treat "version already published" as success — covers both classic 409 Conflict and the npm OIDC-path 403 Forbidden + `"previously published"` body shape. Matches yarn `--tolerate-republish`.',
                type: 'boolean',
                default: false,
            })
            .option('tolerate-untrusted-new', {
                description:
                    'Skip (exit 0) when OIDC token exchange returns `package not found` AND no fallback token is configured — i.e. a never-before-published `@scope/<name>` whose Trusted Publisher entry hasn\'t been set up on npmjs.com yet. Without this flag, one un-bootstrapped new package breaks the entire serialized `gjsify foreach publish` loop. Pair with `--tolerate-republish` in CI release workflows so a fresh-merged package gracefully skips its first CI publish, leaving the manual-bootstrap step to a maintainer (see AGENTS.md "New @gjsify/* package: first-publish + Trusted Publisher bootstrap").',
                type: 'boolean',
                default: false,
            })
            .option('verify-timeout', {
                description:
                    'Seconds to keep asking the registry for the just-published version before giving up. npm answers 2xx to a write it has only ACCEPTED: in the v0.46.0 release 19 of 199 packages were recorded 56-252s after their 2xx and one was never recorded at all, so a shorter window turns normal queueing into a false red. `0` disables the read-back — for a registry with no packument read path.',
                type: 'number',
                default: DEFAULT_VERIFY_BUDGET_MS / 1000,
            })
            .option('verify-defer', {
                description:
                    'Report an unconfirmed read-back and exit 0 instead of 1. ONLY for a caller that re-checks the same set afterwards — `gjsify run npm:publish` passes it because `scripts/verify-published-closure.mjs` sweeps the whole roster at the end of release.yml. Everywhere else an unconfirmed publish must fail the job that made it.',
                type: 'boolean',
                default: false,
            })
            .option('provenance', {
                description:
                    "Pass-through flag — recorded in the payload but no signing happens (gjsify doesn't ship a sigstore signer yet).",
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
        const otp = args.otp;
        const tolerate = args['tolerate-republish'] === true;
        const tolerateUntrustedNew = args['tolerate-untrusted-new'] === true;
        const verifySeconds = args['verify-timeout'] ?? DEFAULT_VERIFY_BUDGET_MS / 1000;
        // A non-number reaches here as NaN (yargs coerces `--verify-timeout abc`
        // silently), and NaN would fall through every `> 0` test and turn the
        // read-back OFF without saying so — the failure mode this whole change
        // exists to remove. Refuse it instead.
        if (!Number.isFinite(verifySeconds) || verifySeconds < 0) {
            console.error(
                `gjsify publish: --verify-timeout must be a non-negative number of seconds, got ${JSON.stringify(args['verify-timeout'])}`,
            );
            return process.exit(2);
        }
        const verifyBudgetMs = Math.round(verifySeconds * 1000);
        const deferUnconfirmed = args['verify-defer'] === true;
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
                // `return` — a bare `process.exit()` is deferred under GJS and
                // the check would continue on a nameless manifest.
                return process.exit(2);
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

        // --dry-run: pack only, no PUT. Lifecycle scripts still run so the
        // reported size/hash matches what a real publish would upload.
        if (dryRun) {
            const packed = await packWorkspace(wsDir, {
                dryRun: true,
                lifecycleScripts: ['prepublishOnly', 'prepack'],
                lifecycleStdio: args.json ? 'inherit-stderr' : 'inherit',
            });
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
            else
                process.stdout.write(
                    `+ ${packed.name}@${packed.version} (dry-run, ${packed.size} bytes, ${packed.entryCount} files)\n`,
                );
            return;
        }

        // Real publish. Prompt for a 2FA code only on a TTY; otherwise a
        // challenge surfaces as a clear "re-run with --otp" error rather than a
        // silent hang reading a non-existent terminal. `--otp` seeds the code so
        // it rides the first PUT (matching npm's `--otp` behaviour).
        const interactiveOtp = Boolean(process.stdin.isTTY && process.stdout.isTTY);
        // Scope the shared OTP file cache to this package's registry so a typed
        // code carries over to a sibling `gjsify trust`/`publish` in the window.
        const otpNpmrc = await loadNpmrc(wsDir);
        let otpPkgName: string | undefined;
        try {
            otpPkgName = (JSON.parse(readFileSync(join(wsDir, 'package.json'), 'utf-8')) as { name?: string }).name;
        } catch {
            /* no readable manifest — fall back to the default registry below */
        }
        const otpRegistry =
            process.env.npm_config_registry ??
            (otpPkgName ? registryFor(otpPkgName, otpNpmrc) : undefined) ??
            otpNpmrc.registry ??
            DEFAULT_REGISTRY;
        const otpProvider = new OtpProvider(otp, interactiveOtp ? promptLine : async () => '', {
            registry: otpRegistry,
        });
        const outcome = await publishWorkspace({
            wsDir,
            tag,
            access,
            provenance,
            tolerate,
            tolerateUntrustedNew,
            trustedFlag,
            verbose,
            json: args.json === true,
            otpProvider,
            seedOtpFirst: otp !== undefined,
            verifyBudgetMs,
        });
        reportPublishOutcome(outcome, args.json === true, deferUnconfirmed);
    },
};

/** Input to {@link publishWorkspace} — the token-auth-aware, OTP-shareable publish flow. */
export interface PublishWorkspaceInput {
    /** Workspace directory to pack + publish. */
    wsDir: string;
    tag: string;
    access?: string;
    provenance: boolean;
    /** Treat "already published" as success. */
    tolerate: boolean;
    /** Skip an un-bootstrapped new package on the OIDC path. */
    tolerateUntrustedNew: boolean;
    /** `--trusted` (force OIDC) / `undefined` | `'auto'` (auto-detect). */
    trustedFlag: boolean | 'auto' | undefined;
    /** Registry override. Default: `$npm_config_registry` → scope-aware npmrc → npmjs. */
    registry?: string;
    verbose: boolean;
    /** Redirect lifecycle-script stdout → stderr so `--json` stdout stays clean. */
    json: boolean;
    /** Shared OTP provider — inject ONE across many packages to reuse a single code. */
    otpProvider: OtpProvider;
    /** Send the cached code on the first PUT (publish `--otp`). */
    seedOtpFirst: boolean;
    /**
     * Polling budget for the post-PUT read-back, in ms. Default
     * {@link DEFAULT_VERIFY_BUDGET_MS}; `0` skips the read-back entirely and the
     * returned `published` outcome then carries no `readback` — an UNVERIFIED
     * success, which is the pre-v0.46.0 behaviour and why this defaults on.
     */
    verifyBudgetMs?: number;
}

/** Discriminated result of {@link publishWorkspace}; the caller owns presentation. */
export type PublishOutcome =
    | {
          ok: true;
          action: 'published';
          name: string;
          version: string;
          filename: string;
          size: number;
          integrity: string;
          tag: string;
          registry: string;
          /** The read-back that CONFIRMED it. `undefined` only when disabled. */
          readback?: ReadbackResult;
      }
    /**
     * npm returned 2xx and the registry does not serve the version. Its own
     * outcome on purpose: not `published` (nothing is installable), not
     * `republish-tolerated` (npm never claimed it existed), not `error` (the
     * HTTP exchange succeeded). The v0.46.0 incident had no name at all — it
     * came out as `+ name@version`, exit 0.
     */
    | {
          ok: false;
          action: 'publish-unconfirmed';
          /**
           * What npm claimed before the read-back disagreed: a 2xx (`accepted`)
           * or a tolerated 409 (`already-published`). It selects the remediation
           * sentence, which is the OPPOSITE one for a conflict — re-running
           * answers the same 409.
           */
          claim: 'accepted' | 'already-published';
          name: string;
          version: string;
          registry: string;
          /** The PUT that was accepted. */
          putStatus: number;
          putStatusText: string;
          putUrl: string;
          payloadBytes: number;
          readback: ReadbackResult;
      }
    | {
          ok: true;
          action: 'republish-tolerated';
          name: string;
          version: string;
          status: number;
          /** The read-back that CONFIRMED the conflicting version. */
          readback?: ReadbackResult;
      }
    | { ok: true; action: 'skipped-untrusted-new'; name: string; version: string }
    | { ok: false; action: 'otp-required'; name: string; version: string; status: number }
    | { ok: false; action: 'oidc-failed'; name: string; version: string; error: unknown }
    | { ok: false; action: 'oidc-no-token'; name: string; version: string; error: unknown }
    | { ok: false; action: 'diagnostic'; name: string; version: string; status: number; diag: Diagnose404Result }
    | { ok: false; action: 'error'; name: string; version: string; status: number; statusText: string; text: string };

/**
 * Pack + PUT a single workspace to its npm registry, returning a structured
 * outcome instead of writing/exiting. Extracted from the `publish` command so
 * `gjsify onboard` can drive the SAME publish flow while sharing one
 * {@link OtpProvider} across every package in a sweep.
 *
 * The OTP dance runs through `withOtpRetry(provider)`: the cached code is tried
 * before prompting, so a shared provider needs only one interactive entry for N
 * packages.
 */
export async function publishWorkspace(input: PublishWorkspaceInput): Promise<PublishOutcome> {
    const { wsDir, tag, access, provenance, tolerate, tolerateUntrustedNew, trustedFlag, verbose, json, otpProvider } =
        input;

    // 1. Pack the workspace (rewrites workspace:^, computes integrity).
    // Lifecycle scripts: `prepublishOnly` runs before `prepack` (npm semantics).
    const packOpts: PackWorkspaceOptions = {
        dryRun: true,
        lifecycleScripts: ['prepublishOnly', 'prepack'],
        lifecycleStdio: json ? 'inherit-stderr' : 'inherit',
    };
    const packed = await packWorkspace(wsDir, packOpts);
    const tarBytes = await packWorkspaceToBytes(wsDir);

    // 2. Read the workspace's (rewritten) package.json for the payload.
    const pkgPath = join(wsDir, 'package.json');
    const pkgSource = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgSource) as Record<string, unknown>;
    const rewrittenPkg = await loadRewrittenManifest(wsDir, pkg);

    // 3. Resolve registry URL + auth.
    const npmrc = await loadNpmrc(wsDir);
    const registry =
        input.registry ?? process.env.npm_config_registry ?? registryFor(packed.name, npmrc) ?? DEFAULT_REGISTRY;
    const registryClean = registry.endsWith('/') ? registry.slice(0, -1) : registry;
    // npm-package-arg's escapedName convention (npa.js:188): `@scope/name` →
    // `@scope%2fname` (literal @, lowercase %2f). Match it exactly.
    const escapedName = escapePackageName(packed.name);
    const url = `${registryClean}/${escapedName}`;
    // npm publish convention: the tarball URL + _attachments key use the
    // UNSCOPED basename (`cli-0.4.5.tgz`, not `gjsify-cli-0.4.5.tgz`).
    const unscopedName = packed.name.includes('/') ? packed.name.slice(packed.name.indexOf('/') + 1) : packed.name;
    const wireFilename = `${unscopedName}-${packed.version}.tgz`;
    const tarballUrl = `${registryClean}/${packed.name}/-/${wireFilename}`;

    // 4. Build payload.
    const payload = buildPublishPayload({
        pkg: rewrittenPkg,
        tag,
        access,
        tarballBytes: tarBytes,
        tarballUrl,
        packed: { ...packed, wireFilename },
        provenance,
    });

    // Base headers (npm-command: publish routing header etc.). The OTP is added
    // per-PUT by `doPut` so `withOtpRetry` can retry with different codes.
    const headers = buildPublishHeaders(url, { npmrc });

    // Trusted Publishing (OIDC) path — `--trusted` forces it, `undefined`
    // auto-detects from the GitHub OIDC env. Unused by `gjsify onboard` (local
    // token auth), preserved verbatim for `gjsify publish` in CI.
    const wantTrusted =
        trustedFlag === true || (trustedFlag === undefined && hasGithubOidcEnv() && !process.env.NODE_AUTH_TOKEN);
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
            if (verbose) console.error(`gjsify publish: OIDC token obtained (audience=${audience})`);
        } catch (err) {
            const isUntrustedNewPackage =
                err instanceof OidcExchangeError && err.status === 404 && /package not found/i.test(err.body);
            if (isUntrustedNewPackage && tolerateUntrustedNew) {
                return { ok: true, action: 'skipped-untrusted-new', name: packed.name, version: packed.version };
            }
            if (trustedFlag === true) {
                return { ok: false, action: 'oidc-failed', name: packed.name, version: packed.version, error: err };
            }
            // Auto-detect fallback to token auth — but only if a token exists;
            // refuse to PUT with no credentials (the v0.7.3 silent-drop incident).
            if (!headers['authorization']) {
                return { ok: false, action: 'oidc-no-token', name: packed.name, version: packed.version, error: err };
            }
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

    const bodyStr = JSON.stringify(payload);
    // Each attempt clones the base headers and adds `npm-otp` (+ legacy
    // auth-type, matching buildPublishHeaders) when a code is supplied.
    const doPut = (code?: string): Promise<Response> => {
        const reqHeaders = { ...headers };
        if (code) {
            reqHeaders['npm-otp'] = code;
            reqHeaders['npm-auth-type'] = 'legacy';
        }
        return fetch(url, { method: 'PUT', headers: reqHeaders, body: bodyStr });
    };

    const res = await withOtpRetry(doPut, otpProvider, { seedFirstAttempt: input.seedOtpFirst });

    if (verbose) {
        // The debug output used to print the request and then the `+` success
        // line, so a 200 and a 201 were indistinguishable and no body was ever
        // recorded — which is why reconstructing the v0.46.0 incident needed the
        // registry rather than the log it already had. Print what npm answered.
        // `clone()` because the error path below reads `res.text()` itself.
        console.error(`  response:      ${res.status} ${res.statusText}`);
        const peek = await res
            .clone()
            .text()
            .catch(() => '');
        if (peek) console.error(`  body:          ${peek.slice(0, 300)}`);
    }

    /**
     * Ask the registry for what we just PUT. `undefined` when the read-back is
     * off (`--verify-timeout 0`).
     *
     * The PUT's own `authorization` goes with it: a registry that requires a
     * credential to READ answers 401/403 to an anonymous packument GET, which is
     * an `error` probe, so an intact publish to GitHub Packages or an
     * authenticated Verdaccio would spend the whole budget and then report
     * `publish-unconfirmed`. Same origin, same credential, one request later.
     */
    const readBack = async (): Promise<ReadbackResult | undefined> => {
        const budgetMs = input.verifyBudgetMs ?? DEFAULT_VERIFY_BUDGET_MS;
        if (budgetMs <= 0) return undefined;
        return verifyPublishedVersion({
            registry: registryClean,
            name: packed.name,
            version: packed.version,
            budgetMs,
            authorization: headers['authorization'],
            log: verbose ? (m) => console.error(m) : undefined,
        });
    };

    // A surviving OTP challenge means the provider gave up (no code entered /
    // non-interactive). Surface it so the caller can point at --otp.
    if (await isOtpChallenge(res)) {
        return { ok: false, action: 'otp-required', name: packed.name, version: packed.version, status: res.status };
    }

    if (res.ok) {
        // WHERE THE READ-BACK BELONGS — per package, here, immediately.
        //
        // This path runs ~209 times per release (199 in the serial
        // `foreach --exec` sweep behind `npm:publish`, plus the per-bundle
        // single-package jobs), so its cost is measured rather than assumed:
        //
        //   CONFIRMED ON THE FIRST PROBE — 180 of 199 packages in v0.46.0. One
        //   abbreviated-packument GET, 0.59 s against registry.npmjs.org, so
        //   ~2 min across the whole sweep against a publish job that ran 33 min.
        //
        //   NOT CONFIRMED YET — the other 19. Here the read-back waits out
        //   npm's own write queue, and those residual lags SUM TO 2554 s: a
        //   sweep that waited them all out with the 300 s default would have
        //   added ~43 min to that 33 min job. That single number decides the
        //   shape below.
        //
        // A BATCHED END-OF-SWEEP CHECK CANNOT LIVE IN THIS FILE. `npm:publish`
        // is `gjsify foreach --exec -- gjsify publish`, one CHILD PROCESS per
        // package: there is no in-process hook after the last one to collect a
        // pending set in. So the batched half already sits where it can —
        // `scripts/verify-published-closure.mjs`, its own job at the end of
        // `release.yml`, rounds and retries over the whole roster. It is what
        // named the missing package in the incident.
        //
        // AND A FATAL READ-BACK INSIDE THAT SWEEP WOULD ABORT THE RELEASE, which
        // is the argument the 2554 s only quantifies. `foreach --exec` THROWS on
        // a non-zero child (`foreach.ts`: `exited with code ${result.code}`),
        // and pack time has already rewritten every `workspace:*` to the exact
        // released version — so one lagging package would stop the sweep
        // mid-roster and leave a PARTIAL publish, the state
        // `verify-published-closure.mjs` exists because it is worse than no
        // publish at all. A deferral here is not leniency; it is the only shape
        // that does not trade this incident for that one.
        //
        // Hence BOTH, split along that cost. The read-back runs per package
        // everywhere and is FATAL by default — that is what turns the
        // incident's green single-package job red, for up to 300 s of
        // patience on a job that otherwise ran 59 s. The
        // 199-package sweep passes `--verify-defer --verify-timeout 5`: it
        // still CONFIRMS nine packages in ten and still names the suspect
        // against the package that PUT it, but the minutes-long tail is left to
        // the closure job that re-asks the same question over the same set —
        // which had to be MADE able to answer it (`dist.tarball`, and a
        // propagation retry that never fired for a roster-only name).
        //
        // What the deferred annotation is NOT is the ledger. At a 5 s budget
        // every one of a release's ~19 lagging packages emits one, and GitHub
        // renders only the first few annotations per step (documented as 10 per
        // level; not verified from a run here). The closure job is the fatal
        // half; the annotation points a human at the name.
        const readback = await readBack();
        if (readback?.confirmed && verbose) {
            // The CONFIRMED half of the read-back is printed too, and it is not
            // decoration: it is the only client-side measurement of when a
            // version became RESOLVABLE, as against `time[version]`, which is
            // when the registry recorded the write. The two are assumed equal by
            // the 4.2-minute figure and the 300 s window, and nothing had ever
            // measured the gap. The pre-registered comparison — and what each
            // outcome would change — is in #1509's description; this line, under
            // GJSIFY_PUBLISH_DEBUG (which release.yml sets), is its input. Note
            // the value is quantised by the backoff grid, so it is the UPPER end
            // of a bracket whose lower end is the previous probe.
            console.error(`  read-back:     confirmed after ${readback.attempts} probe(s) in ${readback.elapsedMs} ms`);
        }
        if (readback && !readback.confirmed) {
            return {
                ok: false,
                action: 'publish-unconfirmed',
                claim: 'accepted',
                name: packed.name,
                version: packed.version,
                registry: registryClean,
                putStatus: res.status,
                putStatusText: res.statusText,
                putUrl: url,
                payloadBytes: bodyStr.length,
                readback,
            };
        }
        return {
            ok: true,
            action: 'published',
            name: packed.name,
            version: packed.version,
            filename: packed.filename,
            size: packed.size,
            integrity: packed.integrity,
            tag,
            registry: registryClean,
            readback,
        };
    }

    const text = await res.text().catch(() => '<no body>');
    // "version already published" — 409 Conflict, or 403 + "previously published".
    //
    // READ BACK HERE TOO, and the reason it was first written the other way is
    // worth keeping: a 2xx is npm accepting a write it has not necessarily
    // durably applied, whereas a 409 is npm ASSERTING the version exists and
    // refusing to overwrite it — sounding like a positive statement about the
    // registry's own state rather than a promise about a queued one. The
    // incident's own recovery says otherwise. Attempt 3 re-PUT
    // @gjsify/node-runtime-darwin-arm64 and was answered `409 already
    // published` at 09:48:49.19, while that packument's `time["0.46.0"]` is
    // 09:49:07.419 — 18 s LATER — and the closure job had found the name absent
    // at 09:44:28. So the assertion can precede the version being served, and
    // this is the path a `publish-unconfirmed` re-run always lands on: exempting
    // it would leave the documented remediation reporting a success nothing
    // checked. Cost is one GET, on a path that only runs on a re-publish.
    const isRepublishConflict = res.status === 409 || (res.status === 403 && /previously published/i.test(text));
    if (isRepublishConflict && tolerate) {
        const readback = await readBack();
        if (readback && !readback.confirmed) {
            return {
                ok: false,
                action: 'publish-unconfirmed',
                claim: 'already-published',
                name: packed.name,
                version: packed.version,
                registry: registryClean,
                putStatus: res.status,
                putStatusText: res.statusText,
                putUrl: url,
                payloadBytes: bodyStr.length,
                readback,
            };
        }
        return {
            ok: true,
            action: 'republish-tolerated',
            name: packed.name,
            version: packed.version,
            status: res.status,
            readback,
        };
    }
    // 404 diagnostic (token-auth): disambiguate dead-token vs missing-package.
    if (res.status === 404 && authMode === 'token' && is404DiagnosticCandidate(text)) {
        const diag = await diagnose404({
            packageName: packed.name,
            version: packed.version,
            registry: registryClean,
            npmrc,
        });
        if (diag.reason !== 'unknown') {
            return { ok: false, action: 'diagnostic', name: packed.name, version: packed.version, status: 404, diag };
        }
    }
    return {
        ok: false,
        action: 'error',
        name: packed.name,
        version: packed.version,
        status: res.status,
        statusText: res.statusText,
        text,
    };
}

/**
 * Present a {@link PublishOutcome} on stdout/stderr and exit non-zero on
 * failure — the single-command `gjsify publish` behaviour, reproduced exactly.
 *
 * `deferUnconfirmed` (`--verify-defer`) affects exactly one outcome: it downgrades
 * `publish-unconfirmed` from exit 1 to a printed warning, for a caller that
 * re-checks the same set afterwards. It is policy, so it lives here and not in
 * {@link publishWorkspace}, which stays a pure fact-finder.
 */
function reportPublishOutcome(outcome: PublishOutcome, asJson: boolean, deferUnconfirmed = false): void {
    switch (outcome.action) {
        case 'published': {
            const out = {
                ok: true,
                name: outcome.name,
                version: outcome.version,
                filename: outcome.filename,
                size: outcome.size,
                integrity: outcome.integrity,
                tag: outcome.tag,
                registry: outcome.registry,
            };
            if (asJson) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
            else process.stdout.write(`+ ${outcome.name}@${outcome.version}\n`);
            return;
        }
        case 'publish-unconfirmed': {
            const message = formatUnconfirmedPublish(outcome);
            if (asJson) {
                process.stdout.write(
                    `${JSON.stringify(
                        {
                            ok: false,
                            action: 'publish-unconfirmed',
                            name: outcome.name,
                            version: outcome.version,
                            registry: outcome.registry,
                            claim: outcome.claim,
                            putStatus: outcome.putStatus,
                            probes: outcome.readback.attempts,
                            elapsedMs: outcome.readback.elapsedMs,
                            readbackUrl: outcome.readback.url,
                            readbackState: outcome.readback.last.state,
                            deferred: deferUnconfirmed,
                        },
                        null,
                        2,
                    )}\n`,
                );
            } else {
                process.stderr.write(`${message}\n`);
            }
            // Under `--verify-defer` the multi-line message is one entry in a
            // serial log carrying a line per package, i.e. exactly the channel
            // the incident's `+` line hid in. An annotation renders beside the
            // job's own check and needs no writable file, the same reason
            // `verify-published-closure.mjs` emits its notes as `::warning::`.
            // On STDERR, because `--json` owns stdout.
            if (deferUnconfirmed) {
                if (process.env.GITHUB_ACTIONS) {
                    const claimed =
                        outcome.claim === 'already-published' ? 'was reported already published' : 'was accepted';
                    process.stderr.write(
                        `::warning title=Publish unconfirmed::${outcome.name}@${outcome.version} ${claimed} ` +
                            `(HTTP ${outcome.putStatus}) but did not resolve on ${outcome.registry} within ` +
                            `${(outcome.readback.elapsedMs / 1000).toFixed(1)}s — the release-closure job must confirm it\n`,
                    );
                }
                return;
            }
            return process.exit(1);
        }
        case 'republish-tolerated': {
            const out = {
                ok: true,
                action: 'republish-tolerated',
                name: outcome.name,
                version: outcome.version,
                status: outcome.status,
            };
            if (asJson) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
            else process.stdout.write(`= ${outcome.name}@${outcome.version} (already published, tolerated)\n`);
            return;
        }
        case 'skipped-untrusted-new': {
            if (asJson) {
                process.stdout.write(
                    `${JSON.stringify(
                        {
                            ok: true,
                            action: 'skipped-untrusted-new',
                            name: outcome.name,
                            version: outcome.version,
                            reason: 'no-trusted-publisher',
                        },
                        null,
                        2,
                    )}\n`,
                );
            } else {
                process.stdout.write(
                    `~ ${outcome.name}@${outcome.version} (skipped — no Trusted Publisher on npm, see AGENTS.md "New @gjsify/* package: first-publish + Trusted Publisher bootstrap")\n`,
                );
            }
            return;
        }
        case 'otp-required': {
            console.error(`gjsify publish: npm requires a 2FA one-time code — re-run with \`--otp <code>\``);
            return process.exit(1);
        }
        case 'oidc-failed': {
            handleOidcFailure(outcome.error, outcome.name, asJson);
            return process.exit(1);
        }
        case 'oidc-no-token': {
            const msg = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
            console.error(
                `gjsify publish: OIDC token exchange failed for ${outcome.name} (${msg}) and no fallback npm token is configured — refusing to publish without credentials.`,
            );
            if (asJson) {
                process.stdout.write(
                    `${JSON.stringify(
                        { ok: false, name: outcome.name, version: outcome.version, error: 'oidc-failed-no-token' },
                        null,
                        2,
                    )}\n`,
                );
            }
            return process.exit(1);
        }
        case 'diagnostic': {
            if (asJson) {
                process.stdout.write(
                    `${JSON.stringify(
                        {
                            ok: false,
                            name: outcome.name,
                            version: outcome.version,
                            status: 404,
                            diagnostic: outcome.diag.reason,
                            username: outcome.diag.username,
                        },
                        null,
                        2,
                    )}\n`,
                );
            } else {
                process.stderr.write(`${outcome.diag.message}\n`);
            }
            return process.exit(1);
        }
        case 'error': {
            console.error(
                `gjsify publish: ${outcome.name}@${outcome.version} — ${outcome.status} ${outcome.statusText}`,
            );
            console.error(outcome.text);
            return process.exit(1);
        }
    }
}

async function packWorkspaceToBytes(wsDir: string): Promise<Uint8Array> {
    // Cheap re-run that writes to a tempdir, then read back. Avoids
    // duplicating the file-walking + tar-building logic here. Lifecycle
    // scripts are already run by the outer publish flow's first pack
    // call — passing `[]` here skips re-running them (idempotent for
    // most projects but a needless cost otherwise).
    // `tmpdir()`, not a literal `/tmp`. `pack` resolves its destination and
    // creates it recursively, so on Windows the literal produced `C:\tmp\…` at
    // the DRIVE ROOT — created on every publish, and only the inner directory
    // was removed afterwards, so `C:\tmp` was left behind for good. On an image
    // where the drive root is not writable it failed outright.
    const tmp = join(tmpdir(), `gjsify-publish-${process.pid}-${Date.now()}`);
    const res = await packWorkspace(wsDir, {
        destination: tmp,
        dryRun: false,
        lifecycleScripts: [],
    });
    if (!res.absolutePath) throw new Error('gjsify publish: pack did not produce a file');
    const bytes = new Uint8Array(readFileSync(res.absolutePath));
    try {
        (await import('node:fs')).rmSync(res.absolutePath);
    } catch {
        /* best effort */
    }
    try {
        (await import('node:fs')).rmdirSync(tmp);
    } catch {
        /* best effort */
    }
    return bytes;
}

async function loadRewrittenManifest(wsDir: string, pkg: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Pack + re-read the tarball's package.json. Easier than duplicating the
    // rewrite logic — pack already does it correctly, including handling
    // workspace:^ patterns we'd otherwise have to reimplement here.
    // Only the DIRECTORY is passed to pack, so build it directly instead of
    // composing a filename and slicing it back off at the last `/` — which on
    // Windows found no separator in `C:\Users\…\gjsify-publish-manifest-…` and
    // handed pack a truncated path. Same `/tmp`-at-the-drive-root problem as
    // above on top of it.
    const dest = join(tmpdir(), `gjsify-publish-manifest-${process.pid}-${Date.now()}`);
    const res = await packWorkspace(wsDir, {
        destination: dest,
        dryRun: false,
    });
    const { rmSync } = await import('node:fs');
    if (!res.absolutePath) throw new Error('gjsify publish: pack did not produce a file');
    const { gunzip, parseTar } = await import('@gjsify/tar');
    const bytes = new Uint8Array(readFileSync(res.absolutePath));
    // The whole per-call directory, not just the tarball inside it — the
    // destination is now unique per invocation, so leaving it behind would grow
    // the temp directory once per publish.
    rmSync(dest, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    const tar = await gunzip(bytes);
    for (const entry of parseTar(tar)) {
        if (entry.name === 'package/package.json' && entry.body) {
            return JSON.parse(new TextDecoder().decode(entry.body)) as Record<string, unknown>;
        }
    }
    return pkg;
}

interface BuildPayloadOptions {
    pkg: Record<string, unknown>;
    tag: string;
    access?: string;
    tarballBytes: Uint8Array;
    tarballUrl: string;
    packed: {
        name: string;
        version: string;
        filename: string;
        integrity: string;
        shasum: string;
        wireFilename: string;
    };
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

function handleOidcFailure(err: unknown, packageName: string, asJson: boolean): void {
    if (err instanceof OidcUnavailableError) {
        const msg = `gjsify publish: OIDC not available — ${err.message}`;
        if (asJson)
            process.stdout.write(
                `${JSON.stringify({ ok: false, name: packageName, error: 'oidc-unavailable', reason: err.reason, message: err.message })}\n`,
            );
        else process.stderr.write(`${msg}\n`);
        return;
    }
    if (err instanceof OidcExchangeError) {
        const friendly =
            err.status === 401 || err.status === 403
                ? `npm rejected the OIDC exchange (${err.status}) — check that ${packageName} has a Trusted Publisher configured at https://www.npmjs.com/package/${encodeURIComponent(packageName)}/access pointing at this workflow.`
                : err.message;
        if (asJson)
            process.stdout.write(
                `${JSON.stringify({ ok: false, name: packageName, error: 'oidc-exchange', status: err.status, body: err.body, claims: err.claims, message: err.message })}\n`,
            );
        else {
            process.stderr.write(`✗ ${packageName}: ${friendly}\n`);
            // Diagnostics: the raw npm body often names the rejected claim, and
            // the decoded JWT claims are exactly what the TP config must match
            // (repository + workflow_ref + environment). Print both so a 401 is
            // actionable without re-running in --json/--verbose mode.
            if (err.body) process.stderr.write(`    ↳ npm said: ${err.body.slice(0, 300)}\n`);
            if (err.claims) {
                const c = err.claims;
                const shown = [
                    'aud',
                    'iss',
                    'repository',
                    'repository_owner',
                    'workflow_ref',
                    'job_workflow_ref',
                    'ref',
                    'environment',
                    'sub',
                ]
                    .filter((k) => c[k] !== undefined)
                    .map((k) => `${k}=${JSON.stringify(c[k])}`)
                    .join(', ');
                if (shown) process.stderr.write(`    ↳ JWT claims npm received: ${shown}\n`);
            }
        }
        return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (asJson)
        process.stdout.write(`${JSON.stringify({ ok: false, name: packageName, error: 'unknown', message: msg })}\n`);
    else process.stderr.write(`✗ ${packageName}: ${msg}\n`);
}
