// SPDX-License-Identifier: MIT
// Ported from refs/mcp-typescript-sdk/test/shared/uriTemplate.test.ts (v1.29.0)
// Original: Copyright (c) Anthropic, PBC. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// UriTemplate is pure JS (regex + string ops) but stresses RegExp engine
// behaviour under both V8 and SpiderMonkey. Includes the CVE-2026-0621 ReDoS
// regression cases — exploded-list templates must not catastrophically
// backtrack regardless of input length.

import { describe, it, expect } from '@gjsify/unit';
import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';

export default async () => {
    await describe('UriTemplate.isTemplate', async () => {
        await it('returns true for strings containing template expressions', async () => {
            expect(UriTemplate.isTemplate('{foo}')).toBe(true);
            expect(UriTemplate.isTemplate('/users/{id}')).toBe(true);
            expect(UriTemplate.isTemplate('http://example.com/{path}/{file}')).toBe(true);
            expect(UriTemplate.isTemplate('/search{?q,limit}')).toBe(true);
        });

        await it('returns false for strings without template expressions', async () => {
            expect(UriTemplate.isTemplate('')).toBe(false);
            expect(UriTemplate.isTemplate('plain string')).toBe(false);
            expect(UriTemplate.isTemplate('http://example.com/foo/bar')).toBe(false);
            // Empty braces and whitespace-only braces don't count as templates.
            expect(UriTemplate.isTemplate('{}')).toBe(false);
            expect(UriTemplate.isTemplate('{ }')).toBe(false);
        });
    });

    await describe('UriTemplate simple string expansion', async () => {
        await it('expands simple string variables', async () => {
            const template = new UriTemplate('http://example.com/users/{username}');
            expect(template.expand({ username: 'fred' })).toBe('http://example.com/users/fred');
            expect(template.variableNames).toStrictEqual(['username']);
        });

        await it('handles multiple variables', async () => {
            const template = new UriTemplate('{x,y}');
            expect(template.expand({ x: '1024', y: '768' })).toBe('1024,768');
            expect(template.variableNames).toStrictEqual(['x', 'y']);
        });

        await it('encodes reserved characters', async () => {
            const template = new UriTemplate('{var}');
            expect(template.expand({ var: 'value with spaces' })).toBe('value%20with%20spaces');
        });
    });

    await describe('UriTemplate operator expansion', async () => {
        await it('+ does not encode reserved chars', async () => {
            const template = new UriTemplate('{+path}/here');
            expect(template.expand({ path: '/foo/bar' })).toBe('/foo/bar/here');
        });

        await it('# adds fragment prefix and skips reserved encoding', async () => {
            const template = new UriTemplate('X{#var}');
            expect(template.expand({ var: '/test' })).toBe('X#/test');
        });

        await it('. adds label prefix', async () => {
            expect(new UriTemplate('X{.var}').expand({ var: 'test' })).toBe('X.test');
        });

        await it('/ adds path prefix', async () => {
            expect(new UriTemplate('X{/var}').expand({ var: 'test' })).toBe('X/test');
        });

        await it('? produces query-string form', async () => {
            expect(new UriTemplate('X{?var}').expand({ var: 'test' })).toBe('X?var=test');
        });

        await it('& produces form-continuation form', async () => {
            expect(new UriTemplate('X{&var}').expand({ var: 'test' })).toBe('X&var=test');
        });
    });

    await describe('UriTemplate matching', async () => {
        await it('matches simple strings and extracts variables', async () => {
            const template = new UriTemplate('http://example.com/users/{username}');
            expect(template.match('http://example.com/users/fred')).toStrictEqual({ username: 'fred' });
        });

        await it('matches multiple variables', async () => {
            const template = new UriTemplate('/users/{username}/posts/{postId}');
            expect(template.match('/users/fred/posts/123')).toStrictEqual({ username: 'fred', postId: '123' });
        });

        await it('returns null for non-matching URIs', async () => {
            const template = new UriTemplate('/users/{username}');
            expect(template.match('/posts/123')).toBeNull();
        });

        await it('handles exploded arrays', async () => {
            const template = new UriTemplate('{/list*}');
            expect(template.match('/red,green,blue')).toStrictEqual({ list: ['red', 'green', 'blue'] });
        });

        await it('handles query parameters', async () => {
            const template = new UriTemplate('/search{?q,page}');
            expect(template.match('/search?q=test&page=1')).toStrictEqual({ q: 'test', page: '1' });
        });

        await it('returns null on partial / overlong matches', async () => {
            const template = new UriTemplate('/users/{id}');
            expect(template.match('/users/123/extra')).toBeNull();
            expect(template.match('/users')).toBeNull();
        });
    });

    await describe('UriTemplate edge cases', async () => {
        await it('expands missing variables to empty string', async () => {
            const template = new UriTemplate('{a}{b}{c}');
            expect(template.expand({ b: '2' })).toBe('2');
        });

        await it('handles overlapping variable names', async () => {
            const template = new UriTemplate('{var}{vara}');
            expect(template.expand({ var: '1', vara: '2' })).toBe('12');
            expect(template.variableNames).toStrictEqual(['var', 'vara']);
        });

        await it('handles repeated query operators', async () => {
            const template = new UriTemplate('{?a}{?b}{?c}');
            expect(template.expand({ a: '1', b: '2', c: '3' })).toBe('?a=1&b=2&c=3');
        });

        await it('throws on malformed (unclosed) template expressions', async () => {
            expect(() => new UriTemplate('{unclosed')).toThrow();
            expect(() => new UriTemplate('{a}{')).toThrow();
        });

        await it('accepts empty / comma-only braces without throwing', async () => {
            expect(() => new UriTemplate('{}')).not.toThrow();
            expect(() => new UriTemplate('{,}')).not.toThrow();
        });
    });

    await describe('UriTemplate ReDoS safety (CVE-2026-0621)', async () => {
        // The exploded-list operators must not catastrophically backtrack on
        // adversarial inputs full of separators. Upstream issue:
        // https://github.com/modelcontextprotocol/typescript-sdk/issues/965
        await it('exploded path operator matches in linear time', async () => {
            const template = new UriTemplate('{/id*}');
            const maliciousPayload = '/' + ','.repeat(50);
            const start = Date.now();
            template.match(maliciousPayload);
            const elapsed = Date.now() - start;
            expect(elapsed).toBeLessThan(500);
        });

        await it('exploded simple operator matches in linear time', async () => {
            const template = new UriTemplate('{id*}');
            const maliciousPayload = ','.repeat(50);
            const start = Date.now();
            template.match(maliciousPayload);
            const elapsed = Date.now() - start;
            expect(elapsed).toBeLessThan(500);
        });

        await it('handles a 100k-char variable expansion without throwing', async () => {
            const longString = 'x'.repeat(100000);
            const template = new UriTemplate('/api/{param}');
            expect(template.expand({ param: longString })).toBe(`/api/${longString}`);
            expect(template.match(`/api/${longString}`)).toStrictEqual({ param: longString });
        });
    });
};
