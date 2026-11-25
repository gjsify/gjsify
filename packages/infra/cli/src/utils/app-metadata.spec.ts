// SPDX-License-Identifier: MIT
// The `Exec=` line of the desktop entry: command, `desktopExecArgs`, field code.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

import { localizeMetadata } from './ship/localize-metadata.js';
import { type AppMetadataInputs, renderDesktopEntry, renderMetainfoApp } from './app-metadata.js';

function inputs(overrides: Partial<AppMetadataInputs> = {}): AppMetadataInputs {
    return {
        appId: 'org.example.Hello',
        name: 'Hello',
        command: 'hello',
        kind: 'app',
        metadata: { summary: 'Says hello' },
        configKey: 'gjsify.ship',
        ...overrides,
    };
}

function execLine(overrides: Partial<AppMetadataInputs> = {}): string {
    const line = renderDesktopEntry(inputs(overrides))
        .split('\n')
        .find((l) => l.startsWith('Exec='));
    return line as string;
}

function hasTool(tool: string): boolean {
    try {
        execFileSync(tool, ['--version'], { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

const DISCLOSURE = 'AI agents wrote most of this app & a human reviews it.';
const AI = { level: 'agent-built', disclosure: DISCLOSURE } as const;

function count(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
}

export default async () => {
    await describe('renderDesktopEntry Exec=', async () => {
        await it('is the bare command without desktopExecArgs', async () => {
            expect(execLine()).toBe('Exec=hello');
        });

        await it('places plain args after the command', async () => {
            expect(execLine({ desktopExecArgs: ['window', '--new'] })).toBe('Exec=hello window --new');
        });

        await it('puts the args before the MIME field code', async () => {
            const metadata = { summary: 'x', provides: { mimetypes: ['application/x-hello'] } };
            expect(execLine({ desktopExecArgs: ['window'], metadata })).toBe('Exec=hello window %f');
            const scheme = { summary: 'x', provides: { mimetypes: ['x-scheme-handler/hello'] } };
            expect(execLine({ desktopExecArgs: ['window'], metadata: scheme })).toBe('Exec=hello window %u');
        });

        await it('quotes an argument with a space and doubles %', async () => {
            expect(execLine({ desktopExecArgs: ['two words'] })).toBe('Exec=hello "two words"');
            expect(execLine({ desktopExecArgs: ['100%'] })).toBe('Exec=hello 100%%');
            expect(execLine({ desktopExecArgs: ['a b%'] })).toBe('Exec=hello "a b%%"');
        });

        await it('escapes quote, dollar and backslash for both spec layers', async () => {
            expect(execLine({ desktopExecArgs: ['say "hi"'] })).toBe('Exec=hello "say \\\\"hi\\\\""');
            expect(execLine({ desktopExecArgs: ['$HOME'] })).toBe('Exec=hello "\\\\$HOME"');
        });

        await it('rejects a newline, naming the config key', async () => {
            expect(() => renderDesktopEntry(inputs({ desktopExecArgs: ['a\nb'] }))).toThrow(
                'gjsify.ship.desktopExecArgs',
            );
        });
    });
    await describe('renderMetainfoApp screenshot environment', async () => {
        await it('keeps the :dark / :light variants AppStream defines', async () => {
            const xml = renderMetainfoApp(
                inputs({
                    metadata: {
                        summary: 'Says hello',
                        screenshots: [
                            { url: 'https://example.org/a.png', environment: 'gnome:dark' },
                            { url: 'https://example.org/b.png', environment: 'plasma:light' },
                            { url: 'https://example.org/c.png', environment: 'cli' },
                        ],
                    },
                }),
            );
            expect(xml).toContain('<screenshot type="default" environment="gnome:dark">');
            expect(xml).toContain('environment="plasma:light"');
            expect(xml).toContain('environment="cli"');
        });
    });

    await describe('renderMetainfoApp aiInvolvement (ADR 0153)', async () => {
        await it('renders the <custom> block last, escaped', async () => {
            const xml = renderMetainfoApp(inputs({ metadata: { summary: 'x', aiInvolvement: AI } }));
            expect(xml).toContain('<value key="gjsify::ai-involvement">agent-built</value>');
            expect(xml).toContain(
                `<value key="gjsify::ai-disclosure">AI agents wrote most of this app &amp; a human reviews it.</value>`,
            );
            expect(xml.indexOf('<custom>')).toBeGreaterThan(xml.indexOf('<content_rating'));
            expect(xml.trimEnd().endsWith('  </custom>\n</component>')).toBe(true);
        });

        await it('omits <custom> when undeclared and the disclosure when absent', async () => {
            expect(renderMetainfoApp(inputs())).not.toContain('<custom>');
            const xml = renderMetainfoApp(inputs({ metadata: { summary: 'x', aiInvolvement: { level: 'none' } } }));
            expect(xml).toContain('>none</value>');
            expect(xml).not.toContain('ai-disclosure');
        });

        await it('refuses an unknown level, naming the config key', async () => {
            let message = '';
            try {
                renderMetainfoApp(inputs({ metadata: { summary: 'x', aiInvolvement: { level: 'mostly' as never } } }));
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('gjsify.ship.aiInvolvement.level');
            expect(message).toContain('agent-built');
        });

        await it('stays one value per key through the gettext fold, and validates', async () => {
            if (!hasTool('msgfmt') || !hasTool('msgunfmt')) return;
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-ai-involvement-'));
            try {
                const po = join(dir, 'de.po');
                writeFileSync(
                    po,
                    [
                        'msgid ""',
                        'msgstr ""',
                        '"Content-Type: text/plain; charset=UTF-8\\n"',
                        '"Language: de\\n"',
                        '',
                        'msgid "Says hello"',
                        'msgstr "Sagt Hallo"',
                        '',
                        `msgid "${DISCLOSURE}"`,
                        'msgstr "KI-Agenten schrieben die App."',
                        '',
                        'msgid "agent-built"',
                        'msgstr "agentengebaut"',
                        '',
                    ].join('\n'),
                );
                mkdirSync(join(dir, 'de', 'LC_MESSAGES'), { recursive: true });
                const mo = join(dir, 'de', 'LC_MESSAGES', 'app.mo');
                execFileSync('msgfmt', [po, '-o', mo], { stdio: 'pipe' });

                const source = renderMetainfoApp(
                    inputs({
                        copyrightYear: 2026,
                        metadata: {
                            summary: 'Says hello',
                            description: 'Hello.',
                            license: { project: 'MIT' },
                            developer: { id: 'org.example', name: 'Example' },
                            homepageUrl: 'https://example.org',
                            aiInvolvement: AI,
                        },
                    }),
                );
                const folded = localizeMetadata({ metainfo: source }, [{ rel: 'de/LC_MESSAGES/app.mo', abs: mo }]);

                // The fold really ran (summary gained its xml:lang sibling) ...
                expect(folded.metainfo).toContain('<summary xml:lang="de">Sagt Hallo</summary>');
                // ... and left the custom values single and untranslated.
                expect(count(folded.metainfo, 'key="gjsify::ai-disclosure"')).toBe(1);
                expect(count(folded.metainfo, 'key="gjsify::ai-involvement"')).toBe(1);
                expect(folded.metainfo).not.toContain('KI-Agenten');
                expect(folded.metainfo).not.toContain('agentengebaut');
                expect(folded.metainfo).not.toMatch(/<value[^>]*xml:lang/);

                if (hasTool('appstreamcli')) {
                    const file = join(dir, 'org.example.Hello.metainfo.xml');
                    writeFileSync(file, folded.metainfo);
                    const out = (() => {
                        try {
                            return execFileSync('appstreamcli', ['validate', '--no-net', file], {
                                stdio: 'pipe',
                            }).toString();
                        } catch (error) {
                            return String((error as { stdout?: Buffer }).stdout ?? error);
                        }
                    })();
                    expect(out).not.toContain('custom-key-duplicated');
                }
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });
};
