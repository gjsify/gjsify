// SPDX-License-Identifier: MIT
// Unit coverage for `gjsify onboard` helpers.

import { describe, expect, it } from '@gjsify/unit';
import type { PublishOutcome } from './publish.js';
import { describePublishFailure } from './onboard.js';

export default async () => {
    await describe('describePublishFailure', async () => {
        await it('names the OIDC error for oidc-failed', async () => {
            const pub: PublishOutcome = {
                ok: false,
                action: 'oidc-failed',
                name: '@gjsify/model-store',
                version: '0.64.20',
                error: new Error('package not found'),
            };
            const detail = describePublishFailure(pub);
            expect(detail.includes('OIDC token exchange failed')).toBe(true);
            expect(detail.includes('package not found')).toBe(true);
        });

        await it('names the OIDC error for oidc-no-token', async () => {
            const pub: PublishOutcome = {
                ok: false,
                action: 'oidc-no-token',
                name: '@gjsify/model-store',
                version: '0.64.20',
                error: new Error('no GitHub OIDC token available'),
            };
            const detail = describePublishFailure(pub);
            expect(detail.includes('OIDC token exchange unavailable and no fallback token')).toBe(true);
            expect(detail.includes('no GitHub OIDC token available')).toBe(true);
        });

        await it('surfaces non-Error OIDC errors via String()', async () => {
            const pub: PublishOutcome = {
                ok: false,
                action: 'oidc-failed',
                name: '@gjsify/model-store',
                version: '0.64.20',
                error: { message: 'plain object error' } as unknown,
            };
            const detail = describePublishFailure(pub);
            expect(detail.includes('[object Object]')).toBe(true);
        });

        await it('describes a held-unpublished-dependency with the blocking pins', async () => {
            const pub: PublishOutcome = {
                ok: false,
                action: 'held-unpublished-dependency',
                name: '@gjsify/consumer',
                version: '0.64.20',
                registry: 'https://registry.npmjs.org',
                reasons: [
                    {
                        block: 'dependencies',
                        name: '@gjsify/dep',
                        version: '0.64.20',
                        cls: 'validating',
                        detail: 'validating',
                    },
                ],
            };
            const detail = describePublishFailure(pub);
            expect(detail.includes('held until the dependency is available')).toBe(true);
            expect(detail.includes('@gjsify/dep@0.64.20 (validating)')).toBe(true);
        });

        await it('includes the body text for a plain HTTP error', async () => {
            const pub: PublishOutcome = {
                ok: false,
                action: 'error',
                name: '@gjsify/model-store',
                version: '0.64.20',
                status: 500,
                statusText: 'Internal Server Error',
                text: 'registry exploded',
            };
            const detail = describePublishFailure(pub);
            expect(detail.includes('HTTP 500 Internal Server Error')).toBe(true);
            expect(detail.includes('registry exploded')).toBe(true);
        });

        await it('keeps the publish-unconfirmed message detailed', async () => {
            const pub: PublishOutcome = {
                ok: false,
                action: 'publish-unconfirmed',
                claim: 'accepted',
                name: '@gjsify/model-store',
                version: '0.64.20',
                registry: 'https://registry.npmjs.org',
                putStatus: 201,
                putStatusText: 'Created',
                putUrl: 'https://registry.npmjs.org/@gjsify%2fmodel-store',
                payloadBytes: 1234,
                readback: {
                    confirmed: false,
                    attempts: 3,
                    elapsedMs: 5000,
                    verdict: 'not-published',
                    verdictDetail: 'no record of the version',
                    url: 'https://registry.npmjs.org/@gjsify%2fmodel-store',
                    last: { state: 'absent', status: 404, detail: 'not found' },
                },
                classification: { cls: 'unchecked', detail: 'no status token', terminal: false },
            };
            const detail = describePublishFailure(pub);
            expect(detail.includes('accepted the upload')).toBe(true);
            expect(detail.includes('@gjsify/model-store@0.64.20')).toBe(true);
            expect(detail.includes('not-published')).toBe(true);
        });

        await it('describes blocked-missing-dependency with the missing pins', async () => {
            const pub: PublishOutcome = {
                ok: false,
                action: 'blocked-missing-dependency',
                name: '@gjsify/bridge',
                version: '0.64.20',
                registry: 'https://registry.npmjs.org',
                tolerated: false,
                missing: [{ block: 'dependencies', name: '@gjsify/target', spec: '^0.64.20' }],
            };
            const detail = describePublishFailure(pub);
            expect(detail.includes('@gjsify/target@^0.64.20')).toBe(true);
            expect(detail.includes('Bootstrap the target BEFORE its dependent')).toBe(true);
        });

        await it('describes a diagnostic 404 with the reason', async () => {
            const pub: PublishOutcome = {
                ok: false,
                action: 'diagnostic',
                name: '@gjsify/model-store',
                version: '0.64.20',
                status: 404,
                diag: { reason: 'missing-package', message: 'package does not exist' },
            };
            const detail = describePublishFailure(pub);
            expect(detail.includes('HTTP 404 (missing-package)')).toBe(true);
        });

        await it('describes an OTP challenge', async () => {
            const pub: PublishOutcome = {
                ok: false,
                action: 'otp-required',
                name: '@gjsify/model-store',
                version: '0.64.20',
                status: 401,
            };
            const detail = describePublishFailure(pub);
            expect(detail.includes('2FA code')).toBe(true);
        });
    });
};
