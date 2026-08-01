// SPDX-License-Identifier: MIT
// Smoke tests for @anthropic-ai/claude-agent-sdk on GJS + Node.
//
// Goals:
//   - Confirm the SDK bundle imports without throwing on both runtimes.
//   - Verify that well-known constants are present and structurally sound.
//   - Verify AbortError is a proper Error subclass.
//
// No Claude API key is needed — these tests exercise pure-JS exports only.

import { describe, expect, it } from '@gjsify/unit';
import { AbortError, EXIT_REASONS, HOOK_EVENTS, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk';

export default async () => {
    await describe('@anthropic-ai/claude-agent-sdk — smoke', async () => {
        await describe('module import', async () => {
            await it('imports without throwing', async () => {
                // If we reach this point the ESM top-level evaluation of sdk.mjs succeeded.
                const mod = await import('@anthropic-ai/claude-agent-sdk');
                expect(mod).toBeDefined();
                expect(typeof mod).toBe('object');
            });
        });

        await describe('EXIT_REASONS', async () => {
            await it('is a non-empty readonly array', async () => {
                expect(Array.isArray(EXIT_REASONS)).toBe(true);
                expect(EXIT_REASONS.length).toBeGreaterThan(0);
            });

            await it('contains expected string literals', async () => {
                const reasons = EXIT_REASONS as readonly string[];
                expect(reasons).toContain('clear');
                expect(reasons).toContain('resume');
                expect(reasons).toContain('logout');
                expect(reasons).toContain('other');
            });
        });

        await describe('HOOK_EVENTS', async () => {
            await it('is a non-empty readonly array', async () => {
                expect(Array.isArray(HOOK_EVENTS)).toBe(true);
                expect(HOOK_EVENTS.length).toBeGreaterThan(0);
            });

            await it('contains common lifecycle events', async () => {
                const events = HOOK_EVENTS as readonly string[];
                expect(events).toContain('PreToolUse');
                expect(events).toContain('PostToolUse');
                expect(events).toContain('SessionStart');
                expect(events).toContain('SessionEnd');
                expect(events).toContain('Stop');
            });
        });

        await describe('SYSTEM_PROMPT_DYNAMIC_BOUNDARY', async () => {
            await it('is a non-empty string', async () => {
                expect(typeof SYSTEM_PROMPT_DYNAMIC_BOUNDARY).toBe('string');
                expect(SYSTEM_PROMPT_DYNAMIC_BOUNDARY.length).toBeGreaterThan(0);
            });
        });

        await describe('AbortError', async () => {
            await it('is a proper Error subclass', async () => {
                const err = new AbortError('operation aborted');
                expect(err instanceof Error).toBe(true);
                expect(err instanceof AbortError).toBe(true);
                expect(err.message).toBe('operation aborted');
            });

            await it('has a sensible name', async () => {
                const err = new AbortError();
                // Name is either the class name or 'AbortError'
                expect(typeof err.name).toBe('string');
                expect(err.name.length).toBeGreaterThan(0);
            });
        });
    });
};
