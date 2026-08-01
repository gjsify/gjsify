// SPDX-License-Identifier: MIT
// Ported from refs/mcp-typescript-sdk/test/shared/toolNameValidation.test.ts (v1.29.0)
// Original: Copyright (c) Anthropic, PBC. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Pure-JS validation routine — exercises @gjsify regex/string handling for
// MCP's tool-name rules (1..128 chars, restricted character set, advisory
// warnings for confusing patterns).

import { describe, it, expect } from '@gjsify/unit';
import { validateToolName, validateAndWarnToolName } from '@modelcontextprotocol/sdk/shared/toolNameValidation.js';

export default async () => {
    await describe('validateToolName — valid tool names', async () => {
        const validCases: Array<[string, string]> = [
            ['simple alphanumeric names', 'getUser'],
            ['names with underscores', 'get_user_profile'],
            ['names with dashes', 'user-profile-update'],
            ['names with dots', 'admin.tools.list'],
            ['mixed character names', 'DATA_EXPORT_v2.1'],
            ['single character names', 'a'],
            ['128 character names', 'a'.repeat(128)],
        ];
        for (const [desc, name] of validCases) {
            await it(`should accept ${desc}`, async () => {
                const result = validateToolName(name);
                expect(result.isValid).toBe(true);
                expect(result.warnings.length).toBe(0);
            });
        }
    });

    await describe('validateToolName — invalid tool names', async () => {
        const invalidCases: Array<[string, string, string]> = [
            ['empty names', '', 'Tool name cannot be empty'],
            [
                'names longer than 128 characters',
                'a'.repeat(129),
                'Tool name exceeds maximum length of 128 characters (current: 129)',
            ],
            ['names with spaces', 'get user profile', 'Tool name contains invalid characters: " "'],
            ['names with commas', 'get,user,profile', 'Tool name contains invalid characters: ","'],
            ['names with forward slashes', 'user/profile/update', 'Tool name contains invalid characters: "/"'],
            ['names with @ characters', 'user@domain.com', 'Tool name contains invalid characters: "@"'],
            [
                'names with multiple invalid chars',
                'user name@domain,com',
                'Tool name contains invalid characters: " ", "@", ","',
            ],
            ['names with unicode characters', 'user-ñame', 'Tool name contains invalid characters: "ñ"'],
        ];
        for (const [desc, name, expectedWarning] of invalidCases) {
            await it(`should reject ${desc}`, async () => {
                const result = validateToolName(name);
                expect(result.isValid).toBe(false);
                expect(result.warnings).toContain(expectedWarning);
            });
        }
    });

    await describe('validateToolName — advisory warnings', async () => {
        await it('warns on names starting with dash', async () => {
            const result = validateToolName('-get-user');
            expect(result.isValid).toBe(true);
            expect(result.warnings.some((w) => w.includes('starts or ends with a dash'))).toBe(true);
        });

        await it('warns on names ending with dot', async () => {
            const result = validateToolName('get.user.');
            expect(result.isValid).toBe(true);
            expect(result.warnings.some((w) => w.includes('starts or ends with a dot'))).toBe(true);
        });

        await it('warns about spaces as well as flagging invalid', async () => {
            const result = validateToolName('get user profile');
            expect(result.isValid).toBe(false);
            expect(result.warnings.some((w) => w.includes('spaces'))).toBe(true);
        });
    });

    await describe('validateAndWarnToolName', async () => {
        await it('returns true for valid names with no warnings', async () => {
            // Capture warnings without polluting test output.
            const originalWarn = console.warn;
            const calls: unknown[][] = [];
            console.warn = (...args: unknown[]) => {
                calls.push(args);
            };
            try {
                const result = validateAndWarnToolName('get-user-profile');
                expect(result).toBe(true);
                expect(calls.length).toBe(0);
            } finally {
                console.warn = originalWarn;
            }
        });

        await it('returns false and warns for invalid names', async () => {
            const originalWarn = console.warn;
            const calls: unknown[][] = [];
            console.warn = (...args: unknown[]) => {
                calls.push(args);
            };
            try {
                const result = validateAndWarnToolName('get user profile');
                expect(result).toBe(false);
                expect(calls.length).toBeGreaterThan(0);
            } finally {
                console.warn = originalWarn;
            }
        });

        await it('returns true and warns for valid-but-suspicious names', async () => {
            const originalWarn = console.warn;
            const calls: unknown[][] = [];
            console.warn = (...args: unknown[]) => {
                calls.push(args);
            };
            try {
                const result = validateAndWarnToolName('-get-user-');
                expect(result).toBe(true);
                expect(calls.length).toBeGreaterThan(0);
            } finally {
                console.warn = originalWarn;
            }
        });
    });
};
