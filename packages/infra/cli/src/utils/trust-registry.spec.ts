import { describe, it, expect } from '@gjsify/unit';

import {
    classifyTrustList,
    githubTrustBody,
    matchesGithubTrust,
    normalizeWorkflowFile,
    parseRepoFromGitRemote,
    trustRevokeUrl,
    trustUrl,
    validateRepository,
    type TrustEntry,
} from './trust-registry.js';

export default async () => {
    await describe('trust-registry URLs', async () => {
        await it('escapes the scope slash to %2f', async () => {
            expect(trustUrl('https://registry.npmjs.org/', '@gjsify/fs')).toBe(
                'https://registry.npmjs.org/-/package/@gjsify%2ffs/trust',
            );
        });
        await it('trims a trailing slash on the registry', async () => {
            expect(trustUrl('https://r.example.com', 'left-pad')).toBe(
                'https://r.example.com/-/package/left-pad/trust',
            );
        });
        await it('revoke URL path-encodes the id', async () => {
            expect(trustRevokeUrl('https://registry.npmjs.org/', '@gjsify/fs', 'a b/c')).toBe(
                'https://registry.npmjs.org/-/package/@gjsify%2ffs/trust/a%20b%2Fc',
            );
        });
    });

    await describe('trust-registry githubTrustBody', async () => {
        await it('is an array with one github config', async () => {
            const body = githubTrustBody({ repository: 'gjsify/gjsify', workflow: 'release.yml' });
            expect(Array.isArray(body)).toBe(true);
            expect(body.length).toBe(1);
            expect(body[0].type).toBe('github');
            expect(body[0].claims.repository).toBe('gjsify/gjsify');
            expect(body[0].claims.workflow_ref.file).toBe('release.yml');
            expect('environment' in body[0].claims).toBe(false);
            // permissions is required by the registry (--allow-publish → createPackage).
            expect(body[0].permissions.length).toBe(1);
            expect(body[0].permissions[0]).toBe('createPackage');
        });
        await it('includes environment only when given', async () => {
            const body = githubTrustBody({ repository: 'o/r', workflow: 'release.yml', environment: 'prod' });
            expect(body[0].claims.environment).toBe('prod');
        });
        await it('reduces a workflow path to its basename', async () => {
            const body = githubTrustBody({ repository: 'o/r', workflow: '.github/workflows/release.yml' });
            expect(body[0].claims.workflow_ref.file).toBe('release.yml');
        });
    });

    await describe('trust-registry normalizeWorkflowFile + validateRepository', async () => {
        await it('strips directories', async () => {
            expect(normalizeWorkflowFile('.github/workflows/release.yml')).toBe('release.yml');
            expect(normalizeWorkflowFile('release.yml')).toBe('release.yml');
        });
        await it('validates owner/repo', async () => {
            expect(validateRepository('gjsify/gjsify')).toBe(true);
            expect(validateRepository('gjsify')).toBe(false);
            expect(validateRepository('a/b/c')).toBe(false);
            expect(validateRepository('/x')).toBe(false);
        });
    });

    await describe('trust-registry matchesGithubTrust', async () => {
        const opts = { repository: 'gjsify/gjsify', workflow: 'release.yml' };
        await it('matches on repo + workflow basename', async () => {
            const e: TrustEntry = {
                type: 'github',
                claims: { repository: 'gjsify/gjsify', workflow_ref: { file: 'release.yml' } },
            };
            expect(matchesGithubTrust(e, opts)).toBe(true);
        });
        await it('rejects a different repo', async () => {
            const e: TrustEntry = {
                type: 'github',
                claims: { repository: 'other/repo', workflow_ref: { file: 'release.yml' } },
            };
            expect(matchesGithubTrust(e, opts)).toBe(false);
        });
        await it('rejects a different workflow', async () => {
            const e: TrustEntry = {
                type: 'github',
                claims: { repository: 'gjsify/gjsify', workflow_ref: { file: 'ci.yml' } },
            };
            expect(matchesGithubTrust(e, opts)).toBe(false);
        });
        await it('rejects a non-github provider', async () => {
            const e: TrustEntry = {
                type: 'gitlab',
                claims: { repository: 'gjsify/gjsify', workflow_ref: { file: 'release.yml' } },
            };
            expect(matchesGithubTrust(e, opts)).toBe(false);
        });
    });

    await describe('trust-registry classifyTrustList', async () => {
        const opts = { repository: 'gjsify/gjsify', workflow: 'release.yml' };
        await it('404 → unpublished', async () => {
            expect(classifyTrustList(404, undefined, opts)).toBe('unpublished');
        });
        await it('401 → auth-required', async () => {
            expect(classifyTrustList(401, undefined, opts)).toBe('auth-required');
        });
        await it('200 with a matching entry → trusted', async () => {
            const body = [
                { type: 'github', claims: { repository: 'gjsify/gjsify', workflow_ref: { file: 'release.yml' } } },
            ];
            expect(classifyTrustList(200, body, opts)).toBe('trusted');
        });
        await it('200 with no match → untrusted', async () => {
            expect(classifyTrustList(200, [], opts)).toBe('untrusted');
            const other = [{ type: 'github', claims: { repository: 'x/y', workflow_ref: { file: 'release.yml' } } }];
            expect(classifyTrustList(200, other, opts)).toBe('untrusted');
        });
        await it('500 → error', async () => {
            expect(classifyTrustList(500, undefined, opts)).toBe('error');
        });
    });

    await describe('trust-registry parseRepoFromGitRemote', async () => {
        await it('parses scp-like SSH', async () => {
            expect(parseRepoFromGitRemote('git@github.com:gjsify/gjsify.git')).toBe('gjsify/gjsify');
        });
        await it('parses https with .git', async () => {
            expect(parseRepoFromGitRemote('https://github.com/gjsify/gjsify.git')).toBe('gjsify/gjsify');
        });
        await it('parses https without .git', async () => {
            expect(parseRepoFromGitRemote('https://github.com/gjsify/gjsify')).toBe('gjsify/gjsify');
        });
        await it('parses ssh:// URL', async () => {
            expect(parseRepoFromGitRemote('ssh://git@github.com/gjsify/gjsify.git')).toBe('gjsify/gjsify');
        });
        await it('takes the last two segments of a nested path', async () => {
            expect(parseRepoFromGitRemote('https://gitlab.com/group/sub/proj.git')).toBe('sub/proj');
        });
        await it("parses npm's git+ manifest spelling", async () => {
            // The shape every `@girs/*` package.json carries. Unparsed, it reads
            // as "declares no repository" — the one answer that disables the
            // cross-repo guard that consumes it.
            expect(parseRepoFromGitRemote('git+https://github.com/gjsify/types.git')).toBe('gjsify/types');
            expect(parseRepoFromGitRemote('git+ssh://git@github.com/gjsify/types.git')).toBe('gjsify/types');
        });
        await it('returns null for junk', async () => {
            expect(parseRepoFromGitRemote('')).toBe(null);
            expect(parseRepoFromGitRemote('not-a-url')).toBe(null);
        });
    });
};
