// Pure helpers for the npm "Trusted Publishers" (OIDC) registry API, used by
// `gjsify trust`. The wire contract mirrors npm's `trust` command (npm >= 11.10):
//
//   list:   GET    <registry>/-/package/<escaped>/trust            -> [{id,type,claims}]
//   github: POST   <registry>/-/package/<escaped>/trust            body: [{type,claims}]
//   revoke: DELETE <registry>/-/package/<escaped>/trust/<id>
//
// Side-effect-free so it unit-tests without a network; `commands/trust.ts` does the fetch + OTP
// orchestration. Reference: refs/npm-cli/lib/trust-cmd.js + lib/commands/trust/*.js.

import { escapePackageName } from './publish-headers.js';

/** `<registry>/-/package/<@scope%2fname>/trust`. */
export function trustUrl(registry: string, pkgName: string): string {
    const base = registry.endsWith('/') ? registry.slice(0, -1) : registry;
    return `${base}/-/package/${escapePackageName(pkgName)}/trust`;
}

/** `<trustUrl>/<id>` for revoke (the id is path-encoded). */
export function trustRevokeUrl(registry: string, pkgName: string, id: string): string {
    return `${trustUrl(registry, pkgName)}/${encodeURIComponent(id)}`;
}

export interface GithubTrustClaims {
    repository: string;
    workflow_ref: { file: string };
    environment?: string;
}

// Registry permission tokens (npm >= 11.10, the 2026-05-20 trust-API change).
// `createPackage` is what `--allow-publish` grants; `createStagedPackage` is
// `--allow-stage-publish`. The registry rejects a config with no permissions
// (`400 "permissions is required and must contain at least one valid route"`).
export const PERMISSION_PUBLISH = 'createPackage';
export const PERMISSION_STAGE_PUBLISH = 'createStagedPackage';

export interface GithubTrustConfig {
    type: 'github';
    claims: GithubTrustClaims;
    permissions: string[];
}

/** A single entry as returned by the list endpoint. */
export interface TrustEntry {
    id?: string;
    type?: string;
    claims?: {
        repository?: string;
        workflow_ref?: { file?: string };
        environment?: string;
    };
}

/**
 * The POST body for `trust github`: npm always sends an ARRAY with a single config object, and
 * `permissions` is required alongside `type`/`claims`.
 */
export function githubTrustBody(opts: {
    repository: string;
    workflow: string;
    environment?: string;
    permissions?: string[];
}): GithubTrustConfig[] {
    const claims: GithubTrustClaims = {
        repository: opts.repository,
        workflow_ref: { file: normalizeWorkflowFile(opts.workflow) },
    };
    if (opts.environment) claims.environment = opts.environment;
    const permissions = opts.permissions && opts.permissions.length > 0 ? opts.permissions : [PERMISSION_PUBLISH];
    return [{ type: 'github', claims, permissions }];
}

/** npm requires the workflow as a bare basename (no directory), `.yml`/`.yaml`. */
export function normalizeWorkflowFile(wf: string): string {
    const base = wf.split('/').pop() ?? wf;
    return base;
}

/** `owner/repo` — exactly two non-empty segments. */
export function validateRepository(repo: string): boolean {
    const parts = repo.split('/');
    return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
}

/** True when an existing trust entry already grants THIS repo + workflow. */
export function matchesGithubTrust(entry: TrustEntry, opts: { repository: string; workflow: string }): boolean {
    if (entry.type !== 'github') return false;
    const repo = entry.claims?.repository;
    const file = entry.claims?.workflow_ref?.file;
    return repo === opts.repository && file === normalizeWorkflowFile(opts.workflow);
}

export type TrustState = 'trusted' | 'untrusted' | 'unpublished' | 'auth-required' | 'error';

/**
 * Classify a `trust list` response against the desired repo+workflow.
 *   404 → unpublished (package not on the registry yet)
 *   401 → auth-required (OTP / lapsed 2FA-skip window — can't tell the state)
 *   2xx + array with a matching github entry → trusted
 *   2xx + array without a match → untrusted (publish, but not for us)
 *   anything else → error
 */
export function classifyTrustList(
    status: number,
    body: unknown,
    opts: { repository: string; workflow: string },
): TrustState {
    if (status === 404) return 'unpublished';
    if (status === 401) return 'auth-required';
    if (status >= 200 && status < 300) {
        const entries = Array.isArray(body) ? (body as TrustEntry[]) : [];
        return entries.some((e) => matchesGithubTrust(e, opts)) ? 'trusted' : 'untrusted';
    }
    return 'error';
}

/**
 * Derive `owner/repo` from a git remote URL (scp-like `git@host:owner/repo.git` and the
 * `ssh://`/`https://` forms). Null when two segments cannot be confidently extracted.
 */
export function parseRepoFromGitRemote(url: string): string | null {
    let s = url.trim();
    if (!s) return null;
    // npm manifests spell the same URL `git+https://…` / `git+ssh://…`. The
    // scheme prefix is npm's, not the transport's, and without stripping it the
    // scheme match below fails on `+` and the whole URL reads as unparseable —
    // which is indistinguishable from "this package declares no repository".
    s = s.replace(/^git\+/, '');
    s = s.replace(/\.git$/, '');
    const scp = s.match(/^[^/@]+@[^:]+:(.+)$/);
    if (scp) {
        return twoSegments(scp[1]);
    }
    const m = s.match(/^[a-z]+:\/\/[^/]+\/(.+)$/i);
    if (m) {
        return twoSegments(m[1]);
    }
    return null;
}

function twoSegments(path: string): string | null {
    const parts = path.split('/').filter((p) => p.length > 0);
    if (parts.length < 2) return null;
    // The LAST two segments, so a nested group path still yields repo + its owner.
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}
